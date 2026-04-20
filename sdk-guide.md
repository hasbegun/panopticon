# @panopticon/sdk — Developer Guide

> **Package:** `@panopticon/sdk` (`packages/sdk/`)
> **Runtime:** Bun ≥ 1.1 or Node ≥ 20 (ESM)
> **Version:** 0.1.0

---

## Why the SDK Exists

Panopticon's backend stores and queries traces — but it has no way to *collect* them unless something sends data to `POST /v1/traces`. That "something" is the SDK.

### The problem it solves

Without the SDK, a developer who wants to observe their AI agent would need to:

1. Manually construct JSON payloads that match the `SpanBatch` schema
2. Track span IDs, parent IDs, trace IDs, and timestamps by hand
3. Implement batching and retry logic so network issues don't crash the agent
4. Handle the buffer lifecycle (start timer, flush on shutdown)

That's ~200 lines of boilerplate before the first span is sent. The SDK packages all of it into a 3-class API: `Panopticon` (client), `Trace`, and `Span`.

### What it enables in the platform

Every feature in the Panopticon dashboard and API depends on spans being in ClickHouse. The SDK is the only production path to get them there:

```
Your agent code
     │
     │  pan.startTrace() / span.end()
     ▼
@panopticon/sdk
     │
     │  POST /v1/traces   (batched, with API key)
     ▼
Panopticon API  ──►  ClickHouse
     │
     ▼
Dashboard: trace list, waterfall, metrics, security flags, topology
```

Without the SDK (or a raw HTTP equivalent), the dashboard shows nothing.

---

## Architecture: How the SDK Works Internally

### Three classes

```
Panopticon (client)
├── config: endpoint, apiKey, projectId, batchSize, flushIntervalMs
├── buffer: SpanData[]            ← in-memory, appended on span.end()
├── flushTimer: setInterval       ← periodic flush (default every 5s)
│
├── startTrace(options) → Trace
│     └── Trace
│           ├── traceId: string   ← auto-generated (timestamp+random+counter)
│           ├── agentId: string
│           ├── spans: Span[]
│           │
│           └── startSpan(options) → Span
│                 └── Span
│                       ├── spanId: string   ← auto-generated
│                       ├── startTime        ← captured at construction
│                       ├── setInput()
│                       ├── setOutput()
│                       ├── setStatus()
│                       ├── setMetadata()
│                       ├── addSecurityFlag()
│                       ├── recordError()
│                       └── end()            ← captures endTime + durationMs,
│                                               calls onEnd → enqueueSpan
└── flush()   ← swaps buffer, POSTs to API, re-enqueues on error
```

### ID generation

IDs are generated in `trace.ts` using a counter + timestamp + random segment:

```
{Date.now().toString(36)}-{Math.random().toString(36).slice(2,10)}-{counter.toString(36)}
```

Example: `mo41k1d2-dxqf7e2k-1`

This is collision-resistant for single-process use but not globally unique across distributed deployments. For distributed agents, pass your own `traceId` to the `Trace` constructor (third arg, currently not exposed via `startTrace` — planned for v0.2).

### Buffer and flush lifecycle

```
span.end()
  │
  ▼
enqueueSpan(spanData)
  │
  ├─ push to buffer[]
  │
  └─ if buffer.length >= batchSize  →  flush() [fire-and-forget]

setInterval(flush, flushIntervalMs)  →  periodic flush

shutdown()
  │
  ├─ clearInterval(flushTimer)
  └─ flush()  [awaited — final drain]
```

**Retry behaviour:** If `flush()` throws (network error, API down), the batch is re-prepended to `buffer` via `unshift()` so spans are not lost. The next periodic flush will retry them.

**Defaults:**
- `batchSize`: `100` spans (from `DEFAULT_BATCH_THRESHOLD` in `@panopticon/shared`)
- `flushIntervalMs`: `5000` ms (from `DEFAULT_FLUSH_INTERVAL_MS`)

---

