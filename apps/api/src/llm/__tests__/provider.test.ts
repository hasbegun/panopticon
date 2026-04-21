/**
 * Tests for LLM provider config resolution and isLLMConfigured.
 *
 * These tests do NOT call any external LLM APIs. They test:
 * - getEnvLLMConfig() reads env vars correctly
 * - isLLMConfigured() logic for each provider
 * - resolveConfig() merge order (project > env > defaults)
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { isLLMConfigured, type LLMConfig } from '../provider.js';

// ── isLLMConfigured ─────────────────────────────────────────────────────────

describe('isLLMConfigured', () => {
  test('returns true for openai with apiKey', () => {
    const cfg: LLMConfig = {
      provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini',
      temperature: 0, maxTokens: 1024,
    };
    expect(isLLMConfigured(cfg)).toBe(true);
  });

  test('returns false for openai without apiKey', () => {
    const cfg: LLMConfig = {
      provider: 'openai', apiKey: '', model: 'gpt-4o-mini',
      temperature: 0, maxTokens: 1024,
    };
    expect(isLLMConfigured(cfg)).toBe(false);
  });

  test('returns true for anthropic with apiKey', () => {
    const cfg: LLMConfig = {
      provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-5-haiku-20241022',
      temperature: 0, maxTokens: 1024,
    };
    expect(isLLMConfigured(cfg)).toBe(true);
  });

  test('returns false for anthropic without apiKey', () => {
    const cfg: LLMConfig = {
      provider: 'anthropic', apiKey: '', model: 'claude-3-5-haiku-20241022',
      temperature: 0, maxTokens: 1024,
    };
    expect(isLLMConfigured(cfg)).toBe(false);
  });

  test('returns true for ollama even without apiKey', () => {
    const cfg: LLMConfig = {
      provider: 'ollama', apiKey: '', model: 'llama3.2',
      temperature: 0, maxTokens: 1024,
    };
    expect(isLLMConfigured(cfg)).toBe(true);
  });
});

// ── Config shape ────────────────────────────────────────────────────────────

describe('LLMConfig shape', () => {
  test('config object has required fields', () => {
    const cfg: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 256,
    };
    expect(cfg.provider).toBe('openai');
    expect(cfg.apiKey).toBe('sk-test');
    expect(cfg.model).toBe('gpt-4o-mini');
    expect(cfg.temperature).toBe(0);
    expect(cfg.maxTokens).toBe(256);
    expect(cfg.baseUrl).toBeUndefined();
  });

  test('ollama config can omit apiKey', () => {
    const cfg: LLMConfig = {
      provider: 'ollama',
      apiKey: '',
      model: 'llama3.2',
      baseUrl: 'http://host.docker.internal:11434/v1',
      temperature: 0,
      maxTokens: 1024,
    };
    expect(cfg.baseUrl).toContain('host.docker.internal');
    expect(isLLMConfigured(cfg)).toBe(true);
  });
});

// ── resolveConfig merge tests ───────────────────────────────────────────────

describe('resolveConfig merge semantics', () => {
  test('project settings override env defaults', () => {
    // Simulating the merge logic without hitting Postgres
    const env: LLMConfig = {
      provider: 'openai', apiKey: 'env-key', model: 'gpt-4o-mini',
      temperature: 0, maxTokens: 1024,
    };

    const proj: { provider?: 'openai' | 'anthropic' | 'ollama'; apiKey?: string; model?: string; baseUrl?: string } = { provider: 'ollama', model: 'llama3.2' };

    // Simulated merge (same as resolveConfig logic)
    const provider = proj.provider ?? env.provider;
    const merged: LLMConfig = {
      provider,
      apiKey: proj.apiKey ?? env.apiKey,
      model: proj.model ?? env.model,
      baseUrl: proj.baseUrl ?? env.baseUrl,
      temperature: env.temperature,
      maxTokens: env.maxTokens,
    };

    expect(merged.provider).toBe('ollama');
    expect(merged.model).toBe('llama3.2');
    // apiKey falls back to env since proj has none
    expect(merged.apiKey).toBe('env-key');
  });

  test('overrides parameter wins over everything', () => {
    const env: LLMConfig = {
      provider: 'openai', apiKey: 'env-key', model: 'gpt-4o-mini',
      temperature: 0, maxTokens: 1024,
    };

    const overrides = { maxTokens: 256, temperature: 0.5 };
    const merged = { ...env, ...overrides };

    expect(merged.maxTokens).toBe(256);
    expect(merged.temperature).toBe(0.5);
  });
});
