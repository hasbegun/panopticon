# Panopticon Demo

An interactive demo that shows what Panopticon does: **trace AI agents, monitor MCP servers, detect security threats — in real time**.

The demo includes seed data, three sample agents, a live simulator, and an SDK example. Each one populates different parts of the dashboard so you can explore every feature.

---

## Prerequisites

- **Docker** with Compose v2 (Docker Desktop recommended)
- No other local dependencies needed

## Quick Start

```bash
# 1. Start the platform (API + Dashboard + Worker + DBs)
make dev-d

# 2. Seed demo data (22 traces, alerts, audit log, LLM settings)
make demo

# 3. Open the dashboard
open http://localhost:3000
```

Enter the demo project credentials when prompted:
- **Project ID:** `seed`
- **API Key:** `pan_seed_key_for_dev`

---

## What's in the Demo

### Seed Data (`make demo`)

Populates the dashboard with 55 minutes of historical data from a simulated DevOps AI assistant:

| What | Count | Purpose |
|---|---|---|
| **Traces** | 22 | End-to-end agent task executions |
| **Spans** | ~170 | Individual operations (LLM calls, MCP tools, agent steps) |
| **Agents** | 5 | planner, coder, reviewer, ops, security |
| **MCP Servers** | 4 | filesystem, github, k8s, slack |
| **LLM Models** | 3 | gpt-4o, claude-3.5-sonnet, gpt-4o-mini |
| **Alert Rules** | 3 | error rate, P95 latency, security flags |
| **Audit Log** | 5 | alert fired/resolved, settings changed |
| **Security Flags** | 8+ | injection, PII, secrets, exfiltration |

### Sample Agents (`make demo-agents`)

Three purpose-built agents that use the `@panopticon/sdk` to generate realistic traces:

#### Code Review Agent (`make demo-code-review`)
An AI code reviewer that fetches a GitHub PR, reads changed files via filesystem MCP, asks an LLM to review the code, and posts comments back to GitHub.

**What it shows:**
- Full trace tree: `agent_step` → `mcp_request` → `resource_read` → `llm_call` → `tool_call`
- Cross-MCP-server interaction (GitHub + filesystem)
- LLM cost tracking (token counts + cost)
- Waterfall visualization of the entire review pipeline

#### DevOps Agent (`make demo-devops`)
An AI deploy agent that deploys to staging (success), then attempts production (fails with OOMKilled), diagnoses with an LLM, rolls back, and alerts Slack.

**What it shows:**
- Multi-trace workflow (staging deploy + production rollback)
- Error handling and recovery logic
- LLM-driven decision making (diagnose → rollback)
- Cross-MCP interaction (K8s + Slack)
- Error spans visible in the trace waterfall

#### Security Scanner Agent (`make demo-security`)
An AI security scanner that scans config files for leaked secrets, audits data exports for PII, and blocks a prompt injection attempt.

**What it shows:**
- Security flag categories: `sensitive_data`, `pii_detected`, `prompt_injection`, `unauthorized_access`
- How Panopticon's regex classifier auto-detects SSNs, emails, and injection patterns
- Security dashboard findings with severity levels
- Audit trail for blocked threats

### Live Simulator (`make demo-live`)

A continuous loop (~2 min) that generates randomized traces in real time. Feeds the Live Monitoring page with fresh SSE data for throughput charts, latency graphs, and the topology view.

### SDK Example (`make demo-sdk`)

Shows how to integrate `@panopticon/sdk` into your own agent. Three traces: happy path, tool failure + recovery, PII detection.

---

## How to Run Each Demo

All commands assume the platform is running (`make dev-d`).

```bash
# Seed historical data (run once)
make demo

# Run all 3 sample agents
make demo-agents

# Run agents individually
make demo-code-review
make demo-devops
make demo-security

# Start live simulator (real-time SSE data for ~2 min)
make demo-live

# Run SDK example
make demo-sdk

# Reset everything and re-seed
make demo-reset
```

---

## Verifying Features

After running the demo, here's exactly what to check on each dashboard page:

### 1. Overview (Home)

**URL:** `http://localhost:3000`

- **6 stat cards** — total traces, spans, error rate, avg latency, active agents, active MCP servers
- All numbers should be non-zero after seeding

**Verify:** Stat cards show data. Error rate is >0% (there are intentional errors in the demo).

### 2. Traces

**URL:** `http://localhost:3000/traces`

- **Trace list** with 22+ entries showing agent, status, duration, span count
- Click any trace to see the **waterfall visualization** — a timeline of every span
- Expand spans to see input/output, metadata, LLM token counts
- Error traces have red status badges
- Security-flagged spans have a shield icon

**Verify:** Click "deploy-production-fail" trace → see the error span in red → expand it to see the OOMKilled output. Click a security-flagged trace → see the shield icon on the flagged span.

### 3. Live Monitoring

**URL:** `http://localhost:3000/live`

