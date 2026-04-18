import { Hono } from 'hono';
import { getClickHouse } from '../db/clickhouse.js';
import { getPostgres } from '../db/postgres.js';

export const topologyRoutes = new Hono();

/** Get the agent ↔ MCP server ↔ tool relationship graph */
topologyRoutes.get('/', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const windowMinutes = Number(c.req.query('window_minutes') ?? 1440);

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  // Get agent → span_type edges from ClickHouse
  const edgeResult = await ch.query({
    query: `
      SELECT
        agent_id,
        span_type,
        name,
        JSONExtractString(metadata, 'mcpServer') AS mcp_server,
        JSONExtractString(metadata, 'toolName') AS tool_name,
        count() AS call_count,
        round(avg(duration_ms), 2) AS avg_duration_ms,
        countIf(status = 'error') AS error_count
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      GROUP BY agent_id, span_type, name, mcp_server, tool_name
      ORDER BY call_count DESC
      LIMIT 500
    `,
    query_params: { projectId, windowMinutes },
    format: 'JSONEachRow',
  });

  const edges = (await edgeResult.json()) as Array<{
    agent_id: string;
    span_type: string;
    name: string;
    mcp_server: string;
    tool_name: string;
    call_count: string;
    avg_duration_ms: number;
    error_count: string;
  }>;

  // Build node and link sets for a force-directed graph
  const nodeMap = new Map<string, { id: string; type: string; label: string; callCount: number }>();
  const links: Array<{ source: string; target: string; callCount: number; avgMs: number; errors: number }> = [];

  function ensureNode(id: string, type: string, label: string) {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, type, label, callCount: 0 });
    }
  }

  for (const edge of edges) {
    const agentNodeId = `agent:${edge.agent_id}`;
    ensureNode(agentNodeId, 'agent', edge.agent_id);

    const count = Number(edge.call_count);
    const node = nodeMap.get(agentNodeId)!;
    node.callCount += count;

    if (edge.mcp_server) {
      const mcpNodeId = `mcp:${edge.mcp_server}`;
      ensureNode(mcpNodeId, 'mcp_server', edge.mcp_server);
      nodeMap.get(mcpNodeId)!.callCount += count;

      links.push({
        source: agentNodeId,
        target: mcpNodeId,
        callCount: count,
        avgMs: edge.avg_duration_ms,
        errors: Number(edge.error_count),
      });

      if (edge.tool_name) {
        const toolNodeId = `tool:${edge.mcp_server}:${edge.tool_name}`;
        ensureNode(toolNodeId, 'tool', edge.tool_name);
        nodeMap.get(toolNodeId)!.callCount += count;

        links.push({
          source: mcpNodeId,
          target: toolNodeId,
          callCount: count,
          avgMs: edge.avg_duration_ms,
          errors: Number(edge.error_count),
        });
      }
    } else if (edge.span_type === 'llm_call') {
      const llmNodeId = `llm:${edge.name}`;
      ensureNode(llmNodeId, 'llm', edge.name);
      nodeMap.get(llmNodeId)!.callCount += count;

      links.push({
        source: agentNodeId,
        target: llmNodeId,
        callCount: count,
        avgMs: edge.avg_duration_ms,
        errors: Number(edge.error_count),
      });
    } else if (edge.span_type === 'tool_call') {
      const toolNodeId = `tool:${edge.name}`;
      ensureNode(toolNodeId, 'tool', edge.name);
      nodeMap.get(toolNodeId)!.callCount += count;

      links.push({
        source: agentNodeId,
        target: toolNodeId,
        callCount: count,
        avgMs: edge.avg_duration_ms,
        errors: Number(edge.error_count),
      });
    }
  }

  return c.json({
    data: {
      nodes: Array.from(nodeMap.values()),
      links,
    },
  });
});

/** Auto-discover and list MCP servers from traces + Postgres registry */
topologyRoutes.get('/mcp-servers', async (c) => {
  const projectId = c.req.query('project_id');

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  // Get MCP servers from ClickHouse spans (auto-discovered)
  const ch = getClickHouse();
  const discovered = await ch.query({
    query: `
      SELECT
        JSONExtractString(metadata, 'mcpServer') AS server_name,
        count() AS total_calls,
        max(start_time) AS last_seen,
        countIf(status = 'error') AS error_count,
        groupUniqArray(JSONExtractString(metadata, 'toolName')) AS tools
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND JSONExtractString(metadata, 'mcpServer') != ''
      GROUP BY server_name
      ORDER BY last_seen DESC
    `,
    query_params: { projectId },
    format: 'JSONEachRow',
  });

  const servers = await discovered.json();

  // Also upsert discovered servers into Postgres registry
  const db = getPostgres();
  for (const srv of servers as Array<{ server_name: string; total_calls: string; last_seen: string; tools: string[] }>) {
    const id = `${projectId}:${srv.server_name}`;
    await db`
      INSERT INTO mcp_servers (id, project_id, name, status, last_seen, tools, updated_at)
      VALUES (${id}, ${projectId}, ${srv.server_name}, 'active', ${srv.last_seen}, ${JSON.stringify(srv.tools)}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        status = 'active',
        last_seen = EXCLUDED.last_seen,
        tools = EXCLUDED.tools,
        updated_at = NOW()
    `;
  }

  return c.json({ data: servers });
});
