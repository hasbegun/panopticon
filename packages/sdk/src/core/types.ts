import type { SpanType, SpanStatus, SpanMetadata, SecurityFlag } from '@panopticon/shared';

/** Configuration for the Panopticon SDK client */
export interface PanopticonConfig {
  /** Panopticon API endpoint (e.g. http://localhost:4400) */
  endpoint: string;
  /** Project API key (pan_...) */
  apiKey: string;
  /** Project ID */
  projectId: string;
  /** Max spans to buffer before auto-flushing (default: 100) */
  batchSize?: number;
  /** Flush interval in ms (default: 5000) */
  flushIntervalMs?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/** Options for creating a new trace */
export interface TraceOptions {
  /** Agent identifier */
  agentId: string;
  /** Optional trace metadata */
  metadata?: Record<string, unknown>;
}

/** Options for creating a new span */
export interface SpanOptions {
  /** Span type */
  type: SpanType;
  /** Human-readable span name */
  name: string;
  /** Parent span ID (auto-set if created from a trace) */
  parentSpanId?: string;
  /** Optional initial metadata */
  metadata?: Partial<SpanMetadata>;
}

/** Internal representation of a span ready for batching */
export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  agentId: string;
  spanType: SpanType;
  name: string;
  status: SpanStatus;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  metadata: Partial<SpanMetadata>;
  securityFlags: SecurityFlag[];
}
