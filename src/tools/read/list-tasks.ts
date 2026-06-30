import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_list_tasks — TASK-01 + TASK-03
 *
 * Lists tasks with filtering by project, board, column, assignee, and
 * completion state. Pagination is ENFORCED via listParamsSchema (default 20,
 * max 50) — this is the primary INFRA-07 mitigation because tasks are the
 * highest-volume resource in WEEEK.
 */
import { z } from 'zod'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import {
  resolveClient,
  workspaceParamSchema,
} from '../workspace-param.js'
import {
  extractArray,
  jsonContent,
  listParamsSchema,
} from './_helpers.js'

interface RawTask {
  assignees?: Array<string>
  authorId?: string | null
  boardColumnId?: number | string
  boardId?: number | string
  date?: string | null
  dateEnd?: string | null
  dateStart?: string | null
  id?: number | string
  isCompleted?: boolean
  isDeleted?: boolean
  parentId?: number | string | null
  priority?: number | string
  projectId?: number | string
  tags?: Array<number | string>
  title?: string
  type?: string
  updatedAt?: string | null
  userId?: string | null
  [k: string]: unknown
}

interface ShapedTask {
  /** Primary assignee (WEEEK's userId field). */
  assigneeId: string | null
  /** All assignees (WEEEK's assignees array — tasks can have multiple). */
  assigneeIds: string[]
  authorId: string | null
  boardColumnId: string | null
  boardId: string | null
  dateEnd: string | null
  dateStart: string | null
  id: string
  isCompleted: boolean
  parentId: string | null
  priority: string | null
  projectId: string | null
  tags: string[]
  title: string
  type: string | null
  updatedAt: string | null
}

function shapeTask(raw: RawTask): ShapedTask {
  const assigneeIds = Array.isArray(raw.assignees)
    ? raw.assignees.map((u) => String(u))
    : []
  const primaryAssignee =
    (raw.userId ?? null) != null
      ? String(raw.userId)
      : (assigneeIds[0] ?? null)
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    type: raw.type ?? null,
    parentId: raw.parentId == null ? null : String(raw.parentId),
    projectId: raw.projectId == null ? null : String(raw.projectId),
    boardId: raw.boardId == null ? null : String(raw.boardId),
    boardColumnId:
      raw.boardColumnId == null ? null : String(raw.boardColumnId),
    assigneeId: primaryAssignee,
    assigneeIds,
    authorId: raw.authorId == null ? null : String(raw.authorId),
    isCompleted: Boolean(raw.isCompleted),
    priority: raw.priority == null ? null : String(raw.priority),
    dateStart: raw.dateStart ?? null,
    dateEnd: raw.dateEnd ?? null,
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t))
      : [],
    updatedAt: raw.updatedAt ?? null,
  }
}

const inputSchema = {
  project_id: z
    .string()
    .min(1)
    .describe(
      'Filter to tasks in this project. Obtain from weeek_list_projects.',
    )
    .optional(),
  board_id: z
    .string()
    .min(1)
    .describe(
      'Filter to tasks on this board. Obtain from weeek_list_boards.',
    )
    .optional(),
  column_id: z
    .string()
    .min(1)
    .describe(
      'Filter to tasks in this column (status). Obtain from weeek_list_board_columns.',
    )
    .optional(),
  assignee_id: z
    .string()
    .min(1)
    .describe(
      'Filter to tasks assigned to this user (WEEEK user UUID). Obtain from weeek_list_workspace_members.',
    )
    .optional(),
  is_completed: z
    .boolean()
    .describe(
      'If true, return only completed tasks; if false, only open; if omitted, both.',
    )
    .optional(),
  ...listParamsSchema,
  ...workspaceParamSchema,
}

export function registerListTasks(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_list_tasks',
    {
      description:
        "List tasks in WEEEK with optional filters. This is the PRIMARY tool for 'what needs doing?' queries. Filter by project_id, board_id, column_id (status), assignee_id, or is_completed. Pagination is ENFORCED: default 20, max 50 per response, to stay under the 25k-token MCP response cap — call again with a higher offset if more are needed. Returns shaped tasks with id, title, projectId, boardId, boardColumnId, assigneeId, isCompleted, priority, dueDate. For full task description and details, use weeek_get_task with an id returned here. All *_id parameters must come from weeek_list_projects / weeek_list_boards / weeek_list_board_columns — do not guess IDs.",
      inputSchema,
    },
    async (args: {
      project_id?: string
      board_id?: string
      column_id?: string
      assignee_id?: string
      is_completed?: boolean
      limit?: number
      offset?: number
      workspace?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>('/tm/tasks', {
          projectId: args.project_id,
          boardId: args.board_id,
          boardColumnId: args.column_id,
          userId: args.assignee_id,
          completed: args.is_completed === undefined ? undefined : args.is_completed ? 1 : 0,
          perPage: args.limit,
          offset: args.offset,
        })
        const tasks = extractArray<RawTask>(raw, 'tasks').map(
          shapeTask,
        )
        const hasMore =
          raw &&
          typeof raw === 'object' &&
          'hasMore' in (raw as object)
            ? Boolean((raw as Record<string, unknown>).hasMore)
            : tasks.length === (args.limit ?? 20)
        return jsonContent({ tasks, count: tasks.length, hasMore })
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_tasks')
}
