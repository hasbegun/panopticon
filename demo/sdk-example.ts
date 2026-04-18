/**
 * Panopticon SDK Demo
 *
 * Shows how to instrument an AI agent using @panopticon/sdk.
 * Scenario: a "research agent" that plans a query, searches docs via MCP,
 * synthesises an answer with an LLM, then posts the result to Slack.
 *
 * Run: bun run demo/sdk-example.ts   (from repo root, after building SDK)
 * Env: API_URL, API_KEY
 */

import { Panopticon } from '@panopticon/sdk';

const API_URL = process.env.API_URL ?? 'http://api:4400';
const API_KEY = process.env.API_KEY ?? 'pan_seed_key_for_dev';
const PROJECT_ID = 'seed';

// ---------------------------------------------------------------------------
// Helpers — simulate async work
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fake LLM call — returns after `ms` ms */
async function fakeLLM(prompt: string, ms = 800): Promise<string> {
  await sleep(ms);
  if (prompt.includes('FAIL')) throw new Error('LLM provider rate-limited (429)');
  return `[LLM response to: "${prompt.slice(0, 60)}..."]`;
}

/** Fake MCP tool call */
async function fakeMCPTool(
  tool: string,
  args: Record<string, unknown>,
  ms = 150,
): Promise<unknown> {
  await sleep(ms);
  if (tool === 'post_message') throw new Error('Slack workspace not connected');
  return { tool, result: `mock result for ${tool}`, args };
}

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------

async function waitForApi(url: string, maxRetries = 30): Promise<void> {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        console.log(`✅  API reachable at ${url}\n`);
        return;
      }
    } catch {
      // ignore
    }
    console.log(`   Waiting for API... (${i}/${maxRetries})`);
    await sleep(2000);
  }
  throw new Error(`API not reachable at ${url}`);
}

async function runResearchAgent(pan: Panopticon): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Trace 1: Research Agent — happy path');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const trace = pan.startTrace({ agentId: 'research-agent' });
  console.log(`  trace_id: ${trace.traceId}`);

  // ── Root span: the overall agent step ──────────────────────────────────
  const rootSpan = trace.startSpan({
    type: 'agent_step',
    name: 'research-query',
  });
  rootSpan.setInput({ query: 'How does the Vercel AI SDK handle streaming?' });

  // ── Span 1: LLM call to plan the research ──────────────────────────────
  const planSpan = trace.startSpan({
    type: 'llm_call',
    name: 'gpt-4o',
    parentSpanId: rootSpan.spanId,
  });
  planSpan.setInput({ prompt: 'Plan research steps for: "How does Vercel AI SDK handle streaming?"' });

  const planResult = await fakeLLM('Plan research steps for Vercel AI SDK streaming', 620);
  planSpan
    .setOutput({ response: planResult })
    .setMetadata({ model: 'gpt-4o', provider: 'openai', inputTokens: 28, outputTokens: 72, cost: 0.0012 })
    .end();
  console.log(`  ✅  llm_call    gpt-4o (plan)          620ms`);

  // ── Span 2: MCP filesystem search ──────────────────────────────────────
  const searchSpan = trace.startSpan({
    type: 'mcp_request',
    name: 'search-local-docs',
    parentSpanId: rootSpan.spanId,
  });
  searchSpan.setInput({ tool: 'search_files', query: 'vercel ai sdk streaming', dir: 'docs/' });

  const searchResult = await fakeMCPTool('search_files', { query: 'streaming', dir: 'docs/' }, 90);
  searchSpan
    .setOutput(searchResult)
    .setMetadata({ mcpServer: 'filesystem-mcp', mcpMethod: 'tools/call', toolName: 'search_files' })
    .end();
  console.log(`  ✅  mcp_request search-local-docs       90ms`);

  // ── Span 3: resource read ──────────────────────────────────────────────
  const readSpan = trace.startSpan({
    type: 'resource_read',
    name: 'read-streaming-docs',
    parentSpanId: rootSpan.spanId,
  });
  readSpan.setInput({ uri: 'file:///docs/vercel-ai-sdk-streaming.md' });

  await sleep(45);
  readSpan
    .setOutput({ content: '# Vercel AI SDK Streaming\nUse `streamText()` to stream tokens...', bytes: 4210 })
    .setMetadata({ mcpServer: 'filesystem-mcp', mcpMethod: 'resources/read', resourceUri: 'file:///docs/vercel-ai-sdk-streaming.md' })
    .end();
  console.log(`  ✅  resource_read read-streaming-docs   45ms`);

  // ── Span 4: LLM call to synthesise ────────────────────────────────────
  const synthSpan = trace.startSpan({
    type: 'llm_call',
    name: 'gpt-4o',
    parentSpanId: rootSpan.spanId,
  });
  synthSpan.setInput({
    prompt: 'Given these docs, answer: "How does Vercel AI SDK handle streaming?" Be concise.',
    context: 'docs/vercel-ai-sdk-streaming.md',
  });

  const synthResult = await fakeLLM('Synthesise answer from docs about Vercel AI SDK streaming', 940);
  synthSpan
    .setOutput({ response: synthResult })
    .setMetadata({ model: 'gpt-4o', provider: 'openai', inputTokens: 310, outputTokens: 145, cost: 0.0058 })
    .end();
  console.log(`  ✅  llm_call    gpt-4o (synthesise)     940ms`);

  // ── Close root span ────────────────────────────────────────────────────
  rootSpan.setOutput({ answer: synthResult, sourceDocs: 1 }).end();
  trace.end();
  console.log(`  ✅  agent_step  research-query (root)`);
}