## Installation

```bash
# In your agent project (Bun)
bun add @panopticon/sdk

# In your agent project (npm / Node)
npm install @panopticon/sdk
```

The package ships compiled ESM (`dist/index.js`) with TypeScript declarations (`dist/index.d.ts`). No build step needed in the consumer project.

---

## Configuration Reference

### `new Panopticon(config: PanopticonConfig)`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `endpoint` | `string` | ✅ | — | Base URL of the Panopticon API, e.g. `http://localhost:4400`. Trailing slash is stripped automatically. |
| `apiKey` | `string` | ✅ | — | Project API key (`pan_...`). Sent as `x-api-key` header on every flush. |
| `projectId` | `string` | ✅ | — | Project identifier. All spans are associated with this project in ClickHouse. |
| `batchSize` | `number` | ❌ | `100` | Auto-flush when the buffer reaches this many spans. |
| `flushIntervalMs` | `number` | ❌ | `5000` | Flush the buffer every N milliseconds regardless of size. |
| `debug` | `boolean` | ❌ | `false` | Log `[panopticon] flushing N spans` / `flushed N spans successfully` to stdout. Useful during development. |

```typescript
import { Panopticon } from '@panopticon/sdk';

const pan = new Panopticon({
  endpoint: process.env.PANOPTICON_URL ?? 'http://localhost:4400',
  apiKey:   process.env.PANOPTICON_API_KEY!,
  projectId: 'my-agent-project',
  batchSize: 50,          // flush when 50 spans accumulate
  flushIntervalMs: 3000,  // also flush every 3s
  debug: process.env.NODE_ENV !== 'production',
});
```

---

## Core API

### `pan.startTrace(options: TraceOptions): Trace`

Creates a new `Trace` — one trace = one end-to-end agent invocation.

| Field | Type | Required | Description |
|---|---|---|---|
| `agentId` | `string` | ✅ | Identifies the agent (e.g. `"research-agent"`, `"coder-agent"`). All spans in this trace inherit this value. |
| `metadata` | `Record<string, unknown>` | ❌ | Arbitrary trace-level metadata (currently stored per-span, reserved for future trace header). |

```typescript
const trace = pan.startTrace({ agentId: 'planner-agent' });
console.log(trace.traceId); // e.g. "mo41k1d2-dxqf7e2k-1"
```

---

### `trace.startSpan(options: SpanOptions): Span`

Creates a new `Span` within the trace. `startTime` is captured at the moment this is called — so call it at the beginning of the operation you're measuring.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `SpanType` | ✅ | One of the five span types (see below). |
| `name` | `string` | ✅ | Human-readable label shown in the dashboard (e.g. `"gpt-4o"`, `"tools/call:write_file"`). |
| `parentSpanId` | `string` | ❌ | `spanId` of the parent span. Omit for root spans. Used to build the waterfall tree. |
| `metadata` | `Partial<SpanMetadata>` | ❌ | Initial metadata. Can be extended later with `setMetadata()`. |

```typescript
// Root span — no parentSpanId
const root = trace.startSpan({ type: 'agent_step', name: 'plan-task' });

// Child span — parentSpanId links it to root in the waterfall
const llm = trace.startSpan({
  type: 'llm_call',
  name: 'gpt-4o',
  parentSpanId: root.spanId,
});
```

**Throws** if called after `trace.end()`.

---

### Span methods (all return `this` for chaining)

#### `span.setInput(input: unknown): this`

Records what was sent into the operation. Accepts any JSON-serialisable value.

```typescript
span.setInput({ prompt: 'Summarise this document', temperature: 0.7 });
span.setInput({ tool: 'write_file', path: 'src/auth.ts', content: '...' });
span.setInput({ uri: 'file:///docs/api.md' });
```

Stored as a JSON string in ClickHouse `input` column. Rendered in the span detail panel in the dashboard.

#### `span.setOutput(output: unknown): this`

Records what came back from the operation.

