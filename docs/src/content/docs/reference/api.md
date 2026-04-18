---
title: REST API
description: Panopticon API endpoint reference
---

# REST API Reference

Base URL: `http://localhost:4400` (default)

All endpoints require the `x-api-key` header with a valid project API key.

---

## Ingestion

### `POST /v1/traces`

Ingest spans from an SDK.

**Body:**
```json
{
  "projectId": "my-project",
  "spans": [
    {
      "traceId": "abc123",
      "spanId": "span1",
      "parentSpanId": null,
      "agentId": "my-agent",
      "spanType": "llm_call",
      "name": "gpt-4o",
      "status": "ok",
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-01-01T00:00:01.000Z",
      "durationMs": 1000,
      "input": { "prompt": "Hello" },
      "output": { "response": "Hi" },
      "metadata": {},
      "securityFlags": []
    }
  ]
}
```

---

## Traces

### `GET /v1/traces`

List traces for a project.

| Param | Type | Description |
|-------|------|-------------|
| `project_id` | string | Required |
| `limit` | number | Default 50, max 200 |
| `offset` | number | Default 0 |

### `GET /v1/traces/:traceId`

Get all spans for a trace.

### `GET /v1/traces/metrics`

Aggregated metrics.

| Param | Type | Description |
|-------|------|-------------|
| `project_id` | string | Required |
| `window_minutes` | number | Default 1440 (24h) |

---

## Live

### `GET /v1/live/stream`

SSE endpoint for real-time span updates.

| Param | Type | Description |
|-------|------|-------------|
| `project_id` | string | Required |

### `GET /v1/live/timeseries`

Time-series data for charts.

| Param | Type | Description |
|-------|------|-------------|
| `project_id` | string | Required |
| `window_minutes` | number | Default 60 |

### `GET /v1/live/costs`

Token usage and cost breakdown by agent/model.

### `GET /v1/live/topology`

Agent-to-server topology graph data.

### `GET /v1/live/mcp-servers`

List registered MCP servers.

---

## Security

### `GET /v1/security/findings`

Flagged spans with security issues.

| Param | Type | Description |
|-------|------|-------------|
| `project_id` | string | Required |
| `flag` | string | Optional filter: `prompt_injection`, `pii_detected` |
| `limit` | number | Default 100, max 500 |
| `offset` | number | Default 0 |

### `GET /v1/security/summary`

Security flag counts and hourly trend.

### `GET /v1/security/tool-matrix`

Agent × tool usage matrix with call counts, errors, and latency.

---

## Alerts

### `GET /v1/alerts`

List alert rules for a project.

### `POST /v1/alerts`

Create an alert rule.

**Body:**
```json
{
  "project_id": "my-project",
  "name": "High error rate",
  "condition": {
    "metric": "error_rate",
    "operator": "gt",
    "threshold": 5,
    "window_minutes": 5
  },
  "channels": [
    { "type": "webhook", "url": "https://example.com/hook" }
  ]
}
```

**Metrics:** `error_rate`, `error_count`, `latency_p95`, `security_flags`
**Operators:** `gt`, `gte`, `lt`, `lte`, `eq`

### `PUT /v1/alerts/:id`

Update an alert rule (toggle enabled, rename, update condition/channels).

### `DELETE /v1/alerts/:id`

Delete an alert rule.

### `GET /v1/alerts/audit-log`

Query the audit log.

| Param | Type | Description |
|-------|------|-------------|
| `project_id` | string | Required |
| `limit` | number | Default 100, max 500 |
| `format` | string | `json` (default) or `csv` |

---

## Health

### `GET /health`

Returns `200 OK` if the API is running.
