import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_get_project — NAV-02
 *
 * Returns full details of a single project by ID. Use this after
 * weeek_list_projects to drill into a specific project's details.
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
  ...workspaceParamSchema,
  project_id: z
    .string()
    .min(1)
    .describe(
      'WEEEK project ID. Obtain from weeek_list_projects — do not guess. Required.',
    ),
}

export function registerGetProject(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_get_project',
    {
      description:
        "Get full details of a specific WEEEK project by ID. Use this AFTER weeek_list_projects to drill into a project and see its description, creation date, and settings. Returns the full project object. For listing boards inside the project, use weeek_list_boards with this project's id. The project_id parameter must be obtained from weeek_list_projects (do not guess IDs).",
      inputSchema,
    },
    async (args: { project_id: string; workspace?: string }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>(
          `/tm/projects/${encodeURIComponent(args.project_id)}`,
        )
        // WEEEK typically returns { success: true, project: {...} }
        let project: unknown = raw
        if (
          raw &&
          typeof raw === 'object' &&
          'project' in (raw as object)
        ) {
          project = (raw as Record<string, unknown>).project
        }
        return jsonContent(project)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_get_project')
}
