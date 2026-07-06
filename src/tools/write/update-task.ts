import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_update_task — TASK-05
 *
 * Updates editable fields on an existing task. Write tool: MCP clients may
 * prompt for confirmation. Only provided fields are sent to WEEEK — omitted
 * fields are left unchanged. Returns the updated task (same shape as weeek_get_task).
 *
 * This is NOT the right tool for:
 *   - Moving between columns → use weeek_move_task
 *   - Marking complete/incomplete → use weeek_complete_task
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
import { DESCRIPTION_HTML_GUIDANCE_UPDATE } from './_shared.js'

const inputSchema = {
  ...workspaceParamSchema,
  task_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK task ID to update. Required. Obtain from weeek_list_tasks — do not guess.',
    ),
  title: z
    .string()
    .min(1)
    .describe('New task title. Optional. Omit to leave unchanged.')
    .optional(),
  description: z
    .string()
    .describe(DESCRIPTION_HTML_GUIDANCE_UPDATE)
    .optional(),
  priority: z
    .number()
    .int()
    .describe(
      'New priority integer (e.g. 0=none, 1=low, 2=medium, 3=high). Optional.',
    )
    .optional(),
  assignee_id: z
    .string()
    .min(1)
    .describe(
      'New primary assignee WEEEK user UUID. Optional. Obtain from weeek_list_workspace_members. Omit to leave unchanged.',
    )
    .optional(),
  date_end: z
    .string()
    .describe(
      'New due date in ISO 8601. Optional. Omit to leave unchanged.',
    )
    .optional(),
}

export function registerUpdateTask(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_update_task',
    {
      description:
        'Update editable fields of an EXISTING task in WEEEK. WRITE OPERATION — the MCP client may prompt for confirmation. Required: task_id. Optional: title, description, priority, assignee_id, due_date — only provided fields are sent, omitted fields remain unchanged. Returns the updated task. Do NOT use this to move tasks between columns (use weeek_move_task) or to mark tasks complete (use weeek_complete_task) — those are separate operations in WEEEK. The task_id must come from weeek_list_tasks. The description parameter accepts a small WEEEK HTML subset (paragraphs, bold, italic, links, lists) for rich formatting — see its parameter guidance for the exact allowed tags.',
      inputSchema,
    },
    async (args: {
      workspace?: string
      task_id: string
      title?: string
      description?: string
      priority?: number
      assignee_id?: string
      date_end?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const body: Record<string, unknown> = {}
        if (args.title !== undefined) body.title = args.title
        if (args.description !== undefined)
          body.description = args.description
        if (args.priority !== undefined) body.priority = args.priority
        if (args.assignee_id !== undefined)
          body.userId = args.assignee_id
        if (args.date_end !== undefined) body.dueDate = args.date_end

        if (Object.keys(body).length === 0) {
          return toMcpError(
            new Error(
              'weeek_update_task: at least one editable field must be provided (title, description, priority, assignee_id, or date_end)',
            ),
          )
        }

        const raw = await client.put<unknown>(
          `/tm/tasks/${encodeURIComponent(args.task_id)}`,
          body,
        )
        return jsonContent(shapeTaskDetail(unwrapTask(raw)))
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_update_task')
}
