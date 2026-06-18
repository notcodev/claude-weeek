import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerListProjects } from '../../src/tools/read/list-projects.js'
import { fakeRegistry } from './_registry.js'

type Handler = (args: {
  limit?: number
  offset?: number
  workspace?: string
}) => Promise<{
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}>

function makeFakeServer() {
  let capturedName = ''
  let capturedDescription = ''
  let capturedHandler: Handler | null = null
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        meta: { description: string },
        handler: Handler,
      ) => {
        capturedName = name
        capturedDescription = meta.description
        capturedHandler = handler
      },
    ),
  }
  return {
    server: server as unknown as Parameters<
      typeof registerListProjects
    >[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

function makeFakeClient(
  getImpl: (path: string, query?: unknown) => Promise<unknown>,
) {
  return {
    get: vi.fn(getImpl),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  }
}

describe('weeek_list_projects tool', () => {
  let fake: ReturnType<typeof makeFakeServer>

  beforeEach(() => {
    fake = makeFakeServer()
  })

  it('registers under the weeek_list_projects name', () => {
    const client = makeFakeClient(async () => ({ projects: [] }))
    registerListProjects(fake.server, fakeRegistry(client))
    expect(fake.getName()).toBe('weeek_list_projects')
  })

  it("description mentions 'List projects' and references sibling tools", () => {
    const client = makeFakeClient(async () => ({ projects: [] }))
    registerListProjects(fake.server, fakeRegistry(client))
    const desc = fake.getDescription()
    expect(desc).toMatch(/list projects/i)
    // Should guide the agent to related tools
    expect(desc).toMatch(/weeek_get_project|weeek_list_boards/)
  })

  it('shapes raw projects on success (title->name, id->string)', async () => {
    const client = makeFakeClient(async (path) => {
      expect(path).toBe('/tm/projects')
      return {
        projects: [
          {
            id: 123,
            title: 'Alpha',
            parentId: null,
            isArchived: false,
          },
          {
            id: 'p2',
            title: 'Beta',
            parentId: 123,
            isArchived: true,
          },
        ],
      }
    })
    registerListProjects(fake.server, fakeRegistry(client))
    const res = await fake.getHandler()({})
    expect(res.isError).toBeUndefined()
    const payload = JSON.parse(res.content[0]!.text) as {
      projects: Array<{
        id: string
        name: string
        parentId: string | null
        isArchived: boolean
      }>
      count: number
    }
    expect(payload.count).toBe(2)
    expect(payload.projects[0]).toEqual({
      id: '123',
      name: 'Alpha',
      parentId: null,
      isArchived: false,
    })
    expect(payload.projects[1]).toEqual({
      id: 'p2',
      name: 'Beta',
      parentId: '123',
      isArchived: true,
    })
  })

  it('passes limit and offset to client.get', async () => {
    const getFn = vi.fn(async () => ({ projects: [] }))
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerListProjects(fake.server, fakeRegistry(client))
    await fake.getHandler()({ limit: 5, offset: 10 })
    expect(getFn).toHaveBeenCalledWith('/tm/projects', {
      limit: 5,
      offset: 10,
    })
  })

  it('returns isError:true on WeeekApiError, does not throw', async () => {
    const client = makeFakeClient(async () => {
      throw new WeeekApiError(404, 'not found')
    })
    registerListProjects(fake.server, fakeRegistry(client))
    const res = await fake.getHandler()({})
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('Resource not found')
  })
})
