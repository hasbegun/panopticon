import type { SpanStatus, SpanMetadata, SecurityFlag } from '@panopticon/shared';
import type { SpanData, SpanOptions } from './types.js';

/** Represents a single operation within a trace */
export class Span {
  private readonly _data: SpanData;
  private _ended = false;

  constructor(
    traceId: string,
    spanId: string,
    agentId: string,
    options: SpanOptions,
    private readonly onEnd: (span: SpanData) => void,
  ) {
    this._data = {
      traceId,
      spanId,
      parentSpanId: options.parentSpanId ?? null,
      agentId,
      spanType: options.type,
      name: options.name,
      status: 'ok',
      startTime: new Date().toISOString(),
      endTime: null,
      durationMs: null,
      input: null,
      output: null,
      metadata: options.metadata ?? {},
      securityFlags: [],
    };
  }

  /** Set the input data for this span */
  setInput(input: unknown): this {
    this._data.input = input;
    return this;
  }

  /** Set the output data for this span */
  setOutput(output: unknown): this {
    this._data.output = output;
    return this;
  }

  /** Set the span status */
  setStatus(status: SpanStatus): this {
    this._data.status = status;
    return this;
  }

  /** Add metadata to this span */
  setMetadata(metadata: Partial<SpanMetadata>): this {
    this._data.metadata = { ...this._data.metadata, ...metadata };
    return this;
  }

  /** Add a security flag to this span */
  addSecurityFlag(flag: SecurityFlag): this {
    if (!this._data.securityFlags.includes(flag)) {
      this._data.securityFlags.push(flag);
    }
    return this;
  }

  /** Mark an error on this span */
  recordError(error: Error | string): this {
    this._data.status = 'error';
    this._data.metadata = {
      ...this._data.metadata,
      error: error instanceof Error ? error.message : error,
      errorStack: error instanceof Error ? error.stack : undefined,
    };
    return this;
  }

  /** End this span and queue it for flushing */
  end(): void {
    if (this._ended) return;
    this._ended = true;

    const endTime = new Date();
    this._data.endTime = endTime.toISOString();
    this._data.durationMs = endTime.getTime() - new Date(this._data.startTime).getTime();

    this.onEnd(this._data);
  }

  get spanId(): string {
    return this._data.spanId;
  }

  get traceId(): string {
    return this._data.traceId;
  }

  get isEnded(): boolean {
    return this._ended;
  }
}
