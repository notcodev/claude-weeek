import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_list_boards — NAV-03
 *
 * Lists boards within a WEEEK project. Requires project_id filter.
 * A board is a container of columns (statuses) and tasks.
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

interface RawBoard {
  id?: number | string
  name?: string
  projectId?: number | string
  title?: string
  type?: string
  [k: string]: unknown
}

interface ShapedBoard {
  id: string
  name: string
  projectId: string
  type: string | null
}

function shapeBoard(raw: RawBoard): ShapedBoard {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? raw.title ?? ''),
    projectId: String(raw.projectId ?? ''),
    type: raw.type == null ? null : String(raw.type),
  }
}

const inputSchema = {
  project_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK project ID whose boards to list. Obtain from weeek_list_projects. Required.',
    ),
  ...listParamsSchema,
  ...workspaceParamSchema,
}

export function registerListBoards(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_list_boards',
    {
      description:
        'List all boards inside a WEEEK project. Use this AFTER weeek_list_projects to discover kanban boards within a project. A board is a container of columns (statuses) and tasks. Returns array of {id, name, projectId, type}. To see the columns/statuses of a specific board, use weeek_list_board_columns next. The project_id parameter must come from weeek_list_projects — do not guess.',
      inputSchema,
    },
    async (args: {
      project_id: string
      limit?: number
      offset?: number
      workspace?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>('/tm/boards', {
          projectId: args.project_id,
          perPage: args.limit,
          offset: args.offset,
        })
        const boards = extractArray<RawBoard>(raw, 'boards').map(
          shapeBoard,
        )
        return jsonContent({ boards, count: boards.length })
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_boards')
}
