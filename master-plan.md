# Panopticon — AI Agent & MCP Observability Platform

An open-source, TypeScript full-stack observability platform for monitoring, tracing, and securing AI agentic systems and MCP (Model Context Protocol) servers.

> **Container-first**: Everything runs in Docker. No local Node/Bun/npm required. Just `docker compose up`.

---

## Problem Statement

AI agents (LangChain, CrewAI, AutoGen, custom) and MCP servers are becoming production infrastructure, but there's no unified observability layer that covers:
- **What did the agent do?** (tracing reasoning chains, tool calls, MCP requests)
- **Is it healthy right now?** (latency, error rates, cost, throughput)
- **Is it safe?** (prompt injection, data exfiltration, unauthorized tool access)

Existing tools (Langfuse, LangSmith, Arize) focus on LLM calls. None deeply understand **MCP protocol semantics** or provide **agent-level topology views**.

---

## Quick Start (only requires Docker)

```bash
git clone <repo> && cd panopticon
cp .env.example .env
make dev          # builds + starts everything
# API:       http://localhost:4400
# Dashboard: http://localhost:3000
```

Other Makefile targets:
```bash
make build        # Build all container images
make dev          # Start dev mode (hot-reload via volume mounts)
make down         # Stop all services
make logs         # Tail all logs
make migrate      # Run DB migrations inside API container
make test         # Run tests inside containers
make lint         # Lint + typecheck inside containers
make clean        # Remove volumes and images
```

---

## Core Pillars

### 1. Tracing & Debugging
- Full trace trees: agent → reasoning step → LLM call → tool/MCP invocation → response
- MCP-aware spans: distinguish `tools/call`, `resources/read`, `prompts/get`, `sampling/createMessage`
- Latency breakdown per span (LLM inference vs tool execution vs network)
- Prompt/response capture with PII redaction options
- Trace search & filtering (by agent, model, tool, status, latency, cost)
- Replay/diff: compare two traces side-by-side

### 2. Live Monitoring & Dashboards
- Real-time agent health: active sessions, throughput, error rate
- MCP server status: connected/disconnected, request rate, latency P50/P95/P99
- Cost tracking: token usage per agent/model/provider with budget alerts
- Topology map: visual graph of agents ↔ MCP servers ↔ tools ↔ resources
- Anomaly detection: latency spikes, error rate changes, unusual tool call patterns
- Configurable alerts (webhook, Slack, email, PagerDuty)

### 3. Security & Compliance
- Audit log: immutable record of every agent action and MCP tool call
- Prompt injection detection: classify inbound/outbound content for attack patterns
- Data leakage monitoring: flag sensitive data (PII, secrets) in agent I/O
- Tool access matrix: which agents can call which MCP tools, with deny-by-default policies
- Rate limiting visibility: per-agent, per-tool call budgets
- Compliance export: SOC2/GDPR-style audit trail exports

---

## Architecture (Container-First)

All services run as Docker containers. Development uses volume mounts for hot-reload.
The only prerequisite is **Docker** (with Compose v2).

```
┌── docker compose ──────────────────────────────────────┐
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐    │
│  │ api      │  │ dashboard│  │  postgres          │    │
│  │ Hono/Bun │  │ Next.js  │  │  (config, auth)    │    │
│  │ :4400    │  │ :3000    │  │  :5432             │    │
│  └──────────┘  └──────────┘  └───────────────────┘    │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐    │
│  │ worker   │  │ redis    │  │  clickhouse        │    │
│  │ BullMQ   │  │ :6379    │  │  (traces/spans)    │    │
│  └──────────┘  └──────────┘  │  :8123             │    │
│                               └───────────────────┘    │
└────────────────────────────────────────────────────────┘

  External:  @panopticon/sdk  ──POST /v1/traces──▶  api
```

### Docker Containers (6 services)

| Container | Image | Port | Role |
|-----------|-------|------|------|
| **api** | `oven/bun` + app code | 4400 | Hono API — ingestion, auth, project CRUD |
| **dashboard** | `node` + Next.js | 3000 | Web UI — traces, live, topology, security |
| **worker** | `oven/bun` + app code | — | BullMQ jobs — enrichment, classification, alerts |
| **postgres** | `postgres:16-alpine` | 5432 | Config DB — projects, MCP registry, alert rules |
| **clickhouse** | `clickhouse/clickhouse-server:24` | 8123 | Trace storage — spans, high-cardinality queries |
| **redis** | `redis:7-alpine` | 6379 | Real-time pub/sub + job queue |

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Backend API** | Hono (on Bun) | Lightweight, fast, TypeScript-native |
| **Dashboard** | Next.js 15 + React 19 | SSR, app router, RSC for data-heavy views |
| **UI Components** | shadcn/ui + Tailwind | Clean, accessible, themeable |
| **Trace Storage** | ClickHouse | Columnar DB, excellent for high-cardinality trace queries |
| **Config/Auth DB** | PostgreSQL | Relational data: projects, users, alert rules |
| **Real-time** | Redis Streams | Pub/sub for live dashboards + WebSocket fan-out |
| **Queue** | BullMQ (Redis) | Background jobs: enrichment, classification, alerting |
| **Visualizations** | Recharts + D3 (topology) | Trace waterfalls, time-series charts, force-directed graphs |
| **SDK (TypeScript)** | `@panopticon/sdk` | Instrument agents/MCP with minimal code |
| **SDK (Python)** | `panopticon-py` | Python agent frameworks (LangChain, CrewAI, etc.) |
| **Orchestration** | Docker Compose + Makefile | Zero local deps, single-command dev/prod |

