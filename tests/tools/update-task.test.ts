import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { DESCRIPTION_HTML_GUIDANCE_UPDATE } from '../../src/tools/write/_shared.js'
import { registerUpdateTask } from '../../src/tools/write/update-task.js'
import { fakeRegistry } from './_registry.js'

interface UpdateArgs {
  assignee_id?: string
  date_end?: string
  description?: string
  priority?: number
  task_id: string
  title?: string
}

type Handler = (args: UpdateArgs) => Promise<{
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}>

function makeFakeServer() {
  let capturedName = ''
  let capturedDescription = ''
  let capturedInputSchema: Record<string, { description?: string }> =
    {}
  let capturedHandler: Handler | null = null
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        meta: {
          description: string
          inputSchema: Record<string, { description?: string }>
        },
        handler: Handler,
      ) => {
        capturedName = name
        capturedDescription = meta.description
        capturedInputSchema = meta.inputSchema
        capturedHandler = handler
      },
    ),
  }
  return {
    server: server as unknown as Parameters<
      typeof registerUpdateTask
    >[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    description: () => capturedDescription,
    inputSchema: () => capturedInputSchema,
    getHandler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

describe('weeek_update_task tool', () => {
  let fake: ReturnType<typeof makeFakeServer>

  beforeEach(() => {
    fake = makeFakeServer()
  })

  it('registers under the weeek_update_task name', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(async () => ({ task: { id: 't1' } })),
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))
    expect(fake.getName()).toBe('weeek_update_task')
  })

  it('description distinguishes itself from move_task and complete_task', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))
    const desc = fake.getDescription()
    expect(desc).toMatch(/weeek_move_task/)
    expect(desc).toMatch(/weeek_complete_task/)
  })

  it('description field advertises the WEEEK HTML subset', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))
    const guide = fake.inputSchema().description?.description ?? ''
    expect(guide).toBe(DESCRIPTION_HTML_GUIDANCE_UPDATE)
    for (const marker of [
      '<p>',
      '<strong>',
      '<em>',
      '<a href',
      '<br>',
      '<li>',
      '&lt;',
      'Plain text is still accepted',
      // update-only tail must survive
      'Omit to leave unchanged',
      'Pass empty string to clear',
    ]) {
      expect(guide).toContain(marker)
    }
  })

  it('tool description mentions HTML formatting', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))
    expect(fake.description()).toMatch(/HTML/)
  })

  it('pUTs to /tm/tasks/{id} with only provided camelCase fields', async () => {
    const putFn = vi.fn(async () => ({
      task: { id: 't1', title: 'Updated' },
    }))
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: putFn,
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))

    await fake.getHandler()({
      task_id: 't1',
      title: 'Updated',
      assignee_id: 'u5',
      date_end: '2026-12-31',
    })

    expect(putFn).toHaveBeenCalledTimes(1)
    const [path, body] = putFn.mock.calls[0]!
    expect(path).toBe('/tm/tasks/t1')
    // WEEEK uses userId (not assigneeId) and dueDate (not dateEnd) on the write path
    expect(body).toEqual({
      title: 'Updated',
      userId: 'u5',
      dueDate: '2026-12-31',
    })
    expect(
      (body as Record<string, unknown>).description,
    ).toBeUndefined()
    expect((body as Record<string, unknown>).priority).toBeUndefined()
  })

  it('shapes the updated task and strips workspace-schema bloat', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(async () => ({
        task: {
          id: 't1',
          title: 'Updated',
          description: 'body',
          // WEEEK echoes the whole workspace custom-field schema (~80k tokens)
          customFields: [
            { id: 'cf1', options: [{ id: 'o1', name: 'x' }] },
          ],
          subscribers: ['u1', 'u2'],
        },
      })),
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({
      task_id: 't1',
      title: 'Updated',
    })
    const payload = JSON.parse(res.content[0]!.text) as Record<
      string,
      unknown
    >
    expect(payload.id).toBe('t1')
    expect(payload.title).toBe('Updated')
    expect(payload.description).toBe('body')
    expect('customFields' in payload).toBe(false)
    expect('subscribers' in payload).toBe(false)
  })

  it('returns isError when no editable fields are provided', async () => {
    const putFn = vi.fn()
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: putFn,
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ task_id: 't1' })
    expect(res.isError).toBe(true)
    expect(putFn).not.toHaveBeenCalled()
  })

  it('returns isError:true on WeeekApiError, does not throw', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(async () => {
        throw new WeeekApiError(403, 'forbidden')
      }),
      patch: vi.fn(),
    }
    registerUpdateTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ task_id: 't1', title: 'x' })
    expect(res.isError).toBe(true)
  })
})
