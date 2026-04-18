---
title: Architecture
description: How Panopticon is structured
---

# Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Your Agent  │────▶│  Panopticon  │────▶│  ClickHouse  │
│  (SDK)       │     │  API (Hono)  │     │  (spans)     │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────┴───────┐
                     │    Redis     │
                     │  (Streams +  │
                     │   BullMQ)    │
                     └──────┬───────┘
                            │
                     ┌──────┴───────┐     ┌──────────────┐
                     │   Workers    │     │  PostgreSQL   │
                     │ (enrich,     │────▶│ (projects,    │
                     │  security,   │     │  alert rules, │
                     │  alerts)     │     │  MCP servers) │
                     └──────────────┘     └──────────────┘
```

## Data Flow

1. **SDK sends spans** to `POST /v1/traces` with project API key
2. **API ingests** spans into ClickHouse and publishes to Redis Streams
3. **Workers** pick up spans from BullMQ queues for:
   - **Enrichment** — MCP metadata extraction, server registry upsert
   - **Security classification** — regex-based prompt injection and PII detection
   - **Alert evaluation** — periodic rule evaluation against ClickHouse metrics
4. **Dashboard** queries API for traces, metrics, live updates (SSE), security findings, and alerts
5. **Audit log** entries are written to ClickHouse on alert fires and admin actions

## Storage

| Store | Data | Retention |
|-------|------|-----------|
| ClickHouse | Spans, audit log | 90d spans, 365d audit |
| PostgreSQL | Projects, API keys, alert rules, MCP servers | Permanent |
| Redis | Real-time streams, job queues | Capped / ephemeral |

## Deployment Options

- **Docker Compose** — development and small deployments
- **Kubernetes (Helm)** — production with autoscaling, ingress, and PVCs