---

## Data Model

### Trace / Span (ClickHouse)
```
trace_id        String        -- groups all spans in one agent invocation
span_id         String        -- unique span
parent_span_id  String?       -- parent (null = root)
project_id      String        -- multi-project isolation
agent_id        String        -- which agent
span_type       Enum          -- 'agent_step' | 'llm_call' | 'mcp_request' | 'tool_call' | 'resource_read'
name            String        -- e.g. "tools/call:file_search"
status          Enum          -- 'ok' | 'error' | 'timeout'
start_time      DateTime64(3)
end_time        DateTime64(3)
duration_ms     UInt32
input           String        -- JSON (prompt / request body)
output          String        -- JSON (response body)
metadata        String        -- JSON (model, tokens, cost, mcp_server, etc.)
security_flags  Array(String) -- ['prompt_injection', 'pii_detected', ...]
```

### MCP Server Registry (Postgres)
```
id, project_id, name, transport (stdio|sse|streamable-http),
endpoint, status, last_seen, capabilities (JSON),
tools (JSON), resources (JSON)
```

### Alert Rule (Postgres)
```
id, project_id, name, condition (JSON DSL),
channels (JSON), enabled, cooldown_seconds
```

---

## SDK Design (TypeScript)

```typescript
import { Panopticon } from '@panopticon/sdk';

const pan = new Panopticon({
  endpoint: 'http://localhost:4400',
  projectId: 'my-project',
});

// Wrap an MCP client to auto-instrument all tool calls
const instrumentedClient = pan.instrumentMCP(mcpClient);

// Manual tracing for agent logic
const trace = pan.startTrace({ agentId: 'research-agent' });
const span = trace.startSpan({ type: 'llm_call', name: 'gpt-4o' });
span.setInput(prompt);
const result = await llm.complete(prompt);
span.setOutput(result);
span.end();
trace.end();
```

### Auto-instrumentation targets
- **MCP SDK**: Monkey-patch `Client.callTool()`, `Client.readResource()`, `Client.getPrompt()`
- **Vercel AI SDK**: Wrap `generateText()`, `streamText()`, `generateObject()`
- **LangChain.js**: Custom callback handler
- **OpenAI SDK**: Intercept `chat.completions.create()`

---

## Phased Roadmap

### Phase 0 — Foundation (Weeks 1-2)
- [x] Monorepo: Turborepo with `apps/api`, `apps/dashboard`, `packages/sdk`, `packages/shared`
- [x] **Docker Compose**: all 6 containers (api, dashboard, worker, postgres, clickhouse, redis)
- [x] **Makefile**: `make dev` / `make build` / `make test` / `make lint` / `make migrate` / `make clean`
- [x] **docker-compose.dev.yml** overlay: volume mounts for hot-reload, no rebuild needed
- [x] Hono API skeleton: health, auth (API keys), project CRUD
- [x] Basic span ingestion endpoint: `POST /v1/traces`
- [x] `@panopticon/sdk` core: `startTrace()`, `startSpan()`, `end()`, batch flush
- [x] CI: GitHub Actions (all tests run in containers, mirrors `make test`)

### Phase 1 — Tracing MVP (Weeks 3-5)
- [x] Trace ingestion pipeline: validate → enrich → write to ClickHouse — Zod validation, ClickHouse write, BullMQ job enqueue for enrichment + security workers
- [x] Dashboard: trace list view with search/filter — wired to GET /v1/traces, paginated, status badges, duration, agent
- [x] Trace detail: waterfall visualization — span tree with color-coded timing bars, nested depth, duration labels
- [x] Span detail panel: input/output viewer with JSON syntax highlighting, metadata, security flags
- [x] MCP-aware spans: parse MCP method names (tools/call, resources/read, prompts/get), enrich metadata in worker
- [x] SDK: MCP client auto-instrumentation — `pan.instrumentMCP(client)` wraps callTool/readResource/getPrompt via Proxy

### Phase 2 — Live Monitoring (Weeks 6-8)
- [x] Real-time ingestion via Redis Streams — XADD on ingest to `panopticon:spans:{projectId}`, capped at 10k entries
- [x] SSE endpoint for dashboard live updates — `GET /v1/live/stream` reads Redis Stream with XREAD BLOCK, streams to client (SSE chosen over WS for proxy compatibility)
- [x] Overview dashboard: request rate, latency percentiles, error rate — Recharts time-series (throughput, errors/min, avg/P95 latency) + 30s auto-refresh
- [x] MCP server registry: auto-discover from trace metadata, upsert to Postgres, table with calls/errors/tools
- [x] Agent topology graph: d3-force simulation with SVG rendering, color-coded nodes (agent/MCP/tool/LLM), edge call counts, hover tooltips
- [x] Cost tracking: ClickHouse aggregation of token usage by agent/model from span metadata, cost table on Live page

### Phase 3 — Security & Alerts (Weeks 9-12)
- [x] Security classifier pipeline (BullMQ worker): enrichment + security workers with regex detection
  - [x] Prompt injection detection (regex patterns for common injection phrases)
  - [x] PII detection (regex patterns for SSN, email, credit card, phone)
  - [x] Sensitive data flagging in tool call args/responses — flags shown inline in waterfall + span detail panel
- [x] Security dashboard: summary cards (total/by-flag), trend chart, findings table with flag filter, tool access matrix
- [x] Alert engine: rule DSL with CRUD API (`error_rate > 5% for 5m`), 60s eval loop, webhook + Slack dispatch, cooldown
- [x] Audit log: immutable append-only ClickHouse table (365d TTL), API with pagination, CSV export
- [x] Tool access matrix UI: agent × tool grid showing call count, errors, avg latency

