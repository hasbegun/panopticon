/**
 * Code Review Agent
 *
 * Simulates an AI code reviewer that:
 *  1. Fetches a PR from GitHub (MCP tool call)
 *  2. Reads the changed files (MCP resource read)
 *  3. Asks an LLM to review the code
 *  4. Posts review comments back to GitHub (MCP tool call)
 *
 * Demonstrates: agent_step → llm_call → mcp_request → resource_read → tool_call
 *
 * Usage:
 *   bun run demo/agents/code-review-agent.ts
 *   (requires the Panopticon stack to be running)
 */

import { Panopticon } from '@panopticon/sdk';

const API_URL = process.env.API_URL ?? 'http://api:4400';
const API_KEY = process.env.API_KEY ?? 'pan_seed_key_for_dev';
const PROJECT = process.env.PROJECT_ID ?? 'seed';

// ── Simulated external calls ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Simulated GitHub PR data */
const MOCK_PR = {
  number: 142,
  title: 'feat: add rate limiting middleware',
  author: 'alice',
  files: [
    { path: 'src/middleware/rate-limit.ts', additions: 85, deletions: 3 },
    { path: 'src/routes/api.ts', additions: 4, deletions: 0 },
    { path: 'tests/rate-limit.test.ts', additions: 42, deletions: 0 },
  ],
};

const MOCK_FILE_CONTENT = `
import { Hono } from 'hono';
import { rateLimit } from './middleware/rate-limit';

const app = new Hono();
app.use('/api/*', rateLimit({ windowMs: 60_000, max: 100 }));

// BUG: Missing error handler for rate limit exceeded
app.get('/api/data', async (c) => {
  const data = await db.query('SELECT * FROM items');
  return c.json(data);
});
`.trim();

const MOCK_REVIEW = {
  summary: 'Good implementation of rate limiting. Found 1 issue.',
  comments: [
    {
      path: 'src/routes/api.ts',
      line: 7,
      body: 'Missing error handler for 429 responses. Add: `app.onError((err, c) => { if (err.status === 429) return c.json({ error: "Rate limited" }, 429); })`',
      severity: 'warning',
    },
    {
      path: 'tests/rate-limit.test.ts',
      line: 1,
      body: 'Good test coverage. Consider adding a test for concurrent requests.',
      severity: 'suggestion',
    },
  ],
  verdict: 'approve_with_suggestions',
};

// ── Agent logic ─────────────────────────────────────────────────────────────

async function waitForApi(url: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(2000);
  }
  throw new Error(`API not reachable at ${url}`);
}

async function runCodeReview(pan: Panopticon): Promise<void> {
  const trace = pan.startTrace({ agentId: 'code-review-agent' });
  console.log(`  trace: ${trace.traceId}`);

  // ── Root: the overall review step ─────────────────────────────────────
  const root = trace.startSpan({
    type: 'agent_step',
    name: 'review-pull-request',
  });
  root.setInput({ pr: MOCK_PR.number, repo: 'acme/backend' });

  // ── Step 1: Fetch PR metadata from GitHub MCP ─────────────────────────
  console.log('  → Fetching PR #142 from GitHub...');
  const fetchPR = trace.startSpan({
    type: 'mcp_request',
    name: 'tools/call:list_prs',
    parentSpanId: root.spanId,
  });
  fetchPR.setInput({ tool: 'list_prs', args: { repo: 'acme/backend', state: 'open' } });
  fetchPR.setMetadata({ mcpServer: 'github-mcp', mcpMethod: 'tools/call', toolName: 'list_prs' });
  await sleep(120);
  fetchPR.setOutput({ prs: [MOCK_PR] }).end();
  console.log('    ✅ list_prs (120ms)');

  // ── Step 2: Read changed files via filesystem MCP ─────────────────────
  for (const file of MOCK_PR.files) {
    console.log(`  → Reading ${file.path}...`);
    const readSpan = trace.startSpan({
      type: 'resource_read',
      name: `resources/read`,
      parentSpanId: root.spanId,
    });
    readSpan.setInput({ uri: `file:///${file.path}` });
    readSpan.setMetadata({
      mcpServer: 'filesystem-mcp',
      mcpMethod: 'resources/read',
      resourceUri: `file:///${file.path}`,
    });
    await sleep(30 + Math.random() * 40);
    readSpan.setOutput({ content: MOCK_FILE_CONTENT, bytes: MOCK_FILE_CONTENT.length }).end();
    console.log(`    ✅ read ${file.path}`);
  }

  // ── Step 3: LLM review ────────────────────────────────────────────────
  console.log('  → Asking LLM to review code...');
  const llmSpan = trace.startSpan({
    type: 'llm_call',
    name: 'gpt-4o',
    parentSpanId: root.spanId,
  });
  llmSpan.setInput({
    prompt: `Review PR #${MOCK_PR.number}: "${MOCK_PR.title}" by ${MOCK_PR.author}. Files: ${MOCK_PR.files.map((f) => f.path).join(', ')}`,
    systemPrompt: 'You are an expert code reviewer. Identify bugs, security issues, and suggest improvements.',
  });
  await sleep(1800 + Math.random() * 600);
  llmSpan
    .setOutput({ review: MOCK_REVIEW })
    .setMetadata({ model: 'gpt-4o', provider: 'openai', inputTokens: 1240, outputTokens: 380, cost: 0.024 })
    .end();
  console.log('    ✅ gpt-4o review (1.8s)');

  // ── Step 4: Post review comments back to GitHub ───────────────────────
  console.log('  → Posting review comments to GitHub...');
  const postReview = trace.startSpan({
    type: 'tool_call',
    name: 'tools/call:review_pr',
    parentSpanId: root.spanId,
  });
  postReview.setInput({
    tool: 'review_pr',
    args: {
      repo: 'acme/backend',
      pr: MOCK_PR.number,
      comments: MOCK_REVIEW.comments,
      verdict: MOCK_REVIEW.verdict,
    },
  });
  postReview.setMetadata({ mcpServer: 'github-mcp', mcpMethod: 'tools/call', toolName: 'review_pr' });
  await sleep(200);
  postReview.setOutput({ posted: true, commentCount: MOCK_REVIEW.comments.length }).end();
  console.log('    ✅ review_pr posted');

  // ── Close root ────────────────────────────────────────────────────────
  root.setOutput({
    verdict: MOCK_REVIEW.verdict,
    comments: MOCK_REVIEW.comments.length,
    summary: MOCK_REVIEW.summary,
  }).end();
  trace.end();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          🔍 Code Review Agent                           ║');
  console.log('║   Reviews PR #142: "feat: add rate limiting"            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  await waitForApi(API_URL);

  const pan = new Panopticon({
    endpoint: API_URL,
    apiKey: API_KEY,
    projectId: PROJECT,
    batchSize: 50,
    flushIntervalMs: 5000,
    debug: true,
  });

  await runCodeReview(pan);

  await pan.shutdown();
  console.log('\n  ✅ Code review agent complete — trace sent to Panopticon');
}

main().catch((err) => {
  console.error('❌ Code review agent failed:', err);
  process.exit(1);
});