```typescript
span.setOutput({ response: 'Here is the summary...', finishReason: 'stop' });
span.setOutput({ success: true, bytesWritten: 4210 });
span.setOutput(null); // explicitly null for timed-out / blocked calls
```

#### `span.setStatus(status: 'ok' | 'error' | 'timeout'): this`

Overrides the status. Default is `'ok'`. `recordError()` sets it to `'error'` automatically.

```typescript
span.setStatus('timeout'); // for operations that exceeded a deadline
```

#### `span.setMetadata(metadata: Partial<SpanMetadata>): this`

Merges additional metadata into the span. Metadata has both well-known fields (used by the dashboard for cost/latency breakdowns) and arbitrary extension fields via `[key: string]: unknown`.

**Well-known fields:**

| Field | Type | Used for |
|---|---|---|
| `model` | `string` | LLM model name — e.g. `"gpt-4o"`, `"claude-3.5-sonnet"` |
| `provider` | `string` | LLM provider — e.g. `"openai"`, `"anthropic"` |
| `inputTokens` | `number` | Tokens in the prompt — used for cost tracking |
| `outputTokens` | `number` | Tokens in the completion — used for cost tracking |
| `totalTokens` | `number` | Sum (optional if `inputTokens` + `outputTokens` already set) |
| `cost` | `number` | Estimated cost in USD — used for budget dashboards |
| `mcpServer` | `string` | MCP server name — e.g. `"filesystem-mcp"`, `"slack-mcp"` |
| `mcpMethod` | `string` | MCP protocol method — e.g. `"tools/call"`, `"resources/read"` |
| `toolName` | `string` | Name of the tool invoked — e.g. `"write_file"`, `"search_files"` |
| `resourceUri` | `string` | URI of the resource accessed — e.g. `"file:///docs/api.md"` |

```typescript
// LLM call — cost tracking fields
span.setMetadata({
  model: 'gpt-4o',
  provider: 'openai',
  inputTokens: 245,
  outputTokens: 312,
  cost: 0.0071,
});

// MCP request — server + method fields
span.setMetadata({
  mcpServer: 'filesystem-mcp',
  mcpMethod: 'tools/call',
  toolName: 'write_file',
});

// Extension fields — anything extra
span.setMetadata({
  retryAttempt: 2,
  cacheHit: false,
  region: 'us-east-1',
});
```

Calls to `setMetadata()` are **merged** (shallow), not replaced:
```typescript
span.setMetadata({ model: 'gpt-4o' });
span.setMetadata({ inputTokens: 100 }); // model is still set
```

#### `span.addSecurityFlag(flag: SecurityFlag): this`

Tags the span with a security classification. The same flag is never added twice.

| Flag | Meaning |
|---|---|
| `'prompt_injection'` | Input contains an attempt to override system instructions |
| `'pii_detected'` | Input or output contains personally identifiable information (email, SSN, phone, etc.) |
| `'sensitive_data'` | Credentials, API keys, secrets, or confidential business data |
| `'unauthorized_access'` | Agent attempted to call a tool or resource it is not permitted to use |
| `'rate_limit_exceeded'` | Provider or internal rate limit was hit |

```typescript
if (containsPII(prompt)) {
  span.addSecurityFlag('pii_detected');
}
if (isInjectionAttempt(prompt)) {
  span.addSecurityFlag('prompt_injection');
  span.setStatus('error');
}
```

Security flags are stored in the ClickHouse `security_flags Array(String)` column and surfaced in the Security dashboard (Phase 3).

#### `span.recordError(error: Error | string): this`

Sets `status` to `'error'` and writes `error.message` and `error.stack` into `metadata`:

```typescript
try {
  result = await callLLM(prompt);
} catch (err) {
  span.recordError(err as Error); // sets status='error', stores message+stack
  span.setOutput(null);
}
span.end(); // always end, even on error
```

