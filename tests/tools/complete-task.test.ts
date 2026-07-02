import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerCompleteTask } from '../../src/tools/write/complete-task.js'
import { fakeRegistry } from './_registry.js'

interface CompleteArgs {
  completed?: boolean
  task_id: string
}

type Handler = (args: CompleteArgs) => Promise<{
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
      typeof registerCompleteTask
    >[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

describe('weeek_complete_task tool', () => {
  let fake: ReturnType<typeof makeFakeServer>

  beforeEach(() => {
    fake = makeFakeServer()
  })

  it('registers under the weeek_complete_task name', () => {
    const client = {
      get: vi.fn(async () => ({ task: { id: 't1' } })),
      post: vi.fn(async () => ({ success: true })),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCompleteTask(fake.server, fakeRegistry(client))
    expect(fake.getName()).toBe('weeek_complete_task')
  })

  it('description distinguishes itself from move_task and update_task', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCompleteTask(fake.server, fakeRegistry(client))
    const desc = fake.getDescription()
    expect(desc).toMatch(/weeek_move_task/)
    expect(desc).toMatch(/weeek_update_task/)
    expect(desc).toMatch(/weeek_list_tasks/)
  })

  it('pOSTs to /tm/tasks/{id}/complete by default', async () => {
    const postFn = vi.fn(async () => ({ success: true }))
    const getFn = vi.fn(async () => ({
      task: { id: 't1', isCompleted: true },
    }))
    const client = {
      get: getFn,
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCompleteTask(fake.server, fakeRegistry(client))

    await fake.getHandler()({ task_id: 't1' })

    expect(postFn).toHaveBeenCalledTimes(1)
    expect(postFn.mock.calls[0]![0]).toBe('/tm/tasks/t1/complete')
    // completion is a dedicated endpoint — NOT a PUT with isCompleted
    expect(getFn).toHaveBeenCalledWith('/tm/tasks/t1')
  })

  it('pOSTs to /tm/tasks/{id}/un-complete when completed=false', async () => {
    const postFn = vi.fn(async () => ({ success: true }))
    const client = {
      get: vi.fn(async () => ({ task: { id: 't1' } })),
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCompleteTask(fake.server, fakeRegistry(client))

    await fake.getHandler()({ task_id: 't1', completed: false })

    expect(postFn.mock.calls[0]![0]).toBe('/tm/tasks/t1/un-complete')
  })

  it('never PUTs to /tm/tasks/{id} (that is update, not complete)', async () => {
    const putFn = vi.fn()
    const client = {
      get: vi.fn(async () => ({ task: { id: 't1' } })),
      post: vi.fn(async () => ({ success: true })),
      put: putFn,
      patch: vi.fn(),
    }
    registerCompleteTask(fake.server, fakeRegistry(client))

    await fake.getHandler()({ task_id: 't1' })
    expect(putFn).not.toHaveBeenCalled()
  })

  it('shapes the re-fetched task and strips workspace-schema bloat', async () => {
    const client = {
      get: vi.fn(async () => ({
        task: {
          id: 't1',
          title: 'Done',
          isCompleted: true,
          // WEEEK echoes the whole workspace custom-field schema (~80k tokens)
          customFields: [
            { id: 'cf1', options: [{ id: 'o1', name: 'x' }] },
          ],
          subscribers: ['u1', 'u2'],
        },
      })),
      post: vi.fn(async () => ({ success: true })),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCompleteTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ task_id: 't1' })
    const payload = JSON.parse(res.content[0]!.text) as Record<
      string,
      unknown
    >
    expect(payload.id).toBe('t1')
    expect(payload.isCompleted).toBe(true)
    expect('customFields' in payload).toBe(false)
    expect('subscribers' in payload).toBe(false)
  })

  it('returns isError:true on WeeekApiError, does not throw', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => {
        throw new WeeekApiError(404, 'task not found')
      }),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerCompleteTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ task_id: 'missing' })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('Resource not found')
  })
})
