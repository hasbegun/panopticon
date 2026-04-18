import { DEFAULT_FLUSH_INTERVAL_MS, DEFAULT_BATCH_THRESHOLD, API_KEY_HEADER } from '@panopticon/shared';
import { Trace } from './trace.js';
import { instrumentMCPClient, type MCPClientLike, type InstrumentMCPOptions } from './mcp.js';
import type { PanopticonConfig, TraceOptions, SpanData } from './types.js';

/**
 * Panopticon SDK client.
 *
 * Usage:
 * ```ts
 * const pan = new Panopticon({
 *   endpoint: 'http://localhost:4400',
 *   apiKey: 'pan_...',
 *   projectId: 'my-project',
 * });
 *
 * const trace = pan.startTrace({ agentId: 'my-agent' });
 * const span = trace.startSpan({ type: 'llm_call', name: 'gpt-4o' });
 * span.setInput(prompt);
 * span.setOutput(result);
 * span.end();
 * trace.end();
 *
 * await pan.flush();
 * ```
 */
export class Panopticon {
  private readonly config: Required<PanopticonConfig>;
  private buffer: SpanData[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private activeTrace: Trace | null = null;

  constructor(config: PanopticonConfig) {
    this.config = {
      endpoint: config.endpoint.replace(/\/$/, ''),
      apiKey: config.apiKey,
      projectId: config.projectId,
      batchSize: config.batchSize ?? DEFAULT_BATCH_THRESHOLD,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      debug: config.debug ?? false,
    };

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        if (this.config.debug) {
          console.error('[panopticon] flush error:', err);
        }
      });
    }, this.config.flushIntervalMs);
  }

  /** Start a new trace */
  startTrace(options: TraceOptions): Trace {
    const trace = new Trace(options.agentId, (spanData) => this.enqueueSpan(spanData));
    this.activeTrace = trace;
    return trace;
  }

  /**
   * Wrap an MCP client to automatically instrument callTool, readResource, getPrompt.
   * Returns a Proxy — the original client is not mutated.
   *
   * Instrumented calls create spans on the most recently started (active) trace.
   * If no active trace exists, calls pass through uninstrumented.
   */
  instrumentMCP<T extends MCPClientLike>(client: T, options?: InstrumentMCPOptions): T {
    return instrumentMCPClient(client, () => this.activeTrace, options);
  }

  /** Manually flush all buffered spans to the API */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Swap buffer so new spans don't interfere
    const batch = this.buffer;
    this.buffer = [];

    if (this.config.debug) {
      console.log(`[panopticon] flushing ${batch.length} spans`);
    }

    try {
      const response = await fetch(`${this.config.endpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [API_KEY_HEADER]: this.config.apiKey,
        },
        body: JSON.stringify({
          projectId: this.config.projectId,
          spans: batch,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ingestion failed (${response.status}): ${text}`);
      }

      if (this.config.debug) {
        console.log(`[panopticon] flushed ${batch.length} spans successfully`);
      }
    } catch (err) {
      // Put spans back in buffer for retry
      this.buffer.unshift(...batch);
      throw err;
    }
  }

  /** Shut down the client, flushing remaining spans */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Number of spans currently buffered */
  get pendingSpans(): number {
    return this.buffer.length;
  }

  private enqueueSpan(span: SpanData): void {
    this.buffer.push(span);

    if (this.buffer.length >= this.config.batchSize) {
      // Auto-flush when batch is full (fire and forget)
      this.flush().catch((err) => {
        if (this.config.debug) {
          console.error('[panopticon] auto-flush error:', err);
        }
      });
    }
  }
}
