---
title: TypeScript SDK
description: Instrument your TypeScript/Node.js agents with Panopticon
---

# TypeScript SDK

## Installation

```bash
npm install @panopticon/sdk
```

## Basic Usage

```typescript
import { Panopticon } from '@panopticon/sdk';

const pan = new Panopticon({
  endpoint: 'http://localhost:4400',
  apiKey: 'pan_...',
  projectId: 'my-project',
  batchSize: 100,       // optional, default 100
  flushIntervalMs: 5000, // optional, default 5000
  debug: false,          // optional
});

const trace = pan.startTrace({ agentId: 'my-agent' });
const span = trace.startSpan({ type: 'llm_call', name: 'gpt-4o' });
span.setInput({ prompt: 'Hello' });
span.setOutput({ response: 'Hi!' });
span.end();
trace.end();

await pan.shutdown(); // flushes remaining spans
```

## MCP Client Instrumentation

The SDK can wrap MCP clients to automatically trace `callTool`, `readResource`, and `getPrompt`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const mcpClient = new Client({ name: 'my-client', version: '1.0' });
const instrumented = pan.instrumentMCP(mcpClient, { serverName: 'my-mcp-server' });

// All MCP calls are now automatically traced
const result = await instrumented.callTool({ name: 'search', arguments: { q: 'test' } });
```

## Span Types

| Type | Description |
|------|-------------|
| `agent_step` | High-level agent reasoning step |
| `llm_call` | LLM API call |
| `tool_call` | Tool invocation |
| `mcp_request` | MCP server request |
| `resource_read` | MCP resource read |

## API Reference

### `Panopticon`
- `startTrace(options)` — Start a new trace
- `instrumentMCP(client, options?)` — Wrap MCP client
- `flush()` — Manually flush spans
- `shutdown()` — Stop timer and flush
- `pendingSpans` — Number of buffered spans

### `Trace`
- `startSpan(options)` — Create a child span
- `end()` — End the trace

### `Span`
- `setInput(data)` / `setOutput(data)` — Set I/O
- `setMetadata(key, value)` — Attach metadata
- `setStatus(status)` — Set span status
- `end()` — Complete the span