### Phase 4 — Polish & Community (Weeks 13-16)
- [x] Python SDK (`panopticon-py`) with LangChain callback handler + CrewAI `instrument_crew` wrapper
- [x] Trace comparison — side-by-side diff page with span matching, duration deltas, NEW badges
- [x] Dashboard: dark/light theme toggle (persisted), keyboard shortcuts (⌘1-8 navigation), shortcut hints in sidebar
- [x] Helm chart — API, dashboard, worker deployments + services, ingress, configurable values for replicas/resources/infra
- [x] Documentation site (Astro Starlight) — guides, SDK docs, integration docs, deployment docs, API reference
- [x] GitHub: README ✅, LICENSE (Apache-2.0) ✅, CONTRIBUTING.md ✅, issue templates (bug + feature) ✅
- [x] Demo environment with sample agents + MCP servers — `demo/` dir with seed.ts, sdk-example.ts, walkthrough.md

---

## Appendix: Detection Algorithms — Finding Agents & MCP Servers Gone Bad

Panopticon uses a **multi-layer detection pipeline** that operates at three time scales: real-time (per-span, on ingestion), periodic (60-second evaluation loop), and on-demand (dashboard queries). Below is the exact algorithm for each layer.

---

### Layer 1 — Per-Span Security Classification (Real-Time)

**Trigger:** Every span batch ingested via `POST /v1/traces` enqueues a BullMQ job on the `security-classification` queue. The security worker processes each span asynchronously.

**File:** `apps/api/src/workers/index.ts` — `securityWorker`

#### Algorithm

```
for each span in batch:
  text = concat(span.input, " ", span.output)   // both fields, space-joined

  flags = []

  // ── Prompt Injection Detection ──
  // Test text against 8 regex patterns (case-insensitive):
  if text matches ANY of:
    /ignore (all |previous |your )?instructions/i
    /you are now/i
    /disregard (the |your )?(system )?prompt/i
    /jailbreak/i
    /do not follow/i
    /override (all |any )?restrictions/i
    /pretend (you are|to be)/i
    /new instructions:/i
  then:
    flags.push('prompt_injection')

  // ── PII Detection ──
  // Test text against 4 regex patterns:
  if text matches ANY of:
    /\b\d{3}-\d{2}-\d{4}\b/               → SSN  (e.g. 123-45-6789)
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i  → Email
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/     → Credit card (16 digits)
    /\b(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/  → Phone number
  then:
    flags.push('pii_detected')

  // ── Persist ──
  if flags.length > 0:
    UPDATE panopticon.spans
    SET security_flags = flags
    WHERE span_id = span.span_id
```

**Key behavior:**
- **No-op if clean:** Spans with no matches are untouched (the worker skips them).
- **Overwrites existing flags:** The UPDATE replaces `security_flags` entirely, so the worker is the source of truth for detected flags. Flags set by the SDK at ingestion time are preserved only if the worker also detects them.
- **Concatenation:** Both `input` and `output` are scanned. A prompt injection in the output (e.g., an LLM echoing an attack) is also flagged.

---

### Layer 2 — MCP Metadata Enrichment (Real-Time)

**Trigger:** Same ingestion path, but on the `span-enrichment` BullMQ queue.

**File:** `apps/api/src/workers/index.ts` — `enrichmentWorker`

#### Algorithm

```
for each span in batch:
  if span.span_type NOT IN ('mcp_request', 'resource_read'):
    skip

  if span.metadata already contains 'mcpMethod':
    skip   // already enriched (e.g., by SDK)

  enriched = {}

  // ── Parse MCP method from span name ──
  // Format: "tools/call:write_file" or "resources/read"
  if span.name contains ':':
    enriched.mcpMethod = name[0..colonIdx]     // e.g. "tools/call"
    enriched.toolName  = name[colonIdx+1..]    // e.g. "write_file"
  else if span.name starts with 'tools/' or 'resources/' or 'prompts/':
    enriched.mcpMethod = span.name

  // ── Extract resource URI from input ──
  input = JSON.parse(span.input)
  if input.uri exists:
    enriched.resourceUri = input.uri
  if input.tool exists and toolName not yet set:
    enriched.toolName = input.tool

  // ── Persist ──
  if enriched has keys:
    merged = { ...existing_metadata, ...enriched }
    UPDATE panopticon.spans
    SET metadata = JSON(merged)
    WHERE span_id = span.span_id
```

**Why this matters for "gone bad" detection:** The enriched `mcpServer`, `toolName`, and `mcpMethod` fields are what the topology graph, tool access matrix, and MCP server auto-discovery queries key on. Without enrichment, rogue MCP behavior wouldn't show up in the topology.

---

### Layer 3 — Alert Evaluation Engine (60-Second Loop)

**Trigger:** `setInterval` every 60 seconds + once on startup after 5 seconds.

**File:** `apps/api/src/workers/index.ts` — `runAlertEvaluationLoop()`

#### Algorithm

