/**
 * Read tool group for WEEEK MCP server.
 *
 * INFRA-06: Read tools live in this group separate from write tools so MCP
 * clients (Claude Desktop, Cursor) can configure auto-approve per group.
 *
 * 7 read tools registered:
 *   Navigation: list_projects, get_project, list_boards, list_board_columns
 *   Tasks: list_tasks, get_task
 *   Workspace: list_workspace_members
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { logger } from '../../logger.js'
import { registerGetProject } from './get-project.js'
import { registerGetTask } from './get-task.js'
import { registerListBoardColumns } from './list-board-columns.js'
import { registerListBoards } from './list-boards.js'
import { registerListProjects } from './list-projects.js'
import { registerListTasks } from './list-tasks.js'
import { registerListWorkspaceMembers } from './list-workspace-members.js'

export function registerReadTools(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  // Navigation
  registerListProjects(server, registry)
  registerGetProject(server, registry)
  registerListBoards(server, registry)
  registerListBoardColumns(server, registry)

  // Tasks
  registerListTasks(server, registry)
  registerGetTask(server, registry)

  // Workspace
  registerListWorkspaceMembers(server, registry)

  logger.info('registerReadTools: 7 read tools registered')
}
