---
title: Quick Start
description: Get Panopticon running in under 5 minutes
---

# Quick Start

## Prerequisites

- Docker & Docker Compose
- Node.js 18+ or Bun (for SDK development)

## 1. Clone & Start

```bash
git clone https://github.com/hasbegun/panopticon.git
cd panopticon
cp .env.example .env
make up
```

This starts all services:
- **API** → `http://localhost:4400`
- **Dashboard** → `http://localhost:3000`
- **ClickHouse** → `localhost:8123`
- **PostgreSQL** → `localhost:5432`
- **Redis** → `localhost:6379`

## 2. Send Your First Trace

### TypeScript

```bash
npm install @panopticon/sdk
```

```typescript
import { Panopticon } from '@panopticon/sdk';

const pan = new Panopticon({
  endpoint: 'http://localhost:4400',
  apiKey: 'pan_dev_key',
  projectId: 'my-project',
});

const trace = pan.startTrace({ agentId: 'my-agent' });
const span = trace.startSpan({ type: 'llm_call', name: 'gpt-4o' });
span.setInput({ prompt: 'Hello, world!' });
span.setOutput({ response: 'Hi there!' });
span.end();
trace.end();

await pan.flush();
```

### Python

```bash
pip install panopticon-py
```

```python
from panopticon import Panopticon, SpanType

pan = Panopticon(
    endpoint="http://localhost:4400",
    api_key="pan_dev_key",
    project_id="my-project",
)

with pan.start_trace(agent_id="my-agent") as trace:
    with trace.start_span(SpanType.LLM_CALL, "gpt-4o") as span:
        span.set_input({"prompt": "Hello, world!"})
        span.set_output({"response": "Hi there!"})

pan.shutdown()
```

## 3. View in Dashboard

Open `http://localhost:3000`, enter your project ID and API key in Settings, and navigate to **Traces** to see your first trace.

## Next Steps

- [Architecture overview](/guides/architecture/)
- [TypeScript SDK reference](/sdks/typescript/)
- [Python SDK reference](/sdks/python/)
- [Deploy to Kubernetes](/deployment/kubernetes/)
