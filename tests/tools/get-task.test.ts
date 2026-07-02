import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerGetTask } from '../../src/tools/read/get-task.js'
import { fakeRegistry } from './_registry.js'

type Handler = (args: {
  task_id: string
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
      typeof registerGetTask
    >[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

function makeFakeClient(getImpl: (path: string) => Promise<unknown>) {
  return {
    get: vi.fn(getImpl),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  }
}

describe('weeek_get_task tool', () => {
  let fake: ReturnType<typeof makeFakeServer>

  beforeEach(() => {
    fake = makeFakeServer()
  })

  it('registers under the weeek_get_task name', () => {
    const client = makeFakeClient(async () => ({
      task: { id: 't1' },
    }))
    registerGetTask(fake.server, fakeRegistry(client))
    expect(fake.getName()).toBe('weeek_get_task')
  })

  it('description references weeek_list_tasks', () => {
    const client = makeFakeClient(async () => ({
      task: { id: 't1' },
    }))
    registerGetTask(fake.server, fakeRegistry(client))
    const desc = fake.getDescription()
    expect(desc).toMatch(/weeek_list_tasks/)
  })

  it('gETs /tm/tasks/{id}, unwraps the envelope, and strips workspace-schema bloat', async () => {
    const getFn = vi.fn(async (path: string) => {
      expect(path).toBe('/tm/tasks/task-99')
      return {
        task: {
          id: 'task-99',
          title: 'Ship it',
          description: 'body',
          priority: 3,
          // WEEEK returns the whole workspace custom-field schema (~80k tokens)
          customFields: [
            { id: 'cf1', options: [{ id: 'o1', name: 'x' }] },
          ],
          subscribers: ['u1', 'u2'],
          subTasks: [{ id: 'st1' }],
        },
      }
    })
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerGetTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ task_id: 'task-99' })
    expect(res.isError).toBeUndefined()
    const payload = JSON.parse(res.content[0]!.text) as Record<
      string,
      unknown
    >
    expect(payload.id).toBe('task-99')
    expect(payload.title).toBe('Ship it')
    // description is kept (detailed shape), priority is normalised to string
    expect(payload.description).toBe('body')
    expect(payload.priority).toBe('3')
    // the bloat must never reach the response
    expect('customFields' in payload).toBe(false)
    expect('subscribers' in payload).toBe(false)
    expect('subTasks' in payload).toBe(false)
    expect('comments' in payload).toBe(false)
  })

  it('returns isError:true on WeeekApiError, does not throw', async () => {
    const client = makeFakeClient(async () => {
      throw new WeeekApiError(404, 'task not found')
    })
    registerGetTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ task_id: 'missing' })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('Resource not found')
  })
})
