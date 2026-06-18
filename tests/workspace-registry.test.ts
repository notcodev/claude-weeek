import { describe, expect, it } from 'vitest'

import { WeeekApiClient } from '../src/client/weeek-api-client.js'
import { WorkspaceNotFoundError } from '../src/errors.js'
import { createRegistry, WorkspaceRegistry } from '../src/workspace-registry.js'

function clients() {
  return new Map([
    ['main', new WeeekApiClient('t1', { baseUrl: 'https://main.example/v1' })],
    ['alt', new WeeekApiClient('t2', { baseUrl: 'https://alt.example/v1' })],
  ])
}
function meta() {
  return new Map([
    ['main', { baseUrl: 'https://main.example/v1' }],
    ['alt', { baseUrl: 'https://alt.example/v1' }],
  ])
}

describe('WorkspaceRegistry', () => {
  it('resolve(undefined) returns the default workspace client', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    expect(reg.resolve()).toBe(reg.resolve('main'))
  })

  it('resolve(name) returns that workspace client', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    expect(reg.resolve('alt')).not.toBe(reg.resolve('main'))
  })

  it('resolve(unknown) throws WorkspaceNotFoundError listing names', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    try {
      reg.resolve('ghost')
      expect.fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceNotFoundError)
      expect((err as WorkspaceNotFoundError).available.sort()).toEqual([
        'alt',
        'main',
      ])
    }
  })

  it('has() reflects membership', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    expect(reg.has('alt')).toBe(true)
    expect(reg.has('ghost')).toBe(false)
  })

  it('list() exposes names + baseUrl + isDefault, never tokens', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    const list = reg.list()
    expect(list).toContainEqual({
      name: 'main',
      baseUrl: 'https://main.example/v1',
      isDefault: true,
    })
    expect(JSON.stringify(list)).not.toContain('t1')
  })

  it('constructor rejects a default not present in clients', () => {
    expect(() => new WorkspaceRegistry(clients(), 'ghost', meta())).toThrow()
  })
})

describe('createRegistry', () => {
  it('builds one client per configured workspace', () => {
    const reg = createRegistry({
      defaultWorkspace: 'a',
      requestTimeoutMs: 30_000,
      workspaces: {
        a: { token: 't', baseUrl: 'https://a.example/v1' },
        b: { token: 'u', baseUrl: 'https://b.example/v1' },
      },
    })
    expect(reg.has('a')).toBe(true)
    expect(reg.has('b')).toBe(true)
    expect(reg.list().find((w) => w.name === 'a')!.isDefault).toBe(true)
  })
})
