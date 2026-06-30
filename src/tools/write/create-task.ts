import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_create_task — TASK-04
 *
 * Creates a new task in WEEEK. Write tool: MCP clients may prompt the user for
 * confirmation before this runs. Requires title + projectId; all other fields
 * optional. Returns the shaped task object (same shape as weeek_get_task).
 */
import { z } from 'zod'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import { jsonContent } from '../read/_helpers.js'
import {
  resolveClient,
  workspaceParamSchema,
} from '../workspace-param.js'

function unwrapTask(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'task' in (raw as object)) {
    return (raw as Record<string, unknown>).task
  }
  return raw
}

const inputSchema = {
  ...workspaceParamSchema,
  title: z
    .string()
    .min(1)
    .describe(
      "Task title. Required. Shown as the task's headline in WEEEK.",
    ),
  project_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK project ID. Required. Obtain from weeek_list_projects — do not guess.',
    ),
  description: z
    .string()
    .describe(
      'Task description / body. Optional. Plain text; WEEEK may render basic formatting.',
    )
    .optional(),
  board_id: z
    .string()
    .min(1)
    .describe(
      'Board hint. Optional and informational only — WEEEK derives the board from board_column_id, so pass board_column_id to place the task on a board. Obtain from weeek_list_boards.',
    )
    .optional(),
  board_column_id: z
    .string()
    .min(1)
    .describe(
      "Column (status) to place the task in. Optional. Obtain from weeek_list_board_columns. Determines the task's initial status.",
    )
    .optional(),
  priority: z
    .number()
    .int()
    .describe(
      'Task priority as an integer (WEEEK uses numeric priority levels, e.g. 0=none, 1=low, 2=medium, 3=high). Optional.',
    )
    .optional(),
  assignee_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK user UUID to assign as primary. Optional. Obtain from weeek_list_workspace_members — do not guess IDs.',
    )
    .optional(),
  date_end: z
    .string()
    .describe(
      "Due date in ISO 8601 format (e.g. 2026-04-15 or 2026-04-15T12:00:00Z). Optional. WEEEK's task model uses dateEnd, not dueDate.",
    )
    .optional(),
}

export function registerCreateTask(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_create_task',
    {
      description:
        "Create a NEW task in WEEEK. WRITE OPERATION — the MCP client may prompt for user confirmation before this runs. Required: title and project_id. Optional: description, board_id, board_column_id (status), priority, assignee_id, due_date. Returns the created task object in the same shape as weeek_get_task. Use this ONLY when creating a brand-new task; to change an existing task's fields use weeek_update_task, to move it to a different column use weeek_move_task, to mark it done use weeek_complete_task. All *_id parameters must come from the corresponding list tools — do not guess IDs.",
      inputSchema,
    },
    async (args: {
      workspace?: string
      title: string
      project_id: string
      description?: string
      board_id?: string
      board_column_id?: string
      priority?: number
      assignee_id?: string
      date_end?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        // WEEEK create REQUIRES a `locations` array; the task's project and
        // board column live INSIDE each location entry (POST /tm/tasks). The
        // board is implied by the column, so there is no top-level boardId.
        const location: Record<string, unknown> = {
          projectId: args.project_id,
        }
        if (args.board_column_id !== undefined)
          location.boardColumnId = args.board_column_id

        const body: Record<string, unknown> = {
          locations: [location],
          title: args.title,
        }
        if (args.description !== undefined)
          body.description = args.description
        if (args.priority !== undefined) body.priority = args.priority
        if (args.assignee_id !== undefined)
          body.userId = args.assignee_id
        if (args.date_end !== undefined) body.dateEnd = args.date_end

        const raw = await client.post<unknown>('/tm/tasks', body)
        const task = unwrapTask(raw)
        return jsonContent(task)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_create_task')
}