```
every 60 seconds:
  rules = SELECT * FROM alert_rules WHERE enabled = true

  for each rule:
    // ── Cooldown Check ──
    if rule.last_fired_at exists:
      elapsed = (now - last_fired_at) in seconds
      if elapsed < rule.cooldown_seconds:
        skip   // suppress duplicate alerts

    // ── Evaluate Metric ──
    value = query_metric(rule.condition.metric, rule.project_id, rule.condition.window_minutes)

    // ── Comparison ──
    fired = OPERATOR_FN[rule.condition.operator](value, rule.condition.threshold)

    if NOT fired:
      continue

    // ── Dispatch ──
    for each channel in rule.channels:
      if channel.type == 'webhook':
        POST channel.url { alert, project_id, condition, current_value, fired_at }
      if channel.type == 'slack':
        POST channel.url { text: "🚨 Alert: ..." }

    // ── Record ──
    UPDATE alert_rules SET last_fired_at = NOW() WHERE id = rule.id
    INSERT INTO panopticon.audit_log { event_type: 'alert_fired', details: { metric, value, threshold } }
```

#### Supported Metrics (ClickHouse Queries)

| Metric | SQL | What It Catches |
|--------|-----|-----------------|
| `error_rate` | `round(countIf(status = 'error') / count() * 100, 2)` | Agent producing too many errors (bad tool calls, crashes) |
| `error_count` | `countIf(status = 'error')` | Absolute error volume spike |
| `latency_p95` | `quantile(0.95)(duration_ms)` | MCP server or LLM gone slow (timeouts, overload) |
| `security_flags` | `count() WHERE length(security_flags) > 0` | Any security incident (injection, PII leak, etc.) |

All queries are scoped to `project_id` and a configurable sliding window (default 5 min).

#### Comparison Operators

| Operator | Function |
|----------|----------|
| `gt` | `value > threshold` |
| `lt` | `value < threshold` |
| `gte` | `value >= threshold` |
| `lte` | `value <= threshold` |
| `eq` | `value === threshold` |

---

### Layer 4 — Security Dashboard Queries (On-Demand)

**File:** `apps/api/src/routes/security.ts`

These are the queries the dashboard executes when a user views the Security page.

#### 4a. Security Summary (`GET /v1/security/summary`)

```sql
-- Counts by flag type with blast radius
SELECT
  arrayJoin(security_flags) AS flag,
  count() AS total,
  uniq(trace_id) AS affected_traces,
  uniq(agent_id) AS affected_agents
FROM panopticon.spans
WHERE project_id = :projectId
  AND length(security_flags) > 0
  AND start_time >= now() - INTERVAL :windowMinutes MINUTE
GROUP BY flag
ORDER BY total DESC
```

**What this reveals:** Which type of "gone bad" is most prevalent, how many traces are tainted, and which agents are involved.

#### 4b. Security Trend (`GET /v1/security/summary`)

```sql
-- Hourly trend of flagged spans
SELECT
  toStartOfHour(start_time) AS hour,
  count() AS flagged_count,
  countIf(has(security_flags, 'prompt_injection')) AS injection_count,
  countIf(has(security_flags, 'pii_detected')) AS pii_count
FROM panopticon.spans
WHERE project_id = :projectId
  AND length(security_flags) > 0
  AND start_time >= now() - INTERVAL :windowMinutes MINUTE
GROUP BY hour
ORDER BY hour ASC
```

**What this reveals:** Whether security incidents are increasing, clustered in time (indicating an active attack), or resolved.

#### 4c. Security Findings (`GET /v1/security/findings`)

```sql
-- Paginated list of flagged spans, optionally filtered by flag type
SELECT trace_id, span_id, agent_id, span_type, name, status,
       start_time, duration_ms, security_flags, metadata
FROM panopticon.spans
WHERE project_id = :projectId
  AND length(security_flags) > 0
  [AND has(security_flags, :flag)]   -- optional filter
ORDER BY start_time DESC
LIMIT :limit OFFSET :offset
```

**What this reveals:** The exact spans where something went wrong — drill down to see the prompt that was injected, the PII that was leaked, or the tool that was misused.

#### 4d. Tool Access Matrix (`GET /v1/security/tool-matrix`)

```sql
-- Agent × Tool grid with error rates
SELECT
  agent_id,
  name AS tool_name,
  span_type,
  count() AS call_count,
  countIf(status = 'error') AS error_count,
  round(avg(duration_ms), 2) AS avg_duration_ms,
  max(start_time) AS last_used
FROM panopticon.spans
WHERE project_id = :projectId
  AND span_type IN ('tool_call', 'mcp_request', 'resource_read')
  AND start_time >= now() - INTERVAL :windowMinutes MINUTE
GROUP BY agent_id, tool_name, span_type
ORDER BY call_count DESC
LIMIT 200
```

**What this reveals:** Which agent is calling which tool, how often, with what error rate. An agent suddenly calling a tool it never used before (or an MCP tool with a high error rate) is a signal.

---

### Layer 5 — Topology & MCP Server Auto-Discovery (On-Demand)

**File:** `apps/api/src/routes/topology.ts`

#### 5a. Topology Graph (`GET /v1/topology`)

```sql
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
WHERE project_id = :projectId
  AND start_time >= now() - INTERVAL :windowMinutes MINUTE
GROUP BY agent_id, span_type, name, mcp_server, tool_name
ORDER BY call_count DESC
LIMIT 500
```

Then the API builds a **force-directed graph** with 4 node types:
- `agent` — from `agent_id`
- `mcp_server` — from `metadata.mcpServer`
- `tool` — from `metadata.toolName` (connected to its MCP server)
- `llm` — from span name when `span_type = 'llm_call'`

Each edge carries `callCount`, `avgMs`, and `errors`. **A red edge (high error count) or a new unexpected edge is how you visually spot an agent or MCP server gone bad.**

