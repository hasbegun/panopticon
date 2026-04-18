import { Span } from './span.js';
import type { SpanData, SpanOptions } from './types.js';

let idCounter = 0;

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  idCounter++;
  return `${timestamp}-${random}-${idCounter.toString(36)}`;
}

/** Represents a single end-to-end agent invocation */
export class Trace {
  readonly traceId: string;
  private readonly agentId: string;
  private readonly spans: Span[] = [];
  private _ended = false;

  constructor(
    agentId: string,
    private readonly onSpanEnd: (span: SpanData) => void,
    traceId?: string,
  ) {
    this.traceId = traceId ?? generateId();
    this.agentId = agentId;
  }

  /** Create a new span within this trace */
  startSpan(options: SpanOptions): Span {
    if (this._ended) {
      throw new Error(`Trace ${this.traceId} has already ended`);
    }

    const spanId = generateId();
    const span = new Span(this.traceId, spanId, this.agentId, options, (data) => {
      this.onSpanEnd(data);
    });

    this.spans.push(span);
    return span;
  }

  /** End this trace (also ends any open spans) */
  end(): void {
    if (this._ended) return;
    this._ended = true;

    // End any open spans
    for (const span of this.spans) {
      if (!span.isEnded) {
        span.end();
      }
    }
  }

  get isEnded(): boolean {
    return this._ended;
  }

  get spanCount(): number {
    return this.spans.length;
  }
}
