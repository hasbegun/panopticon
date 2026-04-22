import { z } from 'zod';

/** Zod schema for span types */
export const spanTypeSchema = z.enum([
  'agent_step',
  'llm_call',
  'mcp_request',
  'tool_call',
  'resource_read',
]);

/** Zod schema for span status */
export const spanStatusSchema = z.enum(['ok', 'error', 'timeout']);

/** Zod schema for security flags */
export const securityFlagSchema = z.enum([
  'prompt_injection',
  'pii_detected',
  'sensitive_data',
  'unauthorized_access',
  'rate_limit_exceeded',
]);

/** Zod schema for span metadata */
export const spanMetadataSchema = z
  .object({
    model: z.string().optional(),
    provider: z.string().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    mcpServer: z.string().optional(),
    mcpMethod: z.string().optional(),
    toolName: z.string().optional(),
    resourceUri: z.string().optional(),
  })
  .passthrough();

/** Zod schema for a single span input (from SDK) */
export const spanInputSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().nullish(),
  agentId: z.string().min(1),
  spanType: spanTypeSchema,
  name: z.string().min(1),
  status: spanStatusSchema,
  startTime: z.string().datetime(),
  endTime: z.string().datetime().nullish(),
  durationMs: z.number().int().nonnegative().nullish(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: spanMetadataSchema.optional(),
  securityFlags: z.array(securityFlagSchema).optional(),
  sessionId: z.string().optional(),
  endUserId: z.string().optional(),
});

/** Zod schema for a batch of spans */
export const spanBatchSchema = z.object({
  projectId: z.string().min(1),
  spans: z.array(spanInputSchema).min(1).max(1000),
});

/** Zod schema for creating a project */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  settings: z
    .object({
      retentionDays: z.number().int().min(1).max(365).default(30),
      piiRedaction: z.boolean().default(false),
      securityClassification: z.boolean().default(true),
    })
    .optional(),
});

/** Zod schema for alert condition */
export const alertConditionSchema = z.object({
  metric: z.string().min(1),
  operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']),
  threshold: z.number(),
  windowSeconds: z.number().int().positive(),
  filters: z.record(z.string()).optional(),
});

/** Zod schema for creating an alert rule */
export const createAlertRuleSchema = z.object({
  name: z.string().min(1).max(255),
  condition: alertConditionSchema,
  channels: z.array(
    z.object({
      type: z.enum(['webhook', 'slack', 'email', 'pagerduty']),
      config: z.record(z.string()),
    }),
  ),
  enabled: z.boolean().default(true),
  cooldownSeconds: z.number().int().min(0).default(300),
});

/** Inferred types from schemas */
export type SpanInputData = z.infer<typeof spanInputSchema>;
export type SpanBatchData = z.infer<typeof spanBatchSchema>;
export type CreateProjectData = z.infer<typeof createProjectSchema>;
export type CreateAlertRuleData = z.infer<typeof createAlertRuleSchema>;