async function runAgentWithError(pan: Panopticon): Promise<void> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Trace 2: Research Agent — tool failure + recovery');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const trace = pan.startTrace({ agentId: 'research-agent' });
  console.log(`  trace_id: ${trace.traceId}`);

  const rootSpan = trace.startSpan({ type: 'agent_step', name: 'post-research-result' });
  rootSpan.setInput({ task: 'Send research summary to Slack' });

  // LLM: format the message
  const fmtSpan = trace.startSpan({ type: 'llm_call', name: 'gpt-4o', parentSpanId: rootSpan.spanId });
  fmtSpan.setInput({ prompt: 'Format this research summary for Slack (markdown)' });
  const fmtOut = await fakeLLM('Format research summary for Slack', 480);
  fmtSpan
    .setOutput({ response: fmtOut })
    .setMetadata({ model: 'gpt-4o', provider: 'openai', inputTokens: 55, outputTokens: 90, cost: 0.0018 })
    .end();
  console.log(`  ✅  llm_call    gpt-4o (format)         480ms`);

  // MCP: attempt to post to Slack — fails
  const slackSpan = trace.startSpan({
    type: 'mcp_request',
    name: 'post-to-slack',
    parentSpanId: rootSpan.spanId,
  });
  slackSpan.setInput({ tool: 'post_message', channel: '#research', text: fmtOut });

  try {
    await fakeMCPTool('post_message', { channel: '#research', text: fmtOut }, 80);
  } catch (err) {
    slackSpan
      .recordError(err as Error)
      .setMetadata({ mcpServer: 'slack-mcp', mcpMethod: 'tools/call', toolName: 'post_message' })
      .end();
    console.log(`  ❌  mcp_request post-to-slack (error)  80ms  — ${(err as Error).message}`);
  }

  // Recovery: fall back to writing result to file
  const fallbackSpan = trace.startSpan({
    type: 'mcp_request',
    name: 'write-result-to-file',
    parentSpanId: rootSpan.spanId,
  });
  fallbackSpan.setInput({ tool: 'write_file', path: 'output/research-result.md' });
  await sleep(60);
  fallbackSpan
    .setOutput({ success: true, bytesWritten: 1240 })
    .setMetadata({ mcpServer: 'filesystem-mcp', mcpMethod: 'tools/call', toolName: 'write_file' })
    .end();
  console.log(`  ✅  mcp_request write-result-to-file   60ms  (fallback)`);

  // Root: partial success — Slack failed but file written
  rootSpan.setStatus('ok').setOutput({ slackSent: false, fileFallback: 'output/research-result.md' }).end();
  trace.end();
  console.log(`  ✅  agent_step  post-research-result (root)`);
}

async function runSecurityFlaggedTrace(pan: Panopticon): Promise<void> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Trace 3: Coder Agent — PII in prompt detected');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const trace = pan.startTrace({ agentId: 'coder-agent' });
  console.log(`  trace_id: ${trace.traceId}`);

  const rootSpan = trace.startSpan({ type: 'agent_step', name: 'fix-user-lookup' });
  rootSpan.setInput({ task: 'Fix the user lookup query' });

  const llmSpan = trace.startSpan({ type: 'llm_call', name: 'claude-3.5-sonnet', parentSpanId: rootSpan.spanId });

  // The prompt contains an email + SSN — agent should flag this
  const prompt = 'The user jane.doe@company.com (SSN: 987-65-4321) reports a bug in the lookup. Fix it.';
  llmSpan.setInput({ prompt });

  // SDK: add security flag on the span before it ends
  llmSpan.addSecurityFlag('pii_detected');

  const response = await fakeLLM('Fix user lookup bug', 550);
  llmSpan
    .setOutput({ response })
    .setMetadata({ model: 'claude-3.5-sonnet', provider: 'anthropic', inputTokens: 42, outputTokens: 88, cost: 0.0019 })
    .end();
  console.log(`  ⚠️   llm_call    claude-3.5-sonnet       550ms  [pii_detected]`);

  rootSpan.setOutput({ fixed: true, note: 'PII detected in prompt' }).end();
  trace.end();
  console.log(`  ✅  agent_step  fix-user-lookup (root)`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       Panopticon SDK Demo — Research Agent           ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  API:     ${API_URL}`);
  console.log(`  Project: ${PROJECT_ID}`);
  console.log();

  await waitForApi(API_URL);

  // Initialise SDK client — debug: true logs each flush
  const pan = new Panopticon({
    endpoint: API_URL,
    apiKey: API_KEY,
    projectId: PROJECT_ID,
    batchSize: 50,
    flushIntervalMs: 10_000,
    debug: true,
  });

  console.log('  SDK initialised. Running traces...\n');

  await runResearchAgent(pan);
  await runAgentWithError(pan);
  await runSecurityFlaggedTrace(pan);

  // Flush all buffered spans and shut down the timer
  console.log('\n  Flushing spans to API...');
  await pan.shutdown();
  console.log('  Done.\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SDK demo complete — 3 traces sent.');
  console.log();
  console.log('  Explore the data:');
  console.log(`    curl -s "http://localhost:4400/v1/traces?project_id=${PROJECT_ID}" \\`);
  console.log(`      -H "x-api-key: ${API_KEY}" | python3 -m json.tool`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((err) => {
  console.error('❌ SDK demo failed:', err);
  process.exit(1);
});
