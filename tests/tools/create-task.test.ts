import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerCreateTask } from '../../src/tools/write/create-task.js'
import { fakeRegistry } from './_registry.js'

interface CreateArgs {
  assignee_id?: string
  board_column_id?: string
  board_id?: string
  date_end?: string
  description?: string
  priority?: number
  project_id: string
  title: string
}

type Handler = (args: CreateArgs) => Promise<{
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
      typeof registerCreateTask
    >[0],
    name: () => capturedName,
    description: () => capturedDescription,
    handler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

describe('weeek_create_task tool', () => {
  let fake: ReturnType<typeof makeFakeServer>

  beforeEach(() => {
    fake = makeFakeServer()
  })

  it('registers as weeek_create_task', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => ({
        task: { id: 't1', title: 'hello' },
      })),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCreateTask(fake.server, fakeRegistry(client))
    expect(fake.name()).toBe('weeek_create_task')
  })

  it('description distinguishes itself from update/move/complete', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCreateTask(fake.server, fakeRegistry(client))
    const desc = fake.description()
    expect(desc).toMatch(/create/i)
    expect(desc).toMatch(/weeek_update_task/)
  })

  it('pOSTs to /tm/tasks with a locations[] array (WEEEK spec)', async () => {
    const postFn = vi.fn(async () => ({ task: { id: 't1' } }))
    const client = {
      get: vi.fn(),
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCreateTask(fake.server, fakeRegistry(client))

    await fake.handler()({
      title: 'Ship it',
      project_id: 'p1',
      description: 'body text',
      board_id: 'b1',
      board_column_id: 'col1',
      priority: 3,
      assignee_id: 'u1',
      date_end: '2026-05-01',
    })

    expect(postFn).toHaveBeenCalledTimes(1)
    const [path, body] = postFn.mock.calls[0]!
    expect(path).toBe('/tm/tasks')
    // WEEEK create REQUIRES a locations[] array; project + column live INSIDE
    // each location (POST /tm/tasks docs). userId (not assigneeId), dueDate (not dateEnd).
    expect(body).toEqual({
      locations: [{ projectId: 'p1', boardColumnId: 'col1' }],
      title: 'Ship it',
      description: 'body text',
      priority: 3,
      userId: 'u1',
      dueDate: '2026-05-01',
    })
    // board_id is NOT a WEEEK create field — the column determines the board.
    expect('boardId' in (body as Record<string, unknown>)).toBe(false)
    expect(
      (body as { locations: Array<Record<string, unknown>> })
        .locations[0],
    ).not.toHaveProperty('boardId')
  })

  it('omits optional fields, still sends a locations[] with projectId', async () => {
    const postFn = vi.fn(async () => ({ task: { id: 't1' } }))
    const client = {
      get: vi.fn(),
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCreateTask(fake.server, fakeRegistry(client))

    await fake.handler()({ title: 'minimal', project_id: 'p1' })
    const body = postFn.mock.calls[0]![1] as Record<string, unknown>
    expect(body).toEqual({
      locations: [{ projectId: 'p1' }],
      title: 'minimal',
    })
    expect('description' in body).toBe(false)
    expect('dueDate' in body).toBe(false)
    expect('userId' in body).toBe(false)
    // no boardColumnId inside the location when none provided
    expect(
      (body as { locations: Array<Record<string, unknown>> })
        .locations[0],
    ).not.toHaveProperty('boardColumnId')
  })

  it('unwraps the {task: ...} envelope and strips workspace-schema bloat', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => ({
        task: {
          id: 't1',
          title: 'hello',
          description: 'body',
          // WEEEK echoes the whole workspace custom-field schema (~80k tokens)
          customFields: [
            { id: 'cf1', options: [{ id: 'o1', name: 'x' }] },
          ],
          subscribers: ['u1', 'u2'],
        },
      })),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCreateTask(fake.server, fakeRegistry(client))

    const res = await fake.handler()({
      title: 'hello',
      project_id: 'p1',
    })
    expect(res.isError).toBeUndefined()
    const payload = JSON.parse(res.content[0]!.text) as Record<
      string,
      unknown
    >
    expect(payload.id).toBe('t1')
    expect(payload.title).toBe('hello')
    expect(payload.description).toBe('body')
    // the bloat must never reach the response
    expect('customFields' in payload).toBe(false)
    expect('subscribers' in payload).toBe(false)
  })

  it('handles raw (non-enveloped) response', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => ({ id: 't2', title: 'raw' })),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCreateTask(fake.server, fakeRegistry(client))
    const res = await fake.handler()({
      title: 'raw',
      project_id: 'p1',
    })
    const payload = JSON.parse(res.content[0]!.text) as { id: string }
    expect(payload.id).toBe('t2')
  })

  it('returns isError:true on 401 WeeekApiError', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => {
        throw new WeeekApiError(401, 'unauthorized')
      }),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCreateTask(fake.server, fakeRegistry(client))

    const res = await fake.handler()({ title: 'x', project_id: 'p1' })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('Invalid WEEEK_API_TOKEN')
  })
})
