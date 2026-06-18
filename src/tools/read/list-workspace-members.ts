/**
 * weeek_list_workspace_members — list members of the WEEEK workspace.
 *
 * Returns user IDs and display info. Required before using assignee_id
 * filter in weeek_list_tasks or setting assignee_id on create/update task.
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

interface RawMember {
  avatarUrl?: string
  email?: string
  firstName?: string
  id?: number | string
  lastName?: string
  name?: string
  role?: string
  [k: string]: unknown
}

interface ShapedMember {
  email: string | null
  id: string
  name: string
  role: string | null
}

function shapeMember(raw: RawMember): ShapedMember {
  const first = raw.firstName ?? ''
  const last = raw.lastName ?? ''
  const composed = [first, last].filter(Boolean).join(' ').trim()
  const name =
    composed || raw.name || raw.email || String(raw.id ?? '')
  return {
    id: String(raw.id ?? ''),
    email: raw.email ?? null,
    name,
    role: raw.role ?? null,
  }
}

const inputSchema = { ...listParamsSchema, ...workspaceParamSchema }

export function registerListWorkspaceMembers(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_list_workspace_members',
    {
      description:
        "List members (users) of the WEEEK workspace. Use this FIRST when an agent needs to resolve a person's name to a user ID — required before filtering tasks by assignee_id in weeek_list_tasks or setting assignee_id on weeek_create_task / weeek_update_task. Returns shaped members with id, name, email, role. Pagination ENFORCED: default 20, max 50 per response. The WEEEK workspace is determined by the API token.",
      inputSchema,
    },
    async (args: {
      limit?: number
      offset?: number
      workspace?: string
    }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>('/ws/members', {
          limit: args.limit,
          offset: args.offset,
        })
        const members = extractArray<RawMember>(raw, 'members').map(
          shapeMember,
        )
        const hasMore =
          raw &&
          typeof raw === 'object' &&
          'hasMore' in (raw as object)
            ? Boolean((raw as Record<string, unknown>).hasMore)
            : members.length === (args.limit ?? 20)
        return jsonContent({
          members,
          count: members.length,
          hasMore,
        })
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_workspace_members')
}