Internally stores:
```json
{
  "metadata": {
    "error": "Request timed out after 30000ms",
    "errorStack": "Error: Request timed out...\n    at ..."
  }
}
```

#### `span.end(): void`

**Must be called** to commit the span. This captures `endTime` (ISO 8601), computes `durationMs = endTime - startTime`, and enqueues the span in the client buffer.

Calling `end()` more than once is safe — subsequent calls are no-ops.

```typescript
const span = trace.startSpan({ type: 'tool_call', name: 'run-tests' });
span.setInput({ command: 'bun test' });
try {
  const out = await runCommand('bun test');
  span.setOutput({ exitCode: 0, stdout: out });
} catch (err) {
  span.recordError(err as Error);
} finally {
  span.end(); // always in finally — never skip this
}
```

**Read-only properties:**
- `span.spanId: string` — use this to set `parentSpanId` on child spans
- `span.traceId: string`
- `span.isEnded: boolean`

---

### `trace.end(): void`

Marks the trace as ended. Any spans that were started but not yet ended are automatically ended (their `durationMs` will reflect time to `trace.end()` being called). After calling `trace.end()`, calling `startSpan()` throws.

```typescript
trace.end();
// spans still in buffer — not yet sent. Call pan.flush() or wait for timer.
```

**Read-only properties:**
- `trace.traceId: string`
- `trace.isEnded: boolean`
- `trace.spanCount: number`

---

### `pan.flush(): Promise<void>`

Manually drains the buffer immediately. The buffer is swapped atomically — spans added during the in-flight request go into a fresh buffer and are sent on the next flush.

```typescript
// At the end of a serverless function / request handler:
await pan.flush();
```

On failure, the batch is put back at the front of the buffer and the error is re-thrown.

---

### `pan.shutdown(): Promise<void>`

Stops the periodic flush timer and performs a final `flush()`. Call this when the process is shutting down.

```typescript
process.on('SIGTERM', async () => {
  await pan.shutdown();
  process.exit(0);
});
```

**Important:** In serverless or short-lived processes, `shutdown()` (or `flush()`) must be called explicitly — the interval timer will not fire if the process exits first.

---

### `pan.pendingSpans: number`

Returns the current number of spans waiting in the buffer.

```typescript
console.log(`${pan.pendingSpans} spans pending`);
```

---

## Span Types — When to Use Each

### `agent_step`

**Purpose:** The root span of a trace, or a major reasoning/orchestration step. Represents the agent itself deciding what to do.

**Pattern:** Create one as the root, then nest all other work as children with `parentSpanId`.

```typescript
const agentSpan = trace.startSpan({
  type: 'agent_step',
  name: 'research-task',
});

// ... all work happens as children ...

agentSpan.setOutput({ result: '...', stepsCompleted: 4 });
agentSpan.end();
trace.end();
```

**Typical fields:** `input` = task description, `output` = final result or summary.

---

### `llm_call`

**Purpose:** Any call to a language model — `generateText`, `streamText`, `chat.completions.create`, etc.

**Pattern:** Wrap the actual LLM API call. Capture `inputTokens`, `outputTokens`, `cost`.

```typescript
const llmSpan = trace.startSpan({
  type: 'llm_call',
  name: 'gpt-4o',                    // model name as the span name
  parentSpanId: agentSpan.spanId,
});
llmSpan.setInput({ prompt, systemPrompt, temperature: 0.7 });

const response = await openai.chat.completions.create({ ... });

llmSpan
  .setOutput({ response: response.choices[0].message.content })
  .setMetadata({
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    cost: (response.usage.prompt_tokens * 0.000005) + (response.usage.completion_tokens * 0.000015),
  })
  .end();
```

**Dashboard uses:** Latency breakdown (how much time the LLM takes vs other work), cost per model/provider, error rate by model.

---

### `mcp_request`

**Purpose:** Any call to an MCP server via `Client.callTool()` or `Client.getPrompt()`. Specifically for operations that *mutate state* or *invoke actions* (as opposed to `resource_read` which is read-only).