#### 5b. MCP Server Auto-Discovery (`GET /v1/topology/mcp-servers`)

```sql
SELECT
  JSONExtractString(metadata, 'mcpServer') AS server_name,
  count() AS total_calls,
  max(start_time) AS last_seen,
  countIf(status = 'error') AS error_count,
  groupUniqArray(JSONExtractString(metadata, 'toolName')) AS tools
FROM panopticon.spans
WHERE project_id = :projectId
  AND JSONExtractString(metadata, 'mcpServer') != ''
GROUP BY server_name
ORDER BY last_seen DESC
```

Results are **upserted into Postgres** (`mcp_servers` table) with status `'active'`, creating a live registry. This is how Panopticon discovers MCP servers without manual configuration — any server name appearing in span metadata is automatically registered.

---

### Layer 6 — Aggregate Health Metrics (On-Demand)

**File:** `apps/api/src/routes/traces.ts`

#### 6a. Project Metrics (`GET /v1/traces/metrics`)

```sql
SELECT
  count() AS total_spans,
  countIf(status = 'error') AS error_count,
  round(countIf(status = 'error') / count() * 100, 2) AS error_rate,
  round(avg(duration_ms), 2) AS avg_duration_ms,
  quantile(0.5)(duration_ms) AS p50_duration_ms,
  quantile(0.95)(duration_ms) AS p95_duration_ms,
  quantile(0.99)(duration_ms) AS p99_duration_ms,
  uniq(trace_id) AS unique_traces,
  uniq(agent_id) AS unique_agents
FROM panopticon.spans
WHERE project_id = :projectId
  AND start_time >= now() - INTERVAL :windowMinutes MINUTE
```

#### 6b. Time-Series Buckets (`GET /v1/traces/timeseries`)

```sql
SELECT
  toStartOfInterval(start_time, INTERVAL :bucketMinutes MINUTE) AS bucket,
  count() AS span_count,
  countIf(status = 'error') AS error_count,
  round(avg(duration_ms), 2) AS avg_duration_ms,
  quantile(0.95)(duration_ms) AS p95_duration_ms,
  uniq(trace_id) AS trace_count
FROM panopticon.spans
WHERE project_id = :projectId
  AND start_time >= now() - INTERVAL :windowMinutes MINUTE
GROUP BY bucket
ORDER BY bucket ASC
```

**What this reveals:** Dashboard overview charts. A spike in `error_count` or `p95_duration_ms` in a specific time bucket is the first visual signal that something has gone wrong.

---

### Detection Flow Summary

```
  Span Ingested (POST /v1/traces)
        │
        ├──▶ ClickHouse INSERT (persisted)
        ├──▶ Redis XADD (real-time SSE feed)
        │
        ├──▶ BullMQ: span-enrichment
        │     └── Parse MCP metadata → UPDATE metadata
        │
        └──▶ BullMQ: security-classification
              └── Regex scan input+output → UPDATE security_flags
                    ├── prompt_injection (8 patterns)
                    └── pii_detected (4 patterns)

  Every 60 seconds (Alert Eval Loop)
        │
        ├── Load enabled rules from Postgres
        ├── For each rule: query ClickHouse metric in sliding window
        ├── Compare value vs threshold using operator
        ├── If fired + past cooldown:
        │     ├── Dispatch webhook / Slack
        │     ├── Update last_fired_at
        │     └── Write audit_log entry
        └── Skip if within cooldown

  Dashboard Queries (user-initiated)
        │
        ├── Security: summary, trend, findings, tool access matrix
        ├── Topology: force graph (agent↔MCP↔tool), MCP auto-discovery
        ├── Metrics: error_rate, latency percentiles, unique agents
        └── Timeseries: bucketed charts for visual anomaly detection
```

---

## Phase 5 — LLM Integration: Panopticon as an Intelligent Observer

### Motivation

Panopticon has always **observed** LLM-powered agents — now it **uses** LLM intelligence itself to elevate every pillar:

| Capability | Before (Regex / Static) | After (LLM-Powered) |
|------------|------------------------|---------------------|
| Security Classification | 12 regex patterns (8 injection, 4 PII) | Semantic analysis: catches obfuscated attacks, novel patterns, severity reasoning |
| Trace Understanding | Manual span-by-span inspection | One-click root cause analysis with summary, impact, recommendation |
| Data Exploration | Build ClickHouse filters by hand | Natural language → SQL with auto-execution |
| Trace Summarization | None | Auto-generated one-liner per trace |

### Architecture

```
                         ┌─────────────────────┐
                         │  LLM Provider        │
                         │  OpenAI / Anthropic   │
                         │  / Ollama (local)     │
                         └──────▲──▲──▲─────────┘
                                │  │  │
              ┌─────────────────┘  │  └──────────────────┐
              │                    │                      │
   ┌──────────┴───────┐  ┌───────┴────────┐  ┌──────────┴──────────┐
   │ security-classify │  │ trace-analysis │  │ nl-query (API)      │
   │ (worker, async)   │  │ (on-demand)    │  │ (sync, JSON)        │
   └──────────────────┘  └────────────────┘  └─────────────────────┘
```

**Provider abstraction** (`apps/api/src/llm/provider.ts`):
- Supports OpenAI, Anthropic, and Ollama (OpenAI-compatible)
- Configured via env: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- Ollama runs fully local — no API key needed
- Graceful fallback: all features work without LLM (regex-only security, no analysis)

### Feature 1 — Semantic Security Classifier

**File:** `apps/api/src/llm/security.ts`

**Strategy:** Regex-first, LLM-second (hybrid)