- Run `make demo-live` first, then open this page
- **Real-time charts** — throughput, error rate, latency (P50/P95/P99)
- **Cost tracking** — per-model LLM cost breakdown
- Data updates via SSE (no refresh needed)

**Verify:** Charts animate and update every few seconds while the live simulator runs.

### 4. Topology

**URL:** `http://localhost:3000/topology`

- **D3 force graph** showing agents ↔ MCP servers ↔ tools
- 5 agent nodes, 4 MCP server nodes, tool/resource connections
- Hover for connection stats (call count, error rate)

**Verify:** See `code-review-agent` connected to `github-mcp` and `filesystem-mcp`. See `devops-agent` connected to `k8s-mcp` and `slack-mcp`.

### 5. Security

**URL:** `http://localhost:3000/security`

- **Summary cards** — total flagged spans, by category, by severity
- **Trend chart** — security events over time
- **Findings table** — each flagged span with its flags, severity, and trace link
- **Tool access matrix** — which agents called which MCP tools

**Verify:** See entries for `prompt_injection`, `pii_detected`, `sensitive_data`, `unauthorized_access`. Click a finding to jump to the trace detail.

### 6. Alerts

**URL:** `http://localhost:3000/alerts`

- **3 alert rules** — error rate threshold, P95 latency, security flag count
- **Audit log** — 5 entries showing alert triggers and resolutions

**Verify:** See all 3 rules listed. Audit log shows timestamped entries.

### 7. Compare

**URL:** `http://localhost:3000/compare`

- Select any two traces to diff side-by-side
- Compare waterfall timelines, span counts, durations

**Verify:** Compare "deploy-staging" vs "deploy-production-fail" to see the differences.

### 8. Settings

**URL:** `http://localhost:3000/settings`

- **LLM configuration** — provider, model, API key, base URL
- Only populated if you set `LLM_PROVIDER` in `.env` (see below)

**Verify:** Form reflects whatever you configured in `.env`.

### 9. Ask AI

**URL:** `http://localhost:3000/ask`

- Natural language query interface for your trace data
- Requires a configured LLM provider (see below)

**Verify:** With an LLM configured, try: "Show me all traces with errors in the last hour"

---

## LLM Configuration

LLM features (semantic security, trace analysis, natural language query) are **optional**. Configure them in your `.env` file:

```bash
# Copy the example if you haven't already
cp .env.example .env
```

Then uncomment **one** provider block in `.env`:

```bash
# ── OpenAI ──
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# ── Anthropic ──
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-3-5-haiku-20241022

# ── Ollama (local, no API key needed) ──
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
LLM_BASE_URL=http://host.docker.internal:11434/v1
```

After editing `.env`, restart the services:

```bash
make dev-d
```

When no `LLM_PROVIDER` is set, security classification falls back to regex (still functional, just less nuanced). The Ask AI and Analyze features will be unavailable.

---

## API Verification (curl)

You can also verify directly via the API:

```bash
# Health check
curl http://localhost:4400/health

# List traces
curl -s http://localhost:4400/v1/traces?project_id=seed \
  -H "x-api-key: pan_seed_key_for_dev" | python3 -m json

# Get metrics
curl -s http://localhost:4400/v1/traces/metrics?project_id=seed \
  -H "x-api-key: pan_seed_key_for_dev" | python3 -m json

# Security summary
curl -s http://localhost:4400/v1/security?project_id=seed \
  -H "x-api-key: pan_seed_key_for_dev" | python3 -m json

# Topology graph
curl -s http://localhost:4400/v1/topology?project_id=seed \
  -H "x-api-key: pan_seed_key_for_dev" | python3 -m json

# Alert rules
curl -s http://localhost:4400/v1/alerts?project_id=seed \
  -H "x-api-key: pan_seed_key_for_dev" | python3 -m json
```

---

## UI Demo Walkthrough (5 minutes)

A scripted walkthrough you can use to present Panopticon to others. Open `http://localhost:3000` and follow the steps below.

> **Tip:** Use keyboard shortcuts `⌘1` through `⌘9` to jump between pages instantly.

### Setup (30s)

1. Open the dashboard — the **Project Setup Banner** appears at the top
2. Enter **Project ID:** `seed` and **API Key:** `pan_seed_key_for_dev`
3. The banner disappears and the Dashboard page populates with live metrics

**Talking point:** *"Zero config — agents send spans via one API call. The dashboard connects to any project by ID."*

### Act 1: The Big Picture (60s)

**Dashboard** (`/` or `⌘1`)
- Point out the 6 stat cards: Traces, Spans, Agents, Error Rate, Avg Latency, P99 Latency
- Note the error rate — "we have some failures, let's investigate"

**Topology** (`/topology` or `⌘4`)
- A force-directed graph shows agents (planner, coder, reviewer, ops, security) connected to MCP servers (filesystem, github, k8s, slack)
- Drag nodes around to explore the graph
- "This is auto-discovered from span data — no configuration needed. You instantly see which agents talk to which tools."