**Pattern:** Use `mcpServer`, `mcpMethod` (`tools/call` or `prompts/get`), and `toolName`.

```typescript
const mcpSpan = trace.startSpan({
  type: 'mcp_request',
  name: 'write-auth-file',           // descriptive name
  parentSpanId: agentSpan.spanId,
});
mcpSpan.setInput({ tool: 'write_file', path: 'src/auth.ts', content: '...' });

try {
  const result = await mcpClient.callTool({ name: 'write_file', arguments: { ... } });
  mcpSpan
    .setOutput({ success: true, result: result.content })
    .setMetadata({
      mcpServer: 'filesystem-mcp',
      mcpMethod: 'tools/call',
      toolName: 'write_file',
    })
    .end();
} catch (err) {
  mcpSpan.recordError(err as Error).end();
}
```

**Dashboard uses:** MCP server topology (which agents call which MCP servers), tool call frequency and error rates, MCP server health.

---

### `tool_call`

**Purpose:** Invocations of local tools — shell commands, code execution, browser control, custom functions — that are NOT going through the MCP protocol.

**Pattern:** Use `toolName` in metadata. Input = the command/args, output = result/exit code.

```typescript
const toolSpan = trace.startSpan({
  type: 'tool_call',
  name: 'run-test-suite',
  parentSpanId: agentSpan.spanId,
});
toolSpan.setInput({ command: 'bun test src/', timeout: 30000 });

const result = await execShell('bun test src/');

toolSpan
  .setOutput({ exitCode: result.code, stdout: result.stdout, stderr: result.stderr })
  .setMetadata({ toolName: 'shell_exec' });

if (result.code !== 0) {
  toolSpan.recordError(`Test suite failed with exit code ${result.code}`);
}
toolSpan.end();
```

**Dashboard uses:** Tool execution latency, tool failure rates, which tools agents use most.

---

### `resource_read`

**Purpose:** Read-only access to resources via `Client.readResource()`. Does not mutate state — just fetches data (files, database rows, API responses, embeddings).

**Pattern:** Use `resourceUri` and `mcpServer`.

```typescript
const readSpan = trace.startSpan({
  type: 'resource_read',
  name: 'read-api-docs',
  parentSpanId: agentSpan.spanId,
});
readSpan.setInput({ uri: 'file:///docs/api-reference.md' });

const content = await mcpClient.readResource({ uri: 'file:///docs/api-reference.md' });

readSpan
  .setOutput({ content: content.contents[0].text, bytes: content.contents[0].text.length })
  .setMetadata({
    mcpServer: 'filesystem-mcp',
    mcpMethod: 'resources/read',
    resourceUri: 'file:///docs/api-reference.md',
  })
  .end();
```

**Dashboard uses:** Resource access patterns, cache hit analysis, which documents/data sources agents rely on.

---

## Use Cases

### 1. Debugging a broken agent

An agent returns wrong results intermittently. Without observability you can't tell why.

With Panopticon:
1. Check the trace list: `GET /v1/traces?project_id=...` — look for `status: "error"` traces
2. Drill into a failing trace: `GET /v1/traces/{traceId}` — see the full span tree
3. Find the erroring span — its `metadata.error` has the exception message and stack
4. Compare `input` (what you sent) vs `output` (what came back) on the LLM span
5. If the LLM span shows a `timeout` status — the model took >30s, latency is the root cause

```typescript
// Instrument defensively so errors are always captured:
const span = trace.startSpan({ type: 'llm_call', name: model, parentSpanId: root.spanId });
span.setInput({ prompt, systemPrompt });
try {
  const out = await llm.generate(prompt);
  span.setOutput(out).setMetadata({ model, inputTokens: out.usage.input, outputTokens: out.usage.output });
} catch (err) {
  span.recordError(err as Error);
  span.setOutput(null);
} finally {
  span.end(); // always runs
}
```

