/**
 * LLM Provider Abstraction
 *
 * Supports OpenAI, Anthropic, and Ollama (OpenAI-compatible).
 *
 * Config resolution order (highest wins):
 *   1. Per-project settings (stored in Postgres projects.settings.llm)
 *   2. Environment variables (LLM_PROVIDER, LLM_API_KEY, etc.)
 *   3. Built-in defaults
 *
 * For Ollama running on the host machine, containers use
 * host.docker.internal:11434 (set via Docker extra_hosts).
 */

import { getPostgres } from '../db/postgres.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama';
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
}

/** Subset of LLMConfig stored per-project in settings.llm */
export interface LLMProjectSettings {
  provider?: 'openai' | 'anthropic' | 'ollama';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  ollama: 'llama3.1',
};

// Inside Docker, reach host Ollama via extra_hosts mapping
const OLLAMA_DEFAULT_URL = 'http://host.docker.internal:11434/v1';

let _envConfig: LLMConfig | null = null;

/** Read config from environment variables (server-level defaults) */
export function getEnvLLMConfig(): LLMConfig {
  if (!_envConfig) {
    const provider = (process.env.LLM_PROVIDER ?? 'openai') as LLMConfig['provider'];
    _envConfig = {
      provider,
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? DEFAULT_MODELS[provider] ?? 'gpt-4o-mini',
      baseUrl: process.env.LLM_BASE_URL,
      temperature: Number(process.env.LLM_TEMPERATURE ?? '0'),
      maxTokens: Number(process.env.LLM_MAX_TOKENS ?? '1024'),
    };
  }
  return _envConfig;
}

/** @deprecated — use getEnvLLMConfig or resolveConfig */
export const getLLMConfig = getEnvLLMConfig;

/** Load per-project LLM settings from Postgres */
export async function getProjectLLMSettings(projectId: string): Promise<LLMProjectSettings | null> {
  try {
    const sql = getPostgres();
    const [row] = await sql`
      SELECT settings FROM projects WHERE id = ${projectId}
    `;
    if (!row?.settings) return null;
    const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
    return settings.llm ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve final LLM config: project settings > env vars > defaults.
 * Call this in workers / API routes that have a projectId.
 */
export async function resolveConfig(
  projectId?: string,
  overrides?: Partial<LLMConfig>,
): Promise<LLMConfig> {
  const env = getEnvLLMConfig();
  let proj: LLMProjectSettings | null = null;
  if (projectId) proj = await getProjectLLMSettings(projectId);

  const provider = proj?.provider ?? env.provider;
  return {
    provider,
    apiKey: proj?.apiKey ?? env.apiKey,
    model: proj?.model ?? env.model ?? DEFAULT_MODELS[provider] ?? 'gpt-4o-mini',
    baseUrl: proj?.baseUrl ?? env.baseUrl,
    temperature: env.temperature,
    maxTokens: env.maxTokens,
    ...overrides,
  };
}

/** Check if a given config (or the env default) is usable */
export function isLLMConfigured(cfg?: LLMConfig): boolean {
  const c = cfg ?? getEnvLLMConfig();
  return c.provider === 'ollama' || !!c.apiKey;
}

// ── Main completion function ────────────────────────────────────────────────

export async function llmComplete(
  messages: LLMMessage[],
  options?: Partial<LLMConfig>,
): Promise<LLMResponse> {
  // If a full config is provided (e.g. resolved already), use it directly
  const cfg: LLMConfig = {
    ...getEnvLLMConfig(),
    ...options,
  };

  if (!isLLMConfigured(cfg)) {
    throw new Error(
      'LLM not configured — set LLM_PROVIDER and LLM_API_KEY in env or project settings',
    );
  }

  if (cfg.provider === 'anthropic') {
    return anthropicComplete(messages, cfg);
  }
  // openai and ollama use the same OpenAI-compatible API format
  return openaiComplete(messages, cfg);
}

// ── OpenAI / Ollama ─────────────────────────────────────────────────────────

async function openaiComplete(messages: LLMMessage[], cfg: LLMConfig): Promise<LLMResponse> {
  const baseUrl = cfg.baseUrl
    ?? (cfg.provider === 'ollama' ? OLLAMA_DEFAULT_URL : 'https://api.openai.com/v1');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? '{}',
    model: data.model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

// ── Anthropic ───────────────────────────────────────────────────────────────

async function anthropicComplete(messages: LLMMessage[], cfg: LLMConfig): Promise<LLMResponse> {
  const baseUrl = cfg.baseUrl ?? 'https://api.anthropic.com';

  // Anthropic separates system messages from the conversation
  const systemMsg = messages.find((m) => m.role === 'system');
  const chatMsgs = messages.filter((m) => m.role !== 'system');

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ text: string }>;
    model: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content[0]?.text ?? '{}',
    model: data.model,
    usage: {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    },
  };
}
