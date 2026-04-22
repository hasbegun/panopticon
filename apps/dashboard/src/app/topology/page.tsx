'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { RefreshCw, Server, Bot, Wrench, Brain } from 'lucide-react';
import { useProject } from '@/lib/store';
import {
  fetchTopology,
  fetchMcpServers,
  type TopoNode,
  type TopoLink,
  type McpServer,
} from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

// ── Types for simulation ───────────────────────────────────────────────────────

interface SimNode extends SimulationNodeDatum {
  id: string;
  type: string;
  label: string;
  callCount: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  callCount: number;
  avgMs: number;
  errors: number;
}

// ── Colors ─────────────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { fill: string; stroke: string }> = {
  agent:      { fill: '#3b82f6', stroke: '#2563eb' },
  mcp_server: { fill: '#10b981', stroke: '#059669' },
  tool:       { fill: '#f59e0b', stroke: '#d97706' },
  llm:        { fill: '#a855f7', stroke: '#7c3aed' },
};

const NODE_ICONS: Record<string, typeof Bot> = {
  agent: Bot,
  mcp_server: Server,
  tool: Wrench,
  llm: Brain,
};

// ── Force Graph Component ──────────────────────────────────────────────────────

function ForceGraph({ nodes, links }: { nodes: TopoNode[]; links: TopoLink[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [simLinks, setSimLinks] = useState<SimLink[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 500 });

  // Pan & zoom state
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false, startX: 0, startY: 0, origX: 0, origY: 0,
  });

  // Measure container
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (el) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setDimensions({ w: entry.contentRect.width, h: Math.max(entry.contentRect.height, 400) });
        }
      });
      ro.observe(el);
      setDimensions({ w: el.clientWidth, h: Math.max(el.clientHeight, 400) });
      return () => ro.disconnect();
    }
  }, []);

  // Run simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const sNodes: SimNode[] = nodes.map((n) => ({ ...n, x: undefined, y: undefined }));
    const sLinks: SimLink[] = links.map((l) => ({
      source: l.source,
      target: l.target,
      callCount: l.callCount,
      avgMs: l.avgMs,
      errors: l.errors,
    }));

    const sim = forceSimulation(sNodes)
      .force('link', forceLink<SimNode, SimLink>(sLinks).id((d) => d.id).distance(120))
      .force('charge', forceManyBody().strength(-300))
      .force('center', forceCenter(dimensions.w / 2, dimensions.h / 2))
      .force('collide', forceCollide(40));

    sim.on('tick', () => {
      setSimNodes([...sNodes]);
      setSimLinks([...sLinks]);
    });

    sim.alpha(1).restart();

    return () => {
      sim.stop();
    };
  }, [nodes, links, dimensions]);

  const nodeRadius = (n: SimNode) => Math.max(14, Math.min(28, 10 + Math.sqrt(n.callCount) * 2));

  // Pan handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  }, [transform.x, transform.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panRef.current.active) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    setTransform((t) => ({ ...t, x: panRef.current.origX + dx, y: panRef.current.origY + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    panRef.current.active = false;
  }, []);

  // Zoom handler
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform((t) => {
      const newK = Math.min(4, Math.max(0.1, t.k * factor));
      const ratio = newK / t.k;
      return { k: newK, x: mx - ratio * (mx - t.x), y: my - ratio * (my - t.y) };
    });
  }, []);

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={dimensions.h}
      className="select-none cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="hsl(var(--muted-foreground))" opacity={0.4} />
        </marker>
      </defs>

      <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
      {/* Links */}
      {simLinks.map((l, i) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (!s.x || !t.x) return null;
        const hasErrors = l.errors > 0;
        return (
          <g key={i}>
            <line
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={hasErrors ? '#ef4444' : 'hsl(var(--muted-foreground))'}
              strokeWidth={Math.max(1, Math.min(4, l.callCount / 10))}
              strokeOpacity={hasErrors ? 0.6 : 0.25}
              markerEnd="url(#arrowhead)"
            />
            {/* Call count label on edge */}
            <text
              x={(s.x! + t.x!) / 2}
              y={(s.y! + t.y!) / 2 - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {l.callCount}×
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {simNodes.map((n) => {
        if (!n.x || !n.y) return null;
        const r = nodeRadius(n);
        const color = NODE_COLORS[n.type] ?? NODE_COLORS.tool;
        const isHovered = hoveredNode === n.id;

        return (
          <g
            key={n.id}
            transform={`translate(${n.x}, ${n.y})`}
            onMouseEnter={() => setHoveredNode(n.id)}
            onMouseLeave={() => setHoveredNode(null)}
            className="cursor-pointer"
          >
            <circle
              r={r}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={isHovered ? 3 : 1.5}
              opacity={isHovered ? 1 : 0.85}
            />
            {/* Label */}
            <text
              y={r + 14}
              textAnchor="middle"
              className="fill-foreground text-[10px] font-medium"
            >
              {n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label}
            </text>
            {/* Type badge */}
            <text
              y={r + 24}
              textAnchor="middle"
              className="fill-muted-foreground text-[8px]"
            >
              {n.type.replace('_', ' ')}
            </text>
            {/* Tooltip on hover */}
            {isHovered && (
              <foreignObject x={r + 4} y={-30} width={140} height={50}>
                <div className="rounded border border-border bg-card px-2 py-1 text-[10px] shadow-lg">
                  <div className="font-medium">{n.label}</div>
                  <div className="text-muted-foreground">{n.callCount} calls</div>
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
      </g>
    </svg>
  );
}

// ── MCP Server Registry ────────────────────────────────────────────────────────

function McpServerTable({ servers }: { servers: McpServer[] }) {
  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <Server className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No MCP servers discovered yet. Instrument calls with <code className="rounded bg-muted px-1 py-0.5">pan.instrumentMCP()</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3">Server</th>
            <th className="px-4 py-3">Calls</th>
            <th className="px-4 py-3">Errors</th>
            <th className="px-4 py-3">Last Seen</th>
            <th className="px-4 py-3">Tools</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {servers.map((srv) => (
            <tr key={srv.server_name} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">
                <span className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-emerald-400" />
                  {srv.server_name}
                </span>
              </td>
              <td className="px-4 py-3">{srv.total_calls}</td>
              <td className="px-4 py-3">
                <span className={Number(srv.error_count) > 0 ? 'text-red-400' : 'text-muted-foreground'}>
                  {srv.error_count}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{srv.last_seen}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {(srv.tools ?? []).filter(Boolean).slice(0, 5).map((tool) => (
                    <span key={tool} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{tool}</span>
                  ))}
                  {(srv.tools ?? []).filter(Boolean).length > 5 && (
                    <span className="text-[10px] text-muted-foreground">+{srv.tools.length - 5}</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Topology Page ─────────────────────────────────────────────────────────

export default function TopologyPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [links, setLinks] = useState<TopoLink[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!isConfigured) return;
    setLoading(true);
    Promise.all([
      fetchTopology(apiKey, projectId),
      fetchMcpServers(apiKey, projectId),
    ])
      .then(([topo, mcp]) => {
        setNodes(topo.data.nodes);
        setLinks(topo.data.links);
        setServers(mcp.data);
      })
      .finally(() => setLoading(false));
  }, [apiKey, projectId, isConfigured]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Topology</h1>
          <p className="mt-1 text-muted-foreground">
            Visualize agent, MCP server, and tool relationships
          </p>
        </div>
        {isConfigured && (
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      <ProjectSetupBanner />

      {isConfigured && (
        <>
          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs">
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color.fill }} />
                {type.replace('_', ' ')}
              </span>
            ))}
          </div>

          {/* Force Graph */}
          <div className="relative min-h-[400px] overflow-hidden rounded-lg border border-border bg-card">
            {nodes.length === 0 && !loading ? (
              <div className="flex h-[400px] items-center justify-center text-muted-foreground">
                No topology data found. Run traces with MCP instrumentation to populate the graph.
              </div>
            ) : (
              <ForceGraph nodes={nodes} links={links} />
            )}
          </div>

          {/* MCP Server Registry */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">MCP Server Registry</h2>
            <McpServerTable servers={servers} />
          </div>
        </>
      )}
    </div>
  );
}
