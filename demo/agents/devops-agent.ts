/**
 * DevOps Deploy Agent
 *
 * Simulates an AI-powered deployment pipeline that:
 *  1. Checks current pod status (K8s MCP)
 *  2. Asks LLM to generate a deployment plan
 *  3. Deploys to staging (K8s MCP)
 *  4. Runs smoke tests, finds a regression
 *  5. LLM decides to rollback
 *  6. Rolls back and notifies Slack (Slack MCP)
 *
 * Demonstrates: multi-step agent reasoning, error handling, rollback logic,
 *               cross-MCP-server interactions (k8s + slack)
 *
 * Usage:
 *   bun run demo/agents/devops-agent.ts
 */

import { Panopticon } from '@panopticon/sdk';

const API_URL = process.env.API_URL ?? 'http://api:4400';
const API_KEY = process.env.API_KEY ?? 'pan_seed_key_for_dev';
const PROJECT = process.env.PROJECT_ID ?? 'seed';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

// ── Deploy-to-staging scenario (happy + rollback) ───────────────────────────

async function runDeployPipeline(pan: Panopticon): Promise<void> {
  // ━━━━━ Trace 1: Successful staging deploy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n── Trace 1: Deploy to staging ──────────────────────');
  {
    const trace = pan.startTrace({ agentId: 'devops-agent' });
    console.log(`  trace: ${trace.traceId}`);

    const root = trace.startSpan({ type: 'agent_step', name: 'deploy-staging' });
    root.setInput({ action: 'deploy', env: 'staging', image: 'acme/api:v2.4.0' });

    // Check pods
    console.log('  → Checking current pods...');
    const checkPods = trace.startSpan({
      type: 'tool_call', name: 'tools/call:get_pods', parentSpanId: root.spanId,
    });
    checkPods.setInput({ tool: 'get_pods', args: { namespace: 'staging' } });
    checkPods.setMetadata({ mcpServer: 'k8s-mcp', mcpMethod: 'tools/call', toolName: 'get_pods' });
    await sleep(180);
    checkPods.setOutput({
      pods: [
        { name: 'api-7d4f8b-x2k', status: 'Running', restarts: 0 },
        { name: 'api-7d4f8b-m9j', status: 'Running', restarts: 0 },
        { name: 'worker-5c2e1a-p4n', status: 'Running', restarts: 1 },
      ],
    }).end();
    console.log('    ✅ get_pods — 3 pods running');

    // LLM: generate deploy plan
    console.log('  → Generating deployment plan...');
    const planSpan = trace.startSpan({
      type: 'llm_call', name: 'gpt-4o', parentSpanId: root.spanId,
    });
    planSpan.setInput({
      prompt: 'Plan a rolling deployment of acme/api:v2.4.0 to staging. Current: 2 api pods, 1 worker pod. Strategy?',
    });
    await sleep(1200);
    planSpan.setOutput({
      response: 'Rolling update: scale to 3 replicas, deploy v2.4.0, wait for health checks, scale back to 2.',
    }).setMetadata({ model: 'gpt-4o', provider: 'openai', inputTokens: 340, outputTokens: 85, cost: 0.0065 }).end();
    console.log('    ✅ gpt-4o plan (1.2s)');

    // Deploy
    console.log('  → Deploying to staging...');
    const deploySpan = trace.startSpan({
      type: 'tool_call', name: 'tools/call:deploy', parentSpanId: root.spanId,
    });
    deploySpan.setInput({ tool: 'deploy', args: { namespace: 'staging', image: 'acme/api:v2.4.0', replicas: 3 } });
    deploySpan.setMetadata({ mcpServer: 'k8s-mcp', mcpMethod: 'tools/call', toolName: 'deploy' });
    await sleep(3500);
    deploySpan.setOutput({ status: 'deployed', newPods: 3 }).end();
    console.log('    ✅ deploy complete (3.5s)');

    // Notify Slack
    console.log('  → Notifying #deployments...');
    const notifySpan = trace.startSpan({
      type: 'tool_call', name: 'tools/call:send_message', parentSpanId: root.spanId,
    });
    notifySpan.setInput({ tool: 'send_message', args: { channel: '#deployments', text: '✅ Deployed acme/api:v2.4.0 to staging' } });
    notifySpan.setMetadata({ mcpServer: 'slack-mcp', mcpMethod: 'tools/call', toolName: 'send_message' });
    await sleep(90);
    notifySpan.setOutput({ ok: true, ts: '1713570000.000100' }).end();
    console.log('    ✅ send_message');

    root.setOutput({ deployed: true, image: 'acme/api:v2.4.0', env: 'staging' }).end();
    trace.end();
    console.log('  ✅ Staging deploy complete');
  }

  // ━━━━━ Trace 2: Production deploy fails → rollback ━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n── Trace 2: Production deploy + rollback ───────────');
  {
    const trace = pan.startTrace({ agentId: 'devops-agent' });
    console.log(`  trace: ${trace.traceId}`);

    const root = trace.startSpan({ type: 'agent_step', name: 'deploy-production' });
    root.setInput({ action: 'deploy', env: 'production', image: 'acme/api:v2.4.0' });

    // Deploy to production
    console.log('  → Deploying to production...');
    const deploySpan = trace.startSpan({
      type: 'tool_call', name: 'tools/call:deploy', parentSpanId: root.spanId,
    });
    deploySpan.setInput({ tool: 'deploy', args: { namespace: 'production', image: 'acme/api:v2.4.0', replicas: 5 } });
    deploySpan.setMetadata({ mcpServer: 'k8s-mcp', mcpMethod: 'tools/call', toolName: 'deploy' });
    await sleep(5000);
    deploySpan.setOutput({ status: 'deployed', newPods: 5 }).end();
    console.log('    ✅ deploy (5s)');

    // Smoke test fails — OOM crash
    console.log('  → Running smoke tests...');
    const smokeSpan = trace.startSpan({
      type: 'tool_call', name: 'tools/call:get_pods', parentSpanId: root.spanId,
    });
    smokeSpan.setInput({ tool: 'get_pods', args: { namespace: 'production' } });
    smokeSpan.setMetadata({ mcpServer: 'k8s-mcp', mcpMethod: 'tools/call', toolName: 'get_pods' });
    await sleep(300);
    smokeSpan.setOutput({
      pods: [
        { name: 'api-8e5f9c-a1b', status: 'CrashLoopBackOff', restarts: 3, reason: 'OOMKilled' },
        { name: 'api-8e5f9c-c2d', status: 'CrashLoopBackOff', restarts: 2, reason: 'OOMKilled' },
        { name: 'api-8e5f9c-e3f', status: 'Running', restarts: 0 },
      ],
    }).setStatus('error').end();
    console.log('    ❌ OOMKilled — 2/3 pods crashing!');

    // LLM: diagnose and decide
    console.log('  → Asking LLM to diagnose...');
    const diagnoseSpan = trace.startSpan({
      type: 'llm_call', name: 'gpt-4o', parentSpanId: root.spanId,
    });
    diagnoseSpan.setInput({
      prompt: '2 of 5 production pods are CrashLoopBackOff with OOMKilled after deploying v2.4.0. What should I do?',
    });
    await sleep(1600);
    diagnoseSpan.setOutput({
      response: 'CRITICAL: OOMKilled indicates memory leak in v2.4.0. Immediate rollback recommended. Root cause: likely the new rate-limiting middleware keeps connections in memory.',
    }).setMetadata({ model: 'gpt-4o', provider: 'openai', inputTokens: 450, outputTokens: 120, cost: 0.009 }).end();
    console.log('    ✅ gpt-4o diagnosis: rollback recommended');

    // Rollback
    console.log('  → Rolling back...');
    const rollbackSpan = trace.startSpan({
      type: 'tool_call', name: 'tools/call:deploy', parentSpanId: root.spanId,
    });
    rollbackSpan.setInput({ tool: 'deploy', args: { namespace: 'production', image: 'acme/api:v2.3.9', replicas: 5 } });
    rollbackSpan.setMetadata({ mcpServer: 'k8s-mcp', mcpMethod: 'tools/call', toolName: 'deploy' });
    await sleep(4000);
    rollbackSpan.setOutput({ status: 'rolled_back', image: 'acme/api:v2.3.9' }).end();
    console.log('    ✅ rolled back to v2.3.9');

    // Notify Slack about failure
    console.log('  → Alerting #incidents...');
    const alertSpan = trace.startSpan({
      type: 'tool_call', name: 'tools/call:send_message', parentSpanId: root.spanId,
    });
    alertSpan.setInput({
      tool: 'send_message',
      args: {
        channel: '#incidents',
        text: '🚨 Production deploy of v2.4.0 FAILED (OOMKilled). Rolled back to v2.3.9. Memory leak in rate-limiting middleware.',
      },
    });
    alertSpan.setMetadata({ mcpServer: 'slack-mcp', mcpMethod: 'tools/call', toolName: 'send_message' });
    await sleep(80);
    alertSpan.setOutput({ ok: true }).end();
    console.log('    ✅ incident posted to #incidents');

    root.setStatus('error').setOutput({
      deployed: false,
      rollback: true,
      reason: 'OOMKilled — memory leak in rate-limiting middleware',
    }).end();
    trace.end();
    console.log('  ❌ Production deploy failed → rolled back');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          🚀 DevOps Deploy Agent                         ║');
  console.log('║   Deploy to staging, then production (with rollback)    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  await waitForApi(API_URL);

  const pan = new Panopticon({
    endpoint: API_URL,
    apiKey: API_KEY,
    projectId: PROJECT,
    batchSize: 50,
    flushIntervalMs: 5000,
    debug: true,
  });

  await runDeployPipeline(pan);

  await pan.shutdown();
  console.log('\n  ✅ DevOps agent complete — 2 traces sent to Panopticon');
}

main().catch((err) => {
  console.error('❌ DevOps agent failed:', err);
  process.exit(1);
});
