/**
 * weeek_list_projects — NAV-01
 *
 * Lists projects in the WEEEK workspace. First tool an agent should call
 * when it needs to discover what projects exist before drilling into boards
 * or tasks.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

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

interface RawWeeekProject {
  id?: number | string
  isArchived?: boolean
  name?: string
  parentId?: number | string | null
  title?: string
  [k: string]: unknown
}

interface ShapedProject {
  id: string
  isArchived: boolean
  name: string
  parentId: string | null
}

function shapeProject(raw: RawWeeekProject): ShapedProject {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.title ?? raw.name ?? ''),
    parentId: raw.parentId == null ? null : String(raw.parentId),
    isArchived: Boolean(raw.isArchived),
  }
}

const inputSchema = {
  ...listParamsSchema,
  ...workspaceParamSchema,
}

export function registerListProjects(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_list_projects',
    {
      description:
        "List projects in the WEEEK workspace. Use this FIRST when an agent needs to discover what projects exist before drilling into boards or tasks. Returns an array of projects with id, name, parentId (for nested projects), and isArchived flag. For a specific project's full details, use weeek_get_project with the id returned here. For board discovery within a project, use weeek_list_boards next.",
      inputSchema,
    },
    async (args: {
      limit?: number
      offset?: number
      workspace?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>('/tm/projects', {
          limit: args.limit,
          offset: args.offset,
        })
        const projects = extractArray<RawWeeekProject>(
          raw,
          'projects',
        ).map(shapeProject)
        return jsonContent({ projects, count: projects.length })
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_projects')
}
