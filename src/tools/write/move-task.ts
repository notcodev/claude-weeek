import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_move_task — TASK-06
 *
 * Moves a task to a different board column. In WEEEK, changing a task's column
 * IS the status change — there is no separate "status" field on tasks. This is
 * why move_task is a dedicated tool, distinct from update_task (field edits)
 * and complete_task (done/undone toggle).
 *
 * Write tool: MCP clients may prompt for confirmation.
 */
import { z } from 'zod'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import {
  jsonContent,
  shapeTaskDetail,
  unwrapTask,
} from '../read/_helpers.js'
import {
  resolveClient,
  workspaceParamSchema,
} from '../workspace-param.js'

const inputSchema = {
  ...workspaceParamSchema,
  task_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK task ID to move. Required. Obtain from weeek_list_tasks.',
    ),
  board_column_id: z
    .string()
    .min(1)
    .describe(
      'Destination column ID. Required. Obtain from weeek_list_board_columns. Moving a task to a new column IS the status change in WEEEK.',
    ),
  board_id: z
    .string()
    .min(1)
    .describe(
      'Destination board ID. Optional — only needed when moving the task to a column on a DIFFERENT board than its current one.',
    )
    .optional(),
}

export function registerMoveTask(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_move_task',
    {
      description:
        "Move a WEEEK task to a different board column. This IS how you change a task's status in WEEEK — columns ARE the status mechanism. WRITE OPERATION — the MCP client may prompt for confirmation. Required: task_id and board_column_id. Optional: board_id (only when moving across boards). Returns the updated task. DISTINCT from weeek_update_task: use update for field edits (title, description, priority, assignee, due date); use move for column/status changes. DISTINCT from weeek_complete_task: use complete for the done/undone toggle even though 'completed' is visually similar to a 'Done' column. board_column_id must come from weeek_list_board_columns — do not guess.",
      inputSchema,
    },
    async (args: {
      workspace?: string
      task_id: string
      board_column_id: string
      board_id?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const taskPath = `/tm/tasks/${encodeURIComponent(args.task_id)}`

        // Moving in WEEEK uses dedicated endpoints, NOT a task update:
        //   - cross-board move: POST /tm/tasks/{id}/board       { boardId }
        //   - column placement: POST /tm/tasks/{id}/board-column { boardColumnId }
        // When changing boards, set the board first, then the column.
        if (args.board_id !== undefined) {
          await client.post<unknown>(`${taskPath}/board`, {
            boardId: args.board_id,
          })
        }
        await client.post<unknown>(`${taskPath}/board-column`, {
          boardColumnId: args.board_column_id,
        })

        // The move endpoints return only { success: true }; re-fetch the task
        // so the caller gets the updated task object (matches the tool's docs).
        const raw = await client.get<unknown>(taskPath)
        return jsonContent(shapeTaskDetail(unwrapTask(raw)))
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_move_task')
}
