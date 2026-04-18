/** Default API port */
export const DEFAULT_API_PORT = 4400;

/** Default dashboard port */
export const DEFAULT_DASHBOARD_PORT = 3000;

/** Max spans per batch */
export const MAX_BATCH_SIZE = 1000;

/** Default SDK flush interval in milliseconds */
export const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/** Default SDK batch size before auto-flush */
export const DEFAULT_BATCH_THRESHOLD = 100;

/** Default project retention in days */
export const DEFAULT_RETENTION_DAYS = 30;

/** MCP method names for span classification */
export const MCP_METHODS = {
  TOOLS_CALL: 'tools/call',
  TOOLS_LIST: 'tools/list',
  RESOURCES_READ: 'resources/read',
  RESOURCES_LIST: 'resources/list',
  PROMPTS_GET: 'prompts/get',
  PROMPTS_LIST: 'prompts/list',
  SAMPLING_CREATE_MESSAGE: 'sampling/createMessage',
  INITIALIZE: 'initialize',
} as const;

/** Known LLM providers for cost calculation */
export const LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'mistral',
  'groq',
  'cohere',
  'ollama',
  'azure',
  'bedrock',
] as const;

/** API key header name */
export const API_KEY_HEADER = 'x-api-key';

/** API version prefix */
export const API_VERSION = 'v1';