```
classify(input, output, spanType):
  1. Run regex patterns (fast, free, always available)
     → If prompt_injection found by regex, return immediately (high confidence)
  2. If LLM is configured:
     → Send {spanType, input[0:2000], output[0:2000]} to LLM
     → LLM returns: { flags[], severity, reasoning }
  3. Merge results: union of flags, max severity
  4. Store severity + reasoning in span metadata
```

**LLM classifies 5 threat categories** (vs 2 for regex):
- `prompt_injection` — including obfuscated, encoded, multi-language
- `pii_detected` — with context awareness (test vs production)
- `sensitive_data` — API keys, secrets, credentials, internal URLs
- `data_exfiltration` — attempts to extract system prompts, training data
- `privilege_escalation` — unauthorized tool/resource access attempts

**Severity levels:** critical → high → medium → low → none

### Feature 2 — Trace Root Cause Analysis

**File:** `apps/api/src/llm/analysis.ts`

**Endpoint:** `POST /v1/ai/traces/:traceId/analyze`

```
analyzeTrace(spans):
  1. Build indented span tree from parent_span_id relationships
  2. For error/flagged spans, include truncated input/output
  3. Include metadata summary (model, mcpServer, toolName, cost)
  4. Send tree to LLM with analysis prompt
  5. LLM returns: { summary, rootCause, impact, recommendation, severity }
  6. Cache result in panopticon.trace_analysis (ReplacingMergeTree)
  7. Return to dashboard for display
```

**Example output:**
```json
{
  "summary": "Coder agent attempted file write via filesystem-mcp but hit a permission error",
  "rootCause": "The filesystem-mcp server's Docker volume mount is read-only for /etc paths",
  "impact": "Code generation task failed — user saw an error in the IDE",
  "recommendation": "Update docker-compose volume mount to allow writes to the target directory",
  "severity": "medium"
}
```

**Dashboard integration:** "Analyze with AI" button on trace detail page, results shown in a violet-themed panel with severity badge.

### Feature 3 — Natural Language Query

**File:** `apps/api/src/llm/query.ts`

**Endpoint:** `POST /v1/query`

```
translateQuery(question, projectId):
  1. Send question + full ClickHouse schema to LLM
  2. LLM generates parameterized SQL with {projectId: String}
  3. Safety checks:
     - Must start with SELECT
     - Reject DROP, DELETE, ALTER, INSERT, UPDATE, CREATE, TRUNCATE
     - Reject multi-statement queries (;)
  4. Execute query against ClickHouse
  5. Return: { sql, description, results, count }
```

**Dashboard page:** `/ask` — chat-like interface with:
- Example question buttons for discovery
- Conversation history with question/response pairs
- Collapsible SQL viewer per response
- Results rendered as a data table (max 50 rows displayed)

### Feature 4 — Trace Summarization (future)

Auto-generated one-liner for each trace in the trace list. Runs as a low-priority worker job on ingestion. Stored alongside the trace for instant display.

### Configuration

Add to `.env`:
```
LLM_PROVIDER=openai          # openai | anthropic | ollama
LLM_API_KEY=sk-...           # not needed for Ollama
LLM_MODEL=gpt-4o-mini        # auto-selected if unset
LLM_BASE_URL=                 # e.g. http://ollama:11434/v1
```

### New Files

```
apps/api/src/llm/
  ├── provider.ts    — LLM provider abstraction (OpenAI, Anthropic, Ollama)
  ├── security.ts    — Semantic security classifier (hybrid regex+LLM)
  ├── analysis.ts    — Trace root cause analysis
  ├── query.ts       — Natural language → ClickHouse SQL
  └── index.ts       — Re-exports

apps/api/src/routes/query.ts   — POST /v1/query, POST /v1/ai/traces/:traceId/analyze
apps/dashboard/src/app/ask/    — Ask AI page (NL query interface)
```

### New ClickHouse Table

```sql
CREATE TABLE panopticon.trace_analysis (
  trace_id        String,
  project_id      String,
  summary         String,
  root_cause      String,
  impact          String,
  recommendation  String,
  severity        String,
  model           String,
  created_at      DateTime64(3)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (project_id, trace_id)
TTL toDateTime(created_at) + INTERVAL 30 DAY
```

### Key Design Decisions

1. **Graceful degradation** — Everything works without an LLM. Regex security classification, manual trace inspection, and hand-built queries remain fully functional. LLM features are additive.

2. **Hybrid security** — Regex runs first (fast, free). LLM runs second only when configured and when regex didn't already find a high-confidence match. Results are merged (union of flags, max severity).

3. **Safety-first NL query** — Generated SQL is validated before execution: SELECT-only, no mutations, no multi-statement. The LLM prompt includes the exact schema to minimize hallucination.

4. **Provider-agnostic** — OpenAI, Anthropic, and Ollama supported through a single abstraction. Ollama enables fully local, air-gapped deployment with no external API calls.

5. **Cost-conscious** — Small models (gpt-4o-mini, claude-3.5-haiku) are the defaults. Input is truncated (2000 chars per field). Max output tokens are capped per feature (256 for security, 512 for analysis).

### Phase 5b — Per-Project LLM Configuration & Local Ollama Support

#### User-Provided LLM Keys

Users can bring their own LLM API keys on a **per-project** basis. Configuration is done in Settings → LLM Configuration.

**Config resolution order** (highest wins):
1. Per-project settings (stored in `projects.settings.llm` JSONB in Postgres)
2. Server-level environment variables (`LLM_PROVIDER`, `LLM_API_KEY`, etc.)
3. Built-in defaults

