# Panopticon

**Open-source observability platform for AI agents and MCP servers.**

Trace agent reasoning chains, monitor real-time health, and detect security threats — with first-class [Model Context Protocol](https://modelcontextprotocol.io/) awareness.

> **Container-first** — Everything runs in Docker. No local Node/Bun/npm required.

## Features

- **Tracing** — Full span trees from agent reasoning → LLM calls → MCP tool invocations
- **Live Monitoring** — Real-time dashboards, agent ↔ MCP topology graph, cost tracking
- **Security** — Prompt injection detection, PII flagging, audit trails, tool access matrix
- **MCP-Native** — Understands `tools/call`, `resources/read`, `prompts/get` at the protocol level

## Quick Start

**Prerequisites:** [Docker](https://www.docker.com/) with Compose v2 — that's it.

```bash
git clone <repo> && cd panopticon
cp .env.example .env
make dev
```

Services start at:
- **API** → `http://localhost:4400`
- **Dashboard** → `http://localhost:3000`

Run migrations on first launch:
```bash
make migrate
```

## Makefile Commands

```
make help           Show all available commands
make dev            Start dev mode (hot-reload via volume mounts)
make dev-d          Start dev mode (detached)
make up             Start production stack
make down           Stop all services
make logs           Tail all logs
make migrate        Run DB migrations inside API container
make test           Run tests inside containers
make lint           Lint + typecheck inside containers
make status         Show container status
make health         Check health of all services
make shell-api      Open shell in API container
make shell-db       Open psql shell
make shell-ch       Open clickhouse-client shell
make shell-redis    Open redis-cli
make clean          Stop and remove volumes
make nuke           Remove everything (volumes, images)
```

## Architecture

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
```

| Container | Role |
|-----------|------|
| **api** | Hono API (Bun) — ingestion, auth, project CRUD |
| **dashboard** | Next.js 15 — traces, live monitoring, topology, security |
| **worker** | BullMQ jobs — enrichment, classification, alerts |
| **postgres** | Config DB — projects, MCP registry, alert rules |
| **clickhouse** | Trace storage — spans, high-cardinality queries |
| **redis** | Real-time pub/sub + job queue |

## Instrument Your Agent

```bash
npm install @panopticon/sdk
```

```typescript
import { Panopticon } from '@panopticon/sdk';

const pan = new Panopticon({
  endpoint: 'http://localhost:4400',
  apiKey: 'pan_...',  // from POST /v1/projects
  projectId: 'my-project',
});

const trace = pan.startTrace({ agentId: 'my-agent' });
const span = trace.startSpan({ type: 'llm_call', name: 'gpt-4o' });
span.setInput(prompt);
const result = await llm.complete(prompt);
span.setOutput(result);
span.end();
trace.end();
await pan.flush();
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (Postgres, ClickHouse, Redis) |
| POST | `/v1/projects` | Create a new project |
| GET | `/v1/projects` | List projects |
| POST | `/v1/traces` | Ingest span batch |
| GET | `/v1/traces?project_id=...` | List traces |
| GET | `/v1/traces/:traceId` | Get trace with all spans |
| GET | `/v1/traces/metrics?project_id=...` | Span-level metrics |

## Project Structure

```
panopticon/
├── apps/
│   ├── api/                 # Hono backend (Bun) + Dockerfile
│   └── dashboard/           # Next.js 15 dashboard + Dockerfile
├── packages/
│   ├── sdk/                 # @panopticon/sdk (TypeScript)
│   └── shared/              # Shared types, schemas, constants
├── docker-compose.yml       # Production base (6 services)
├── docker-compose.dev.yml   # Dev overlay (volume mounts, hot-reload)
├── Makefile                 # All commands — the developer interface
├── .env.example             # Environment config template
└── package.json             # Turborepo workspace root
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