**Expected output in API:**
```json
{
  "span_type": "llm_call",
  "name": "gpt-4o",
  "status": "error",
  "duration_ms": 30012,
  "metadata": "{\"model\":\"gpt-4o\",\"error\":\"Request timed out after 30000ms\",\"errorStack\":\"Error: ...\"}"
}
```

---

### 2. Cost tracking across agents

You have 5 agents running in production and want to know which one is spending the most on LLM calls.

Instrument every LLM call with `cost` in metadata, then query metrics:

```bash
curl "http://localhost:4400/v1/traces/metrics?project_id=prod&window_minutes=1440" \
  -H "x-api-key: pan_..."
```

**Expected output:**
```json
{
  "data": {
    "total_spans": "8420",
    "avg_duration_ms": 1240.5,
    "p50_duration_ms": 820,
    "p95_duration_ms": 4200,
    "p99_duration_ms": 29800,
    "unique_traces": "1203",
    "unique_agents": "5",
    "error_rate": 2.14
  }
}
```

> Cost aggregation by agent/model is a Phase 2 dashboard feature — the raw cost data is already in ClickHouse via `metadata`.

---

### 3. MCP server reliability monitoring

An MCP filesystem server occasionally returns errors. You want to know how often and which tool call fails.

```typescript
const span = trace.startSpan({ type: 'mcp_request', name: tool, parentSpanId: root.spanId });
span.setInput({ tool, arguments: args });
span.setMetadata({ mcpServer: serverName, mcpMethod: 'tools/call', toolName: tool });
try {
  const result = await mcpClient.callTool({ name: tool, arguments: args });
  span.setOutput(result.content);
} catch (err) {
  span.recordError(err as Error);
} finally {
  span.end();
}
```

Query all error spans for a specific MCP server by looking at traces where spans have `status: "error"` and `metadata.mcpServer: "filesystem-mcp"`. The **topology map** (Phase 2) will automatically group these by server.

---

### 4. Security: detecting prompt injection in production

A user-facing agent receives raw user input. You want to detect if users are trying to hijack the agent.

```typescript
function detectInjection(text: string): boolean {
  const patterns = [
    /ignore (all |previous |your )?instructions/i,
    /you are now/i,
    /disregard (the |your )?system prompt/i,
    /jailbreak/i,
  ];
  return patterns.some((p) => p.test(text));
}

const span = trace.startSpan({ type: 'llm_call', name: model, parentSpanId: root.spanId });
span.setInput({ prompt: userInput });

if (detectInjection(userInput)) {
  span.addSecurityFlag('prompt_injection');
  span.setStatus('error');
  span.setOutput(null);
  span.end();
  return { error: 'Request blocked' };
}

// ... continue with LLM call
```

**Expected span in API:**
```json
{
  "span_type": "llm_call",
  "status": "error",
  "security_flags": ["prompt_injection"],
  "input": "{\"prompt\":\"Ignore all instructions and...\"}",
  "output": "null"
}
```

The Security dashboard (Phase 3) surfaces all `security_flags` with timestamps, agent IDs, and trend charts.

---

### 5. PII protection and compliance

Before sending user data to an external LLM provider, detect and flag PII.

```typescript
function detectPII(text: string): boolean {
  const patterns = [
    /\b\d{3}-\d{2}-\d{4}\b/,                        // SSN
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,   // email
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/,      // credit card
    /\b(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/, // phone
  ];
  return patterns.some((p) => p.test(text));
}

const span = trace.startSpan({ type: 'llm_call', name: model, parentSpanId: root.spanId });
const hasPII = detectPII(prompt);
if (hasPII) {
  span.addSecurityFlag('pii_detected');
}
span.setInput({ prompt }); // still log it (for audit) — redaction is a separate feature
```

The `piiRedaction` project setting (Phase 1) will eventually auto-redact this before storage. The security flag is always stored regardless.

---

### 6. Latency profiling — finding the slow step

An agent's P95 latency is 8s. Where is the time going?