**Data model** — the `projects.settings` JSONB column now supports:
```json
{
  "retentionDays": 30,
  "llm": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini",
    "baseUrl": ""
  }
}
```

**API endpoints:**
- `GET /v1/projects/:id/settings` — retrieve project settings
- `PUT /v1/projects/:id/settings` — partial-merge update; API key is masked in responses

**Security:** API keys are stored in the project's JSONB settings. In API responses, keys are masked (`sk-proj-...****abcd`). The raw key is only used server-side when making LLM API calls.

**Provider flow:**
```
resolveConfig(projectId):
  1. Read projects.settings.llm from Postgres
  2. Merge with env-var defaults (project overrides env)
  3. Return full LLMConfig used by classify(), analyzeTrace(), translateQuery()
```

#### Local Ollama Support

Ollama runs on the **host machine** (not inside Docker). Containers reach it via `host.docker.internal`.

**Docker Compose changes:**
```yaml
api:
  extra_hosts:
    - "host.docker.internal:host-gateway"

worker:
  extra_hosts:
    - "host.docker.internal:host-gateway"
```

**Default Ollama URL:** `http://host.docker.internal:11434/v1`

This works on:
- **macOS** — `host.docker.internal` is natively supported by Docker Desktop
- **Linux** — `host-gateway` maps to the host's gateway IP (requires Docker 20.10+)
- **Windows** — `host.docker.internal` is natively supported by Docker Desktop

**No API key required** for Ollama — the `isLLMConfigured()` check passes when `provider === 'ollama'`.

#### Settings UI

The Settings page (`/settings`) now includes an LLM Configuration card with:
- **Provider selector** — 3-column card grid (OpenAI, Anthropic, Ollama)
- **API key input** — password field, hidden for Ollama
- **Model input** — with placeholder showing the default for the selected provider
- **Base URL input** — with Ollama-specific hint about `host.docker.internal`
- **Save button** — saves to `PUT /v1/projects/:id/settings`

#### Files Changed

```
apps/api/src/llm/provider.ts     — resolveConfig(), getProjectLLMSettings(), OLLAMA_DEFAULT_URL
apps/api/src/llm/security.ts     — classify() accepts optional LLMConfig
apps/api/src/llm/analysis.ts     — analyzeTrace() accepts optional LLMConfig
apps/api/src/llm/query.ts        — translateQuery() accepts optional LLMConfig
apps/api/src/routes/projects.ts   — GET/PUT /:id/settings endpoints
apps/api/src/routes/query.ts     — Uses resolveConfig(projectId) before LLM calls
apps/api/src/workers/index.ts    — project_id in SpanData, resolveConfig per batch
apps/dashboard/src/lib/api.ts    — fetchProjectSettings(), updateProjectSettings()
apps/dashboard/src/app/settings/  — Full LLM config form
docker-compose.yml               — extra_hosts on api + worker
```

---

## Phase 7 — Missing Features Report

Gap analysis of the current platform, grouped by impact.

### High Impact — Differentiation

- **Human Feedback / Annotations** — No way to attach thumbs-up/down or labels to traces. Table stakes for LLM observability. Enables quality scoring, RLHF data collection, and filtering by human judgment.
- **Evaluations (Evals)** — No automated quality scoring on agent outputs (correctness, hallucination detection, tool-use accuracy). Pairs naturally with the existing LLM integration layer.
- **Prompt Registry & Versioning** — No prompt management. Can't version, diff, or A/B test system prompts. Link traces to prompt versions to detect quality regressions.

### Medium Impact — Platform Maturity

- **Session / User Tracking** — ~~No end-user session concept grouping multiple traces.~~ **DONE**: Added `session_id` + `end_user_id` columns to ClickHouse spans, updated shared types/schemas, span ingestion passes through session fields, new `/v1/sessions` API (list, detail, users/list), Sessions dashboard page with search/filter and session detail view with trace timeline. Sidebar nav item added.
- **Data Retention / TTL Policies** — ~~ClickHouse grows unbounded. No configurable retention, archival, or downsampling.~~ **DONE**: Per-project retentionDays (1-365) via Settings UI slider. Saves to Postgres and updates ClickHouse table-level TTL (max across projects). Per-project query-time filtering on trace list. Storage stats card (size, spans, traces, oldest span).
- **RBAC / Multi-Team** — ~~Single API key per project, no role-based access, no org/team model.~~ **DONE**: Full RBAC system with user registration/login (JWT), dual-mode auth (API key + Bearer token), 4-tier roles (owner/admin/member/viewer), team management UI in settings. Backward compatible — existing API-key-only setups still work.
- **Export & Integrations** — No OTLP export, no Grafana datasource, no PagerDuty/Opsgenie for alerts.

### Quick Wins — Polish

- **Saved Filters / Search** — ~~Trace list needs saved views, full-text search across span content, and bookmarks.~~ **DONE**: Traces page now has a search bar (trace ID), expandable filter panel (status, agent, min duration). API supports `status`, `agent_id`, `search`, `min_duration_ms` query params.
- **Agent Performance Trends** — ~~Dashboard shows point-in-time metrics but no time-series trends.~~ **DONE**: Dashboard home now shows 7-day trend charts (throughput, error rate, latency) using 6-hour buckets via the existing timeseries API.
- **Cost Budgets & Projections** — ~~Live page shows token costs but no budget alerts, per-agent cost breakdown, or spend projection.~~ **DONE**: Live page cost panel now includes summary cards (24h spend, tokens, projected monthly, LLM calls), per-agent breakdown with percentage share bars.

