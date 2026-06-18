import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_list_workspaces
 *
 * Lists the workspaces configured for this MCP server so the agent can pass a
 * `workspace` argument to other tools. Returns name, baseUrl, and which one is
 * the default. NEVER returns API tokens.
 */
import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import { jsonContent } from './_helpers.js'

export function registerListWorkspaces(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_list_workspaces',
    {
      description:
        'List the WEEEK workspaces configured for this server. Returns each ' +
        "workspace's name, baseUrl, and whether it is the default. Use a " +
        'returned name as the optional `workspace` argument on any other tool ' +
        'to target that workspace. Never returns API tokens. Call this when a ' +
        'user references more than one workspace or asks which workspaces exist.',
      inputSchema: {},
    },
    async () => {
      try {
        const workspaces = registry.list()
        return jsonContent({ workspaces, count: workspaces.length })
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_workspaces')
}
