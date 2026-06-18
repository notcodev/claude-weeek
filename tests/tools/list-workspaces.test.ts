import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceRegistry } from '../../src/workspace-registry.js'

import { registerListWorkspaces } from '../../src/tools/read/list-workspaces.js'

function makeFakeServer() {
  let name = ''
  let handler:
    | ((
        args: unknown,
      ) => Promise<{ content: Array<{ text: string }> }>)
    | null = null
  const server = {
    registerTool: vi.fn(
      (n: string, _meta: unknown, h: typeof handler) => {
        name = n
        handler = h
      },
    ),
  }
  return {
    server: server as unknown as Parameters<
      typeof registerListWorkspaces
    >[0],
    getName: () => name,
    getHandler: () => handler!,
  }
}

describe('weeek_list_workspaces tool', () => {
  it('registers under weeek_list_workspaces and returns list() output without tokens', async () => {
    const reg = {
      list: () => [
        { name: 'main', baseUrl: 'https://m/v1', isDefault: true },
        { name: 'alt', baseUrl: 'https://a/v1', isDefault: false },
      ],
    } as unknown as WorkspaceRegistry
    const fake = makeFakeServer()
    registerListWorkspaces(fake.server, reg)
    expect(fake.getName()).toBe('weeek_list_workspaces')

    const res = await fake.getHandler()({})
    const payload = JSON.parse(res.content[0]!.text)
    expect(payload.workspaces).toHaveLength(2)
    expect(payload.workspaces[0]).toEqual({
      name: 'main',
      baseUrl: 'https://m/v1',
      isDefault: true,
    })
    expect(res.content[0]!.text).not.toContain('token')
  })
})
