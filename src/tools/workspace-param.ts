/**
 * Shared `workspace` argument for every WEEEK tool, plus the client resolver.
 * Keeps workspace selection identical across read and write tools.
 */

import { z } from 'zod'

import type { WeeekApiClient } from '../client/weeek-api-client.js'
import type { WorkspaceRegistry } from '../workspace-registry.js'

export const workspaceParamSchema = {
  workspace: z
    .string()
    .min(1)
    .describe(
      'Optional WEEEK workspace name to target. Obtain names from ' +
        'weeek_list_workspaces. If omitted, the default workspace is used.',
    )
    .optional(),
}

export function resolveClient(
  registry: WorkspaceRegistry,
  workspace?: string,
): WeeekApiClient {
  return registry.resolve(workspace)
}
