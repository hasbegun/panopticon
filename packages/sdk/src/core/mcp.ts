import type { Trace } from './trace.js';

/**
 * Minimal interface for an MCP Client — matches @modelcontextprotocol/sdk Client.
 * We don't import the actual SDK to avoid a hard dependency.
 */
export interface MCPClientLike {
  callTool(params: { name: string; arguments?: Record<string, unknown> }, ...rest: unknown[]): Promise<unknown>;
  readResource?(params: { uri: string }, ...rest: unknown[]): Promise<unknown>;
  getPrompt?(params: { name: string; arguments?: Record<string, unknown> }, ...rest: unknown[]): Promise<unknown>;
}

export interface InstrumentMCPOptions {
  /** MCP server name — stored in metadata.mcpServer (e.g. "filesystem-mcp") */
  serverName?: string;
}

type StartTraceFn = (agentId: string) => Trace;

/**
 * Wraps an MCP client with automatic span creation for callTool, readResource, and getPrompt.
 *
 * Returns a Proxy — the original client is not mutated.
 */
export function instrumentMCPClient<T extends MCPClientLike>(
  client: T,
  getTrace: () => Trace | null,
  options: InstrumentMCPOptions = {},
): T {
  const serverName = options.serverName ?? 'unknown-mcp';

  return new Proxy(client, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);

      if (prop === 'callTool' && typeof orig === 'function') {
        return async function wrappedCallTool(params: { name: string; arguments?: Record<string, unknown> }, ...rest: unknown[]) {
          const trace = getTrace();
          if (!trace) return orig.call(target, params, ...rest);

          const span = trace.startSpan({
            type: 'mcp_request',
            name: `tools/call:${params.name}`,
          });
          span.setInput({ tool: params.name, arguments: params.arguments });
          span.setMetadata({ mcpServer: serverName, mcpMethod: 'tools/call', toolName: params.name });

          try {
            const result = await orig.call(target, params, ...rest);
            span.setOutput(result);
            span.end();
            return result;
          } catch (err) {
            span.recordError(err instanceof Error ? err : new Error(String(err)));
            span.end();
            throw err;
          }
        };
      }

      if (prop === 'readResource' && typeof orig === 'function') {
        return async function wrappedReadResource(params: { uri: string }, ...rest: unknown[]) {
          const trace = getTrace();
          if (!trace) return orig.call(target, params, ...rest);

          const span = trace.startSpan({
            type: 'resource_read',
            name: `resources/read`,
          });
          span.setInput({ uri: params.uri });
          span.setMetadata({ mcpServer: serverName, mcpMethod: 'resources/read', resourceUri: params.uri });

          try {
            const result = await orig.call(target, params, ...rest);
            span.setOutput(result);
            span.end();
            return result;
          } catch (err) {
            span.recordError(err instanceof Error ? err : new Error(String(err)));
            span.end();
            throw err;
          }
        };
      }

      if (prop === 'getPrompt' && typeof orig === 'function') {
        return async function wrappedGetPrompt(params: { name: string; arguments?: Record<string, unknown> }, ...rest: unknown[]) {
          const trace = getTrace();
          if (!trace) return orig.call(target, params, ...rest);

          const span = trace.startSpan({
            type: 'mcp_request',
            name: `prompts/get:${params.name}`,
          });
          span.setInput({ prompt: params.name, arguments: params.arguments });
          span.setMetadata({ mcpServer: serverName, mcpMethod: 'prompts/get', toolName: params.name });

          try {
            const result = await orig.call(target, params, ...rest);
            span.setOutput(result);
            span.end();
            return result;
          } catch (err) {
            span.recordError(err instanceof Error ? err : new Error(String(err)));
            span.end();
            throw err;
          }
        };
      }

      return orig;
    },
  });
}