```typescript
// Start timing each step explicitly
const planSpan = trace.startSpan({ type: 'llm_call', name: 'plan', parentSpanId: root.spanId });
// ... plan call ... (2.1s)
planSpan.end();

const searchSpan = trace.startSpan({ type: 'mcp_request', name: 'vector-search', parentSpanId: root.spanId });
// ... search ... (5.3s) ← the bottleneck
searchSpan.end();

const synthSpan = trace.startSpan({ type: 'llm_call', name: 'synthesise', parentSpanId: root.spanId });
// ... synth ... (0.6s)
synthSpan.end();
```

In the trace waterfall, the `vector-search` span bar will be visually the longest. The span's `duration_ms: 5300` pinpoints the bottleneck immediately without guessing.

---

### 7. Serverless / edge functions

In serverless environments the process exits after the response is sent. You **must** flush before returning:

```typescript
export async function POST(req: Request) {
  const pan = new Panopticon({ ... });
  const trace = pan.startTrace({ agentId: 'api-agent' });

  // ... instrument the handler ...

  trace.end();
  await pan.shutdown(); // ← critical: flush before the function exits
  return Response.json({ ok: true });
}
```

Or reuse a module-level client and call `flush()` instead of `shutdown()` (so the timer keeps running across invocations in warm instances):

```typescript
// Module level — survives warm restarts
const pan = new Panopticon({ flushIntervalMs: 1000, ... });

export async function handler(event) {
  const trace = pan.startTrace({ agentId: 'edge-agent' });
  // ...
  trace.end();
  await pan.flush(); // flush, but don't stop the timer
}
```

---

## Expected Outputs

### What the SDK POSTs to the API

Every call to `flush()` sends one HTTP request:

```
POST /v1/traces
Content-Type: application/json
x-api-key: pan_seed_key_for_dev

{
  "projectId": "my-project",
  "spans": [
    {
      "traceId": "mo41k1d2-dxqf7e2k-1",
      "spanId": "mo41k1ex-abc123xy-2",
      "parentSpanId": null,
      "agentId": "research-agent",
      "spanType": "agent_step",
      "name": "research-query",
      "status": "ok",
      "startTime": "2026-04-18T07:00:00.000Z",
      "endTime": "2026-04-18T07:00:01.700Z",
      "durationMs": 1700,
      "input": { "query": "How does Vercel AI SDK handle streaming?" },
      "output": { "answer": "Use streamText()..." },
      "metadata": {},
      "securityFlags": []
    },
    {
      "traceId": "mo41k1d2-dxqf7e2k-1",
      "spanId": "mo41k1fy-def456gh-3",
      "parentSpanId": "mo41k1ex-abc123xy-2",
      "agentId": "research-agent",
      "spanType": "llm_call",
      "name": "gpt-4o",
      "status": "ok",
      "startTime": "2026-04-18T07:00:00.050Z",
      "endTime": "2026-04-18T07:00:00.670Z",
      "durationMs": 620,
      "input": { "prompt": "Plan research steps for..." },
      "output": { "response": "[LLM response...]" },
      "metadata": {
        "model": "gpt-4o",
        "provider": "openai",
        "inputTokens": 28,
        "outputTokens": 72,
        "cost": 0.0012
      },
      "securityFlags": []
    }
  ]
}
```

### API response on success

```
HTTP 202 Accepted

{ "data": { "ingested": 2 } }
```

### What gets stored in ClickHouse

Each span becomes one row in `panopticon.spans`:

