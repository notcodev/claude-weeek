import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_list_board_columns — NAV-04
 *
 * Lists columns (statuses) of a WEEEK board. Required before weeek_move_task
 * in Phase 3 so the agent can pick a valid target column.
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

interface RawColumn {
  boardId?: number | string
  id?: number | string
  name?: string
  order?: number
  title?: string
  [k: string]: unknown
}

interface ShapedColumn {
  boardId: string
  id: string
  name: string
  order: number | null
}

function shapeColumn(raw: RawColumn): ShapedColumn {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? raw.title ?? ''),
    boardId: String(raw.boardId ?? ''),
    order: typeof raw.order === 'number' ? raw.order : null,
  }
}

const inputSchema = {
  board_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK board ID whose columns to list. Obtain from weeek_list_boards. Required.',
    ),
  ...listParamsSchema,
  ...workspaceParamSchema,
}

export function registerListBoardColumns(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_list_board_columns',
    {
      description:
        "List columns (status buckets) of a specific WEEEK board. Use this AFTER weeek_list_boards to understand the statuses that exist on a board — e.g. 'Todo', 'In Progress', 'Done'. Columns are the task status mechanism in WEEEK; you MUST call this before weeek_move_task (Phase 3) to know which column_id to target. Returns array of {id, name, boardId, order}. The board_id parameter must come from weeek_list_boards — do not guess.",
      inputSchema,
    },
    async (args: {
      board_id: string
      limit?: number
      offset?: number
      workspace?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>('/tm/board-columns', {
          boardId: args.board_id,
          limit: args.limit,
          offset: args.offset,
        })
        const columns = extractArray<RawColumn>(
          raw,
          'boardColumns',
        ).map(shapeColumn)
        return jsonContent({ columns, count: columns.length })
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_board_columns')
}
