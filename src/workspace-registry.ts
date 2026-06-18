/**
 * Registry of per-workspace WeeekApiClient instances.
 *
 * WeeekApiClient stays single-workspace; this registry keys one client per
 * configured workspace and resolves the right one per tool call.
 */

import type { WeeekConfig } from './config.js'

import { WeeekApiClient } from './client/weeek-api-client.js'
import { WorkspaceNotFoundError } from './errors.js'

export interface WorkspaceInfo {
  baseUrl: string
  isDefault: boolean
  name: string
}

export class WorkspaceRegistry {
  constructor(
    private readonly clients: Map<string, WeeekApiClient>,
    private readonly defaultName: string,
    private readonly meta: Map<string, { baseUrl: string }>,
  ) {
    if (!clients.has(defaultName)) {
      throw new Error(
        `WorkspaceRegistry: default workspace "${defaultName}" is not registered`,
      )
    }
  }

  resolve(name?: string): WeeekApiClient {
    const key = name ?? this.defaultName
    const client = this.clients.get(key)
    if (!client) {
      throw new WorkspaceNotFoundError(key, [...this.clients.keys()])
    }
    return client
  }

  has(name: string): boolean {
    return this.clients.has(name)
  }

  list(): WorkspaceInfo[] {
    return [...this.meta.entries()].map(([name, m]) => ({
      name,
      baseUrl: m.baseUrl,
      isDefault: name === this.defaultName,
    }))
  }
}

export function createRegistry(
  config: WeeekConfig,
): WorkspaceRegistry {
  const clients = new Map<string, WeeekApiClient>()
  const meta = new Map<string, { baseUrl: string }>()
  for (const [name, ws] of Object.entries(config.workspaces)) {
    clients.set(
      name,
      new WeeekApiClient(ws.token, {
        baseUrl: ws.baseUrl,
        timeoutMs: config.requestTimeoutMs,
      }),
    )
    meta.set(name, { baseUrl: ws.baseUrl })
  }
  return new WorkspaceRegistry(clients, config.defaultWorkspace, meta)
}
