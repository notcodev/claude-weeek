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

  it('gETs /tm/tasks/{id} and unwraps the task envelope', async () => {
    const getFn = vi.fn(async (path: string) => {
      expect(path).toBe('/tm/tasks/task-99')
      return {
        task: {
          id: 'task-99',
          title: 'Ship it',
          description: 'body',
          priority: 3,
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