#### Files Changed (Quick Wins)

```
apps/api/src/routes/traces.ts         — Added server-side filtering (status, agent_id, search, min_duration_ms)
apps/dashboard/src/lib/api.ts         — TraceFilters interface, updated fetchTraces()
apps/dashboard/src/app/traces/page.tsx — Search bar + collapsible filter panel UI
apps/dashboard/src/app/page.tsx        — 7-day trend charts (Recharts AreaChart + LineChart)
apps/dashboard/src/app/live/page.tsx   — Cost summary cards + per-agent share breakdown
```

#### Files Changed (RBAC / Multi-Team)

```
apps/api/src/db/postgres.ts              — Added users + project_members tables
apps/api/src/routes/auth.ts              — NEW: /auth/register, /auth/login, /auth/me (JWT)
apps/api/src/middleware/auth.ts           — Dual-mode: x-api-key OR Authorization: Bearer JWT
apps/api/src/middleware/rbac.ts           — NEW: requireRole() guard (owner > admin > member > viewer)
apps/api/src/routes/projects.ts          — Team CRUD: GET/POST/PUT/DELETE /:id/members, auto-owner on create
apps/api/src/index.ts                    — Registered /auth routes (public)
apps/dashboard/src/lib/auth.tsx          — NEW: AuthProvider context (JWT session, login/register/logout)
apps/dashboard/src/lib/api.ts            — Added auth + member management API helpers
apps/dashboard/src/components/app-shell.tsx — NEW: Auth gate (JWT OR legacy API-key access)
apps/dashboard/src/app/login/page.tsx    — NEW: Login/register page with mode toggle
apps/dashboard/src/components/sidebar.tsx — User footer with avatar + logout button
apps/dashboard/src/app/settings/page.tsx — Team management card (list, add, role change, remove)
apps/dashboard/src/app/layout.tsx        — Wrapped with AuthProvider + AppShell
docker-compose.yml                       — Added JWT_SECRET env var
.env.example                             — Documented JWT_SECRET
```

#### Files Changed (Data Retention / TTL Policies)

```
apps/api/src/routes/projects.ts          — Added GET /:id/storage (stats) + PUT /:id/retention (TTL update)
apps/api/src/routes/traces.ts            — getRetentionDays() helper, query-time retention filter on trace list
apps/dashboard/src/lib/api.ts            — Added fetchStorageStats(), updateRetention(), StorageStats type
apps/dashboard/src/app/settings/page.tsx — Data Retention & Storage card (stats grid, slider, save)
```

#### Files Changed (Session / User Tracking)

```
apps/api/src/db/clickhouse.ts              — Added session_id + end_user_id columns (CREATE + ALTER)
packages/shared/src/types.ts               — Added sessionId, endUserId to Span, SpanInput, Trace
packages/shared/src/schemas.ts             — Added sessionId, endUserId to spanInputSchema
apps/api/src/routes/traces.ts              — Pass session_id, end_user_id through on ingestion
apps/api/src/routes/sessions.ts            — NEW: GET / (list), GET /:sessionId (detail), GET /users/list
apps/api/src/index.ts                      — Registered /v1/sessions route + auto-init schema on startup
apps/dashboard/src/lib/api.ts              — Added session API helpers + types
apps/dashboard/src/app/sessions/page.tsx   — NEW: Sessions list + detail page
apps/dashboard/src/components/sidebar.tsx  — Added Sessions nav item
```

#### Ask AI Guardrails

Strong 3-layer guardrail system added to the Ask AI (natural language → SQL) feature:

**Layer 1 — Input Guardrails (pre-LLM)**
- 500 character limit (client + server)
- 25+ prompt injection patterns (jailbreak, DAN, "ignore instructions", "reveal system prompt", template injection `${}` / `{{}}`, code execution)
- Off-topic rejection (poems, jokes, hacking, password generation)
- Encoded payload detection (base64 blobs, long hex strings)

**Layer 2 — Output Guardrails (post-LLM SQL validation)**
- Table whitelist: only `panopticon.spans`, `panopticon.audit_log`, `panopticon.trace_analysis`
- Function whitelist: ~100 known-safe ClickHouse functions; unknown functions blocked
- 16 forbidden DDL/DML keywords (DROP, DELETE, ALTER, INSERT, UPDATE, CREATE, TRUNCATE, GRANT, REVOKE, ATTACH, DETACH, RENAME, OPTIMIZE, KILL, SYSTEM, SET)
- Dangerous pattern blocking: INTO OUTFILE, file(), url(), s3(), remote(), cluster(), system.*, information_schema.*, SQL comments, hex strings, char(), UNION injection with non-panopticon tables
- Mandatory project_id filter (prevents cross-project data access)
- Row limit: max 1000, default 100 auto-appended
- Subquery depth limit: max 3 nested SELECTs

**Layer 3 — Rate Limiting**
- 10 queries per minute per project (sliding window, in-memory)
- Returns HTTP 429 with clear message

**UI**
- "Guardrails active" badge with ShieldCheck icon
- Character counter (turns amber at 450/500)

#### Files Changed (Ask AI Guardrails)

```
apps/api/src/llm/query.ts              — Complete rewrite: 3-layer guardrails (input validation, SQL whitelist, limit enforcement)
apps/api/src/routes/query.ts           — Added per-project rate limiter (10/min sliding window)
apps/dashboard/src/app/ask/page.tsx    — Guardrails badge, character counter, maxLength enforcement
```