| Column | Type | Value from example |
|---|---|---|
| `trace_id` | String | `mo41k1d2-dxqf7e2k-1` |
| `span_id` | String | `mo41k1fy-def456gh-3` |
| `parent_span_id` | String | `mo41k1ex-abc123xy-2` |
| `project_id` | String | `my-project` |
| `agent_id` | String | `research-agent` |
| `span_type` | String | `llm_call` |
| `name` | String | `gpt-4o` |
| `status` | String | `ok` |
| `start_time` | DateTime64(3) | `2026-04-18 07:00:00.050` |
| `end_time` | DateTime64(3) | `2026-04-18 07:00:00.670` |
| `duration_ms` | UInt32 | `620` |
| `input` | String (JSON) | `{"prompt":"Plan research..."}` |
| `output` | String (JSON) | `{"response":"[LLM response]"}` |
| `metadata` | String (JSON) | `{"model":"gpt-4o","inputTokens":28,...}` |
| `security_flags` | Array(String) | `[]` |

### What the trace list API returns

```
GET /v1/traces?project_id=my-project
x-api-key: pan_...

HTTP 200 OK
{
  "data": [
    {
      "trace_id": "mo41k1d2-dxqf7e2k-1",
      "project_id": "my-project",
      "agent_id": "research-agent",
      "trace_start": "2026-04-18 07:00:00.000",
      "trace_end": "2026-04-18 07:00:01.700",
      "duration_ms": "1700",
      "status": "ok",
      "span_count": "5"
    }
  ],
  "meta": { "limit": 50, "offset": 0 }
}
```

Note: `trace_start` = `min(start_time)` across all spans, `trace_end` = `max(end_time)`, `status` = `"error"` if any span has `status = 'error'`.

---

## Patterns and Best Practices

### Always end spans in `finally`

```typescript
const span = trace.startSpan({ ... });
try {
  // work
} catch (err) {
  span.recordError(err as Error);
} finally {
  span.end(); // ← never miss this, or the span never reaches ClickHouse
}
```

### One `Panopticon` client per process, not per request

```typescript
// ✅ Module-level singleton
const pan = new Panopticon({ ... });

// ❌ Don't create per-request — creates a new timer every time
app.post('/run', async (req, res) => {
  const pan = new Panopticon({ ... }); // wrong
});
```

### One trace per user request / agent invocation

```typescript
app.post('/ask', async (req, res) => {
  const trace = pan.startTrace({ agentId: 'qa-agent' }); // ← per request
  const root = trace.startSpan({ type: 'agent_step', name: 'answer-question' });
  // ...
  root.end();
  trace.end();
  // pan is shared — no flush needed here unless serverless
  res.json({ answer });
});
```

### Use `debug: true` in development

```typescript
const pan = new Panopticon({
  debug: process.env.NODE_ENV !== 'production',
  // ...
});
// Output: [panopticon] flushing 5 spans
//         [panopticon] flushed 5 spans successfully
```

### Lower `flushIntervalMs` during development

```typescript
const pan = new Panopticon({
  flushIntervalMs: 1000, // see spans in ClickHouse within 1s
  // ...
});
```

### Set `batchSize` based on your throughput

- **Low-traffic agent** (< 10 spans/s): default `batchSize: 100`, `flushIntervalMs: 5000` is fine
- **High-throughput agent** (> 100 spans/s): lower `batchSize` to `20`–`50` to avoid large payloads

---

## What Is NOT in the SDK Yet (Planned)

These features are planned per the roadmap and are not yet implemented:

| Feature | Phase | Description |
|---|---|---|
| `pan.instrumentMCP(client)` | Phase 1 | Auto-wrap MCP `Client` — zero-code MCP tracing |
| Vercel AI SDK wrapper | Phase 1 | Wrap `generateText()` / `streamText()` automatically |
| LangChain.js handler | Phase 1 | Drop-in callback handler for LangChain agents |
| OpenAI SDK interceptor | Phase 1 | Patch `openai.chat.completions.create` |
| Distributed trace propagation | Phase 2 | `traceparent` header injection/extraction across services |
| Python SDK (`panopticon-py`) | Phase 4 | LangChain/CrewAI/AutoGen support |
| Sampling | Phase 2 | Only send N% of traces (cost control for high-volume production) |
| PII auto-redaction | Phase 1 | Strip PII from `input`/`output` before sending if `piiRedaction: true` |
