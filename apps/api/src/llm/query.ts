/**
 * Natural Language → ClickHouse SQL
 *
 * Translates user questions into safe, parameterized ClickHouse queries
 * against the Panopticon span and audit_log schemas.
 *
 * GUARDRAILS (3 layers):
 *   1. INPUT — sanitise & reject malicious/off-topic prompts before LLM call
 *   2. OUTPUT — deep SQL validation (whitelist tables, functions, block exploits)
 *   3. EXECUTION — project-scoped, read-only, row-limited
 */

import { llmComplete, type LLMMessage, type LLMConfig } from './provider.js';

export interface NLQueryResult {
  sql: string;
  description: string;
  params: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — INPUT GUARDRAILS
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_QUESTION_LENGTH = 500;

/** Prompt-injection patterns — catch attempts to hijack the system prompt */
const INPUT_INJECTION_PATTERNS = [
  /ignore (all |previous |prior |above |your )?instructions/i,
  /disregard (the |your )?(system |original )?(prompt|instructions)/i,
  /you are now/i,
  /override (all |any )?restrictions/i,
  /pretend (you are|to be|you're)/i,
  /new instructions:/i,
  /jailbreak/i,
  /do not follow/i,
  /act as (a |an )?/i,
  /forget (everything|all|your)/i,
  /system\s*prompt/i,
  /\bDAN\b/,               // "Do Anything Now" jailbreak
  /role\s*play/i,
  /\bsudo\b/i,
  /bypass (the |any )?(filter|guard|restriction|safety|rule)/i,
  /reveal (your |the )?(system|hidden|secret)/i,
  /what (are|is) your (system |initial )?(prompt|instruction)/i,
  /repeat (the |your )?(system |initial )?prompt/i,
  /translate .* (to|into) .*(python|javascript|bash|shell|code)/i,
  /execute (this |the )?(code|command|script)/i,
  /\beval\b/i,
  /\bexec\b/i,
  /\$\{/,                  // template injection
  /\{\{/,                  // template injection
  /import\s+os\b/i,
  /require\s*\(/i,
];

/** Topics that are clearly not data questions */
const OFF_TOPIC_PATTERNS = [
  /write (me )?(a |an )?(poem|story|essay|song|joke|letter|email)/i,
  /tell (me )?(a )?joke/i,
  /how (do|can) (I|you) (hack|exploit|attack)/i,
  /create (a |an )?(virus|malware|exploit)/i,
  /generate (a |an )?(password|key|token|secret)/i,
  /what is (the meaning of life|your opinion|love)/i,
  /who (are you|made you|created you)/i,
];

function validateInput(question: string): { ok: boolean; error?: string } {
  const q = question.trim();

  if (!q) return { ok: false, error: 'Question cannot be empty.' };

  if (q.length > MAX_QUESTION_LENGTH) {
    return { ok: false, error: `Question too long (max ${MAX_QUESTION_LENGTH} characters). Please be more concise.` };
  }

  // Prompt injection detection
  for (const pat of INPUT_INJECTION_PATTERNS) {
    if (pat.test(q)) {
      return { ok: false, error: 'Your question was blocked by our safety filter. Please ask a data-related question about your traces, agents, or MCP servers.' };
    }
  }

  // Off-topic detection
  for (const pat of OFF_TOPIC_PATTERNS) {
    if (pat.test(q)) {
      return { ok: false, error: 'I can only answer data questions about your observability traces, agents, errors, and MCP servers. Try: "Show me error traces from the last hour".' };
    }
  }

  // Detect encoded/obfuscated payloads (base64 blocks, hex blobs)
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(q)) {
    return { ok: false, error: 'Encoded content is not allowed in questions.' };
  }

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2 — OUTPUT GUARDRAILS (SQL Validation)
// ═══════════════════════════════════════════════════════════════════════════════

/** Only these tables may be queried */
const ALLOWED_TABLES = new Set([
  'panopticon.spans',
  'panopticon.audit_log',
  'panopticon.trace_analysis',
]);

/** Destructive / admin statements — case insensitive word boundary match */
const FORBIDDEN_STATEMENTS = [
  /\b(DROP|DELETE|ALTER|INSERT|UPDATE|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|RENAME|OPTIMIZE|KILL|SYSTEM|SET)\b/i,
];

/** Dangerous patterns that could leak data or escape the sandbox */
const DANGEROUS_SQL_PATTERNS = [
  /;\s*\S/,                                    // multi-statement
  /\bINTO\s+OUTFILE\b/i,                        // file write
  /\bFROM\s+file\s*\(/i,                        // file read
  /\bFROM\s+url\s*\(/i,                         // remote fetch
  /\bFROM\s+s3\s*\(/i,                          // S3 read
  /\bFROM\s+hdfs\s*\(/i,                        // HDFS read
  /\bFROM\s+mysql\s*\(/i,                       // cross-engine
  /\bFROM\s+postgresql\s*\(/i,                   // cross-engine
  /\binput\s*\(/i,                               // input() table function
  /\bremote\s*\(/i,                              // remote() table function
  /\bcluster\s*\(/i,                             // cluster() table function
  /\bsystem\s*\./i,                              // system.* tables
  /\binformation_schema\s*\./i,                  // information_schema
  /\bUNION\b.*\bSELECT\b.*\bFROM\s+(?!panopticon\.)/i,  // UNION with non-panopticon tables
  /--/,                                          // SQL line comment (potential injection)
  /\/\*/,                                        // SQL block comment
  /0x[0-9a-fA-F]{8,}/,                           // hex-encoded strings
  /\bchar\s*\(/i,                                // char() for encoding bypass
  /\bformat\s*\(/i,                              // formatRow / format bypass
  /\bfromUnixTimestamp64\w*\s*\(\s*0/i,          // timing attack probes
];

/** Only allow known-safe ClickHouse functions (whitelist approach) */
const ALLOWED_FUNCTIONS = new Set([
  // Aggregates
  'count', 'countif', 'sum', 'sumif', 'avg', 'avgif', 'min', 'max',
  'uniq', 'uniqexact', 'any', 'anylast', 'grouparray', 'argmax', 'argmin',
  'quantile', 'quantiles', 'median',
  // Math
  'abs', 'round', 'ceil', 'floor', 'sqrt', 'log', 'log2', 'log10',
  'toFloat32', 'toFloat64', 'touint32', 'touint64', 'toint32', 'toint64',
  // String
  'lower', 'upper', 'length', 'trim', 'substring', 'concat', 'like', 'notlike',
  'match', 'extract', 'replaceone', 'replaceall', 'position', 'startswith', 'endswith',
  'tostring', 'lcase', 'ucase',
  // Date/Time
  'now', 'today', 'yesterday', 'todate', 'todatetime', 'todatetime64',
  'tostartofsecond', 'tostartofminute', 'tostartofhour', 'tostartofday',
  'tostartofweek', 'tostartofmonth', 'tostartofisoweek',
  'toyear', 'tomonth', 'todayofweek', 'todayofmonth', 'tohour', 'tominute', 'tosecond',
  'toyyyymm', 'toyyyymmdd', 'toyyyymmddhhmmss',
  'datediff', 'dateadd', 'datesub',
  'formatdatetime', 'parsedatetime', 'parsedatetimebesteffort',
  // JSON
  'jsonextractstring', 'jsonextractuint', 'jsonextractint', 'jsonextractfloat',
  'jsonextractbool', 'jsonextractraw', 'jsonextractarrayraw',
  'jsonextract', 'jsonhas', 'jsonlength', 'jsontype',
  // Array
  'has', 'hasany', 'hasall', 'length', 'arrayexists', 'arrayjoin',
  'arrayelement', 'arraymap', 'arrayfilter', 'arraysort',
  'empty', 'notempty', 'emptyarraystring', 'emptyarrayuint32',
  // Conditional
  'if', 'multiif', 'case',
  // Type conversion
  'cast', 'totypename', 'tostring', 'touint8', 'touint16', 'touint32', 'touint64',
  'toint8', 'toint16', 'toint32', 'toint64',
  // Window (safe read-only)
  'rownumber', 'row_number', 'rank', 'denserank', 'dense_rank',
  'lag', 'lead', 'ntile',
  // Misc
  'coalesce', 'ifnull', 'nullif', 'isnull', 'isnotnull',
  'greatest', 'least', 'in', 'notin', 'between',
  'dictget', 'dictgetstring', 'dictgetuint64',
  'tostartoffiveminutes', 'tostartoftenminutes', 'tostartoffifteenminutes',
  'now64',
]);

/** Extract function calls from SQL and check against whitelist */
function extractFunctionCalls(sql: string): string[] {
  const matches = sql.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g) || [];
  return matches.map((m) => m.replace(/\s*\($/, '').toLowerCase());
}

function validateSQL(sql: string): { ok: boolean; error?: string } {
  const upper = sql.toUpperCase().trim();

  // Must be SELECT
  if (!upper.startsWith('SELECT')) {
    return { ok: false, error: 'Only SELECT queries are allowed.' };
  }

  // Forbidden statements
  for (const pat of FORBIDDEN_STATEMENTS) {
    if (pat.test(sql)) {
      return { ok: false, error: 'Query contains forbidden SQL operations.' };
    }
  }

  // Dangerous patterns
  for (const pat of DANGEROUS_SQL_PATTERNS) {
    if (pat.test(sql)) {
      return { ok: false, error: 'Query contains a disallowed pattern and was blocked for safety.' };
    }
  }

  // Table whitelist — extract all FROM / JOIN targets
  const tableRefs = sql.match(/\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi) || [];
  for (const ref of tableRefs) {
    const tableName = ref.replace(/^(FROM|JOIN)\s+/i, '').trim().toLowerCase();
    if (!ALLOWED_TABLES.has(tableName)) {
      return { ok: false, error: `Access to table "${tableName}" is not allowed. Only panopticon.spans, panopticon.audit_log, and panopticon.trace_analysis are accessible.` };
    }
  }

  // Function whitelist
  const fns = extractFunctionCalls(sql);
  // SQL keywords that look like functions: SELECT, FROM, WHERE, etc. — skip them
  const SQL_KEYWORDS = new Set([
    'select', 'from', 'where', 'and', 'or', 'not', 'as', 'on', 'in',
    'group', 'order', 'having', 'limit', 'offset', 'by', 'join', 'left',
    'right', 'inner', 'outer', 'cross', 'union', 'all', 'distinct',
    'with', 'interval', 'between', 'like', 'ilike', 'is', 'null', 'asc', 'desc',
    'else', 'when', 'then', 'end', 'over', 'partition', 'rows', 'range',
  ]);
  for (const fn of fns) {
    if (SQL_KEYWORDS.has(fn)) continue;
    if (!ALLOWED_FUNCTIONS.has(fn)) {
      return { ok: false, error: `Function "${fn}()" is not in the allowed list and was blocked for safety.` };
    }
  }

  // Must include project_id filter (prevent cross-project data access)
  if (!/project_id/i.test(sql)) {
    return { ok: false, error: 'Query must filter by project_id.' };
  }

  // Hard row limit — if no LIMIT or LIMIT > 1000, cap it
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  if (limitMatch && Number(limitMatch[1]) > 1000) {
    return { ok: false, error: 'LIMIT cannot exceed 1000 rows.' };
  }

  // Subquery depth check (max 2 levels)
  const openParens = (sql.match(/\bSELECT\b/gi) || []).length;
  if (openParens > 3) {
    return { ok: false, error: 'Query is too complex (too many nested subqueries).' };
  }

  return { ok: true };
}

/** Force a LIMIT on the SQL if missing */
function ensureLimit(sql: string, max = 100): string {
  if (/LIMIT\s+\d+/i.test(sql)) return sql;
  return sql.replace(/;?\s*$/, ` LIMIT ${max}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT (hardened — tells LLM about constraints)
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a read-only SQL query generator for Panopticon, an AI agent observability platform.
You ONLY produce ClickHouse SELECT queries. You cannot and must not produce any other SQL statement type.

DATABASE SCHEMA (these are the ONLY tables you may reference):

Table: panopticon.spans
  trace_id        String
  span_id         String
  parent_span_id  String
  project_id      String
  agent_id        String
  session_id      String
  end_user_id     String
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
  id, project_id, event_type, actor, target_type, target_id, details (JSON), timestamp

STRICT RULES:
1. ALWAYS include: WHERE project_id = {projectId: String}
2. Use ClickHouse parameterized query syntax: {paramName: Type}
3. LIMIT results to 100 unless the user specifies otherwise (max 1000)
4. For time ranges use: start_time >= now() - INTERVAL X HOUR/MINUTE
5. Use JSONExtractString/JSONExtractUInt/JSONExtractFloat for metadata fields
6. For security flags use: has(security_flags, 'flag_name') or length(security_flags) > 0
7. ONLY generate SELECT statements — no DROP, DELETE, ALTER, INSERT, UPDATE, CREATE, TRUNCATE, or any DDL/DML
8. Do NOT query system.*, information_schema.*, or any table outside the schema above
9. Do NOT use INTO OUTFILE, file(), url(), s3(), remote(), input(), or cluster() functions
10. Do NOT use UNION with tables outside the schema above
11. If the user's question is not about observability data, respond with a helpful description explaining what you can query, but set sql to empty string

Return ONLY this JSON (no extra text):
{
  "sql": "SELECT ... FROM panopticon.spans WHERE project_id = {projectId: String} ...",
  "description": "Human-readable description of what this query returns"
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// JSON extraction helper
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

export async function translateQuery(
  question: string,
  projectId: string,
  llmCfg?: Partial<LLMConfig>,
): Promise<NLQueryResult> {
  // ── Layer 1: Input guardrails ──────────────────────────────────────────────
  const inputCheck = validateInput(question);
  if (!inputCheck.ok) throw new Error(inputCheck.error);

  // ── LLM translation ───────────────────────────────────────────────────────
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
    const desc = typeof parsed.description === 'string' ? parsed.description : String(parsed.description ?? '');
    throw new Error(
      desc || 'This question doesn\'t map to a data query. Try asking about traces, agents, errors, or MCP servers.',
    );
  }

  // ── Layer 2: Output guardrails — deep SQL validation ──────────────────────
  const sqlCheck = validateSQL(sql);
  if (!sqlCheck.ok) throw new Error(sqlCheck.error);

  // Enforce LIMIT
  const safeSql = ensureLimit(sql, 100);

  return {
    sql: safeSql,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    params: { projectId },
  };
}
