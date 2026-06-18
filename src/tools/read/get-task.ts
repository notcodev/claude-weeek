import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_get_task — TASK-02
 *
 * Returns full details of a single task by ID.
 */
import { z } from 'zod'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import {
  resolveClient,
  workspaceParamSchema,
} from '../workspace-param.js'
import { jsonContent } from './_helpers.js'

const inputSchema = {
  task_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK task ID. Obtain from weeek_list_tasks. Required.',
    ),
  ...workspaceParamSchema,
}

export function registerGetTask(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_get_task',
    {
      description:
        'Get full details of a single WEEEK task by ID. Use this AFTER weeek_list_tasks when an agent needs the complete task context — full description, priority, assignee, due date, board/column location, timestamps. The task_id must come from weeek_list_tasks — do not guess IDs.',
      inputSchema,
    },
    async (args: { task_id: string; workspace?: string }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>(
          `/tm/tasks/${encodeURIComponent(args.task_id)}`,
        )
        let task: unknown = raw
        if (
          raw &&
          typeof raw === 'object' &&
          'task' in (raw as object)
        ) {
          task = (raw as Record<string, unknown>).task
        }
        return jsonContent(task)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_get_task')
}
