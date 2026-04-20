import { Hono } from 'hono';
import { getClickHouse } from '../db/clickhouse.js';
import { isLLMConfigured, resolveConfig } from '../llm/index.js';
import { translateQuery } from '../llm/query.js';
import { analyzeTrace, type SpanForAnalysis } from '../llm/analysis.js';

export const queryRoutes = new Hono();

// ── Natural Language Query ──────────────────────────────────────────────────

/** POST /v1/query — Translate natural language to SQL and execute */
queryRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { question, project_id } = body;

  if (!question || !project_id) {
    return c.json(
      { error: 'bad_request', message: 'question and project_id are required', statusCode: 400 },
      400,
    );
  }

  const llmCfg = await resolveConfig(project_id);
  if (!isLLMConfigured(llmCfg)) {
    return c.json(
      { error: 'llm_not_configured', message: 'LLM not configured. Set LLM_PROVIDER and LLM_API_KEY in env or project settings.', statusCode: 503 },
      503,
    );
  }

  try {
    // Step 1: Translate question to SQL
    const { sql, description, params } = await translateQuery(question, project_id, llmCfg);

    // Step 2: Execute the query
    const ch = getClickHouse();
    const result = await ch.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    });

    const rows = await result.json();

    return c.json({
      data: {
        question,
        description,
        sql,
        results: rows,
        count: (rows as unknown[]).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query translation failed';
    return c.json({ error: 'query_failed', message, statusCode: 500 }, 500);
  }
});

// ── Trace Analysis ──────────────────────────────────────────────────────────

/** POST /v1/traces/:traceId/analyze — LLM-powered root cause analysis */
queryRoutes.post('/traces/:traceId/analyze', async (c) => {
  const traceId = c.req.param('traceId');
  const ch = getClickHouse();

  // Fetch the trace spans
  const result = await ch.query({
    query: `SELECT * FROM panopticon.spans WHERE trace_id = {traceId: String} ORDER BY start_time ASC`,
    query_params: { traceId },
    format: 'JSONEachRow',
  });

  const spans = (await result.json()) as SpanForAnalysis[];

  if (!spans || spans.length === 0) {
    return c.json({ error: 'not_found', message: 'Trace not found', statusCode: 404 }, 404);
  }

  const projectId = (spans[0] as { project_id?: string }).project_id ?? '';
  const llmCfg = await resolveConfig(projectId);
  if (!isLLMConfigured(llmCfg)) {
    return c.json(
      { error: 'llm_not_configured', message: 'LLM not configured. Set LLM_PROVIDER and LLM_API_KEY in env or project settings.', statusCode: 503 },
      503,
    );
  }

  try {
    const analysis = await analyzeTrace(spans, llmCfg);

    // Cache the analysis in ClickHouse
    try {
      await ch.insert({
        table: 'panopticon.trace_analysis',
        values: [{
          trace_id: traceId,
          project_id: projectId,
          summary: analysis.summary,
          root_cause: analysis.rootCause ?? '',
          impact: analysis.impact,
          recommendation: analysis.recommendation,
          severity: analysis.severity,
        }],
        format: 'JSONEachRow',
      });
    } catch {
      // Table might not exist yet if migration hasn't run — non-fatal
      console.warn('[analyze] Could not cache analysis (trace_analysis table may not exist)');
    }

    return c.json({ data: { traceId, ...analysis } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    return c.json({ error: 'analysis_failed', message, statusCode: 500 }, 500);
  }
});

/** GET /v1/traces/:traceId/analysis — Get cached analysis */
queryRoutes.get('/traces/:traceId/analysis', async (c) => {
  const traceId = c.req.param('traceId');
  const ch = getClickHouse();

  try {
    const result = await ch.query({
      query: `SELECT * FROM panopticon.trace_analysis WHERE trace_id = {traceId: String} ORDER BY created_at DESC LIMIT 1`,
      query_params: { traceId },
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as unknown[];
    if (!rows || rows.length === 0) {
      return c.json({ error: 'not_found', message: 'No analysis found for this trace', statusCode: 404 }, 404);
    }

    return c.json({ data: rows[0] });
  } catch {
    return c.json({ error: 'not_found', message: 'Analysis not available', statusCode: 404 }, 404);
  }
});
