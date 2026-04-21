/**
 * Natural Language → ClickHouse SQL
 *
 * Translates user questions into safe, parameterized ClickHouse queries
 * against the Panopticon span and audit_log schemas.
 */

import { llmComplete, type LLMMessage, type LLMConfig } from './provider.js';

export interface NLQueryResult {
  sql: string;
  description: string;
  params: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are a SQL query generator for Panopticon, an AI agent observability platform.
Convert natural language questions into ClickHouse SQL queries.

DATABASE SCHEMA:

Table: panopticon.spans
  trace_id        String
  span_id         String
  parent_span_id  String
  project_id      String
  agent_id        String
  span_type       Enum('agent_step','llm_call','mcp_request','tool_call','resource_read')
  name            String
  status          Enum('ok','error','timeout')
  start_time      DateTime64(3)
  end_time        DateTime64(3)
  duration_ms     UInt32
  input           String (JSON)
  output          String (JSON)
  metadata        String (JSON with keys: model, promptTokens, completionTokens, cost, mcpServer, toolName, mcpMethod)
  security_flags  Array(String)  -- values: 'prompt_injection', 'pii_detected', 'sensitive_data', etc.

Table: panopticon.audit_log
  id              String
  project_id      String
  event_type      String
  actor           String
  target_type     String
  target_id       String
  details         String (JSON)
  timestamp       DateTime64(3)

RULES:
1. Always include: WHERE project_id = {projectId: String}
2. Use ClickHouse parameterized query syntax: {paramName: Type}
3. LIMIT results to 100 unless the user specifies otherwise
4. For "last X hours/minutes", use: start_time >= now() - INTERVAL X HOUR/MINUTE
5. Use JSONExtractString/JSONExtractUInt/JSONExtractFloat for metadata fields
6. For security flags, use: has(security_flags, 'flag_name') or length(security_flags) > 0
7. Never use DROP, DELETE, ALTER, INSERT, UPDATE, or CREATE statements
8. Only generate SELECT queries

Return JSON:
{
  "sql": "SELECT ... FROM panopticon.spans WHERE project_id = {projectId: String} ...",
  "description": "Human-readable description of what this query returns"
}`;

const FORBIDDEN_PATTERNS = [
  /\b(DROP|DELETE|ALTER|INSERT|UPDATE|CREATE|TRUNCATE|GRANT|REVOKE)\b/i,
  /;\s*\w/,  // multiple statements
];

/** Extract a JSON object from an LLM response that may contain markdown fences or preamble */
function extractJSON(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* continue */ }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* give up */ }
  }

  return null;
}

export async function translateQuery(
  question: string,
  projectId: string,
  llmCfg?: Partial<LLMConfig>,
): Promise<NLQueryResult> {
  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Project ID: ${projectId}\nQuestion: ${question}` },
  ];

  const response = await llmComplete(messages, { ...llmCfg, maxTokens: 1024 });
  const parsed = extractJSON(response.content);

  if (!parsed) {
    throw new Error(
      'Could not parse LLM response. Try rephrasing as a data question, e.g. "Show me error traces from the last hour".',
    );
  }

  const sql = (typeof parsed.sql === 'string' ? parsed.sql : '').trim();

  if (!sql) {
    // LLM understood the question but couldn't produce SQL — return a helpful description
    const desc = typeof parsed.description === 'string' ? parsed.description : String(parsed.description ?? '');
    throw new Error(
      desc || 'This question doesn\'t map to a data query. Try asking about traces, agents, errors, or MCP servers.',
    );
  }

  // Safety check: reject non-SELECT or multi-statement queries
  if (!sql.toUpperCase().startsWith('SELECT')) {
    throw new Error('Generated query is not a SELECT statement');
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(sql)) {
      throw new Error('Generated query contains forbidden operations');
    }
  }

  return {
    sql,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    params: { projectId },
  };
}
