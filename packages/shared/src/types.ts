/** Span types representing different kinds of operations in an agent trace */
export type SpanType =
  | 'agent_step'
  | 'llm_call'
  | 'mcp_request'
  | 'tool_call'
  | 'resource_read';

/** Span execution status */
export type SpanStatus = 'ok' | 'error' | 'timeout';

/** MCP transport types */
export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

/** Security flag categories */
export type SecurityFlag =
  | 'prompt_injection'
  | 'pii_detected'
  | 'sensitive_data'
  | 'unauthorized_access'
  | 'rate_limit_exceeded';

/** Alert channel types */
export type AlertChannel = 'webhook' | 'slack' | 'email' | 'pagerduty';

/** A single span within a trace */
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  projectId: string;
  agentId: string;
  spanType: SpanType;
  name: string;
  status: SpanStatus;
  startTime: string; // ISO 8601
  endTime: string | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  metadata: SpanMetadata;
  securityFlags: SecurityFlag[];
  sessionId?: string;
  endUserId?: string;
}

/** Metadata attached to a span */
export interface SpanMetadata {
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  mcpServer?: string;
  mcpMethod?: string;
  toolName?: string;
  resourceUri?: string;
  [key: string]: unknown;
}

/** A complete trace (collection of spans) */
export interface Trace {
  traceId: string;
  projectId: string;
  agentId: string;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  status: SpanStatus;
  spanCount: number;
  metadata: Record<string, unknown>;
  sessionId?: string;
  endUserId?: string;
}

/** Batch of spans sent from SDK to ingestion API */
export interface SpanBatch {
  projectId: string;
  spans: SpanInput[];
}

/** Span data as sent from the SDK (before server-side enrichment) */
export interface SpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  agentId: string;
  spanType: SpanType;
  name: string;
  status: SpanStatus;
  startTime: string;
  endTime?: string | null;
  durationMs?: number | null;
  input?: unknown;
  output?: unknown;
  metadata?: Partial<SpanMetadata>;
  securityFlags?: SecurityFlag[];
  sessionId?: string;
  endUserId?: string;
}

/** Project configuration */
export interface Project {
  id: string;
  name: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
}

export interface ProjectSettings {
  retentionDays: number;
  piiRedaction: boolean;
  securityClassification: boolean;
}

/** MCP Server registry entry */
export interface MCPServer {
  id: string;
  projectId: string;
  name: string;
  transport: MCPTransport;
  endpoint: string | null;
  status: 'connected' | 'disconnected' | 'unknown';
  lastSeen: string | null;
  capabilities: Record<string, unknown>;
  tools: string[];
  resources: string[];
}

/** Alert rule definition */
export interface AlertRule {
  id: string;
  projectId: string;
  name: string;
  condition: AlertCondition;
  channels: AlertChannelConfig[];
  enabled: boolean;
  cooldownSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlertCondition {
  metric: string; // e.g. 'error_rate', 'latency_p99', 'cost'
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  windowSeconds: number;
  filters?: Record<string, string>;
}

export interface AlertChannelConfig {
  type: AlertChannel;
  config: Record<string, string>;
}

/** API response wrappers */
export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
