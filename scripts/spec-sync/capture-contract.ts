/**
 * Drives the real tool handlers against a RecordingClient to capture the exact
 * requests the code emits. A fake MCP server collects each tool's handler +
 * input schema; a fake registry hands every handler a fresh RecordingClient so
 * each invocation's requests are isolated.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WeeekApiClient } from '../../src/client/weeek-api-client.js'
import type { WorkspaceRegistry } from '../../src/workspace-registry.js'
import type { CapturedRequest } from './types.js'

import { registerReadTools } from '../../src/tools/read/index.js'
import { registerWriteTools } from '../../src/tools/write/index.js'
import { RecordingClient } from './recording-client.js'

interface RegisteredTool {
  name: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

/** Register all tools against a fake server and return their handlers. */
function collectTools(registry: WorkspaceRegistry): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  const server = {
    registerTool: (
      name: string,
      def: { inputSchema?: Record<string, unknown> },
      handler: RegisteredTool['handler'],
    ) => {
      tools.push({ name, inputSchema: def.inputSchema ?? {}, handler })
    },
  } as unknown as McpServer
  registerReadTools(server, registry)
  registerWriteTools(server, registry)
  return tools
}

/** Tool names + their zod input shapes — used by the fixture coverage test. */
export function listRegisteredTools(): {
  name: string
  inputSchema: Record<string, unknown>
}[] {
  const client = new RecordingClient()
  const registry = {
    resolve: () => client as unknown as WeeekApiClient,
    list: () => [],
    has: () => true,
  } as unknown as WorkspaceRegistry
  return collectTools(registry).map((t) => ({
    name: t.name,
    inputSchema: t.inputSchema,
  }))
}

/** Invoke every tool with its fixtures and collect all emitted requests. */
export async function captureContract(
  fixtures: Record<string, Record<string, unknown>[]>,
): Promise<CapturedRequest[]> {
  let current = new RecordingClient()
  const registry = {
    resolve: () => current as unknown as WeeekApiClient,
    list: () => [],
    has: () => true,
  } as unknown as WorkspaceRegistry

  const tools = collectTools(registry)
  const out: CapturedRequest[] = []
  for (const tool of tools) {
    const argSets = fixtures[tool.name] ?? []
    for (const args of argSets) {
      current = new RecordingClient()
      await tool.handler(args)
      for (const rec of current.records) out.push({ tool: tool.name, ...rec })
    }
  }
  return out
}
