/**
 * Write tool group for WEEEK MCP server.
 *
 * INFRA-06: Write tools live in this group separate from read tools so MCP
 * clients (Claude Desktop, Cursor) can require user confirmation for mutations
 * while auto-approving reads.
 *
 * 4 write tools registered:
 *   Task authoring (Plan 03-01): create_task, update_task
 *   Task lifecycle (Plan 03-02): move_task, complete_task
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { logger } from '../../logger.js'
import { registerCompleteTask } from './complete-task.js'
import { registerCreateTask } from './create-task.js'
import { registerMoveTask } from './move-task.js'
import { registerUpdateTask } from './update-task.js'

export function registerWriteTools(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  // Task authoring (Plan 03-01)
  registerCreateTask(server, registry)
  registerUpdateTask(server, registry)

  // Task lifecycle (Plan 03-02)
  registerMoveTask(server, registry)
  registerCompleteTask(server, registry)

  logger.info('registerWriteTools: 4 write tools registered')
}