### Act 2: Tracing Deep Dive (90s)

**Traces** (`/traces` or `⌘2`)
- Show the list of ~22 traces with agent names, durations, span counts, status badges
- Click **"prompt-injection-blocked"** — this opens the trace detail with waterfall view
- Walk through the span tree: `agent_step → llm_call` with a red error badge and security flag
- "Every span is clickable — you see input, output, metadata, timing, and security flags inline"

- Go back, click **"deploy-staging"** — a successful multi-step trace
- Show the full tree: `agent_step → mcp_request (k8s) → tool_call (kubectl) → llm_call`
- "This is the full reasoning chain — not just LLM calls. You see why the agent chose kubectl and what it returned."

**Compare** (`/compare` or `⌘5`)
- Select **"deploy-staging"** and **"deploy-production-fail"**
- Show the side-by-side diff: same agent, different outcomes
- "Instant diff — you can compare any two traces to find what changed. Great for debugging regressions."

### Act 3: Live Monitoring (60s)

> **Before this step:** Run `make demo-live` in a separate terminal

**Live** (`/live` or `⌘3`)
- Real-time charts animate: throughput, latency, error rate
- The **live span feed** at the bottom scrolls with incoming spans (SSE-powered)
- Cost tracking table shows token usage per model
- "This is true real-time — no polling. Spans appear within 1 second of ingestion via Server-Sent Events."

### Act 4: Security (45s)

**Security** (`/security` or `⌘6`)
- Show the security flags summary: prompt injection, PII detected, sensitive data, unauthorized access
- Point out the flagged spans with severity levels
- "Security classification runs at ingestion time — hybrid regex + LLM. Catches prompt injection, leaked secrets, PII. All without any agent-side configuration."

### Act 5: Alerts (30s)

**Alerts** (`/alerts` or `⌘7`)
- Show the 3 pre-configured alert rules: error rate > 10%, P95 latency > 5s, any security flags
- "Define rules with a simple DSL. They evaluate continuously and dispatch to Slack or webhooks with configurable cooldowns."

### Closing (30s)

**Settings** (`/settings` or `⌘9`)
- Show the LLM configuration panel (if configured)
- "LLM features are optional and pluggable — OpenAI, Anthropic, or Ollama for fully local operation"

**Key differentiators to emphasize:**
- First-class MCP protocol awareness (not just LLM calls)
- Agent-rooted traces (full reasoning chains)
- Security built-in at the platform level
- True real-time monitoring (SSE, not polling)
- 100% open source, runs locally, no cloud dependency

---

## Why This Demo Matters

Panopticon solves a problem that existing tools (Langfuse, LangSmith, Arize) don't:

| Gap | How Panopticon fills it |
|---|---|
| **MCP-blind** | First-class MCP protocol awareness — `tools/call`, `resources/read` are parsed and displayed with server/tool metadata, enabling the topology graph |
| **Agent-blind** | Traces are rooted in agent steps, not just LLM calls. You see the full reasoning chain: why an agent chose a tool, how it recovered from failure |
| **No security** | Built-in hybrid regex + LLM security classification. Detects prompt injection, PII, secrets, and data exfiltration at ingestion time |
| **No real-time** | SSE-based live monitoring with per-second throughput, latency percentiles, and cost tracking |
| **No local LLM** | Ollama support out of the box — run AI features (analysis, NL query, security classification) without sending data to cloud APIs |

---

## File Overview

```
demo/
├── README.md                  ← this file
├── seed.ts                    ← historical data seeder (make demo)
├── live-agent.ts              ← real-time trace simulator (make demo-live)
├── sdk-example.ts             ← SDK usage example (make demo-sdk)
├── Dockerfile                 ← container for seed + live-agent
├── sdk.Dockerfile             ← container for sdk-example (builds SDK)
├── agents.Dockerfile          ← container for sample agents (builds SDK)
└── agents/
    ├── code-review-agent.ts   ← PR review workflow (make demo-code-review)
    ├── devops-agent.ts        ← deploy + rollback (make demo-devops)
    └── security-scanner-agent.ts  ← secrets/PII/injection (make demo-security)
```

---

## Troubleshooting

**"API not reachable"** — The platform needs ~15s to start. All demo scripts auto-retry for up to 60s.

**"BullMQ maxRetriesPerRequest"** — Already fixed. If you see this, rebuild: `make dev-d`.

**Dashboard shows no data** — Make sure you entered Project ID `seed` and API Key `pan_seed_key_for_dev` in the setup banner.

**Live page is empty** — Run `make demo-live` while viewing the Live page. Data streams via SSE in real time.

**Agents fail to build** — The agent scripts require the SDK. They use `agents.Dockerfile` which builds `packages/shared` and `packages/sdk` first.
