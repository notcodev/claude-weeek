import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerMoveTask } from '../../src/tools/write/move-task.js'
import { fakeRegistry } from './_registry.js'

interface MoveArgs {
  board_column_id: string
  board_id?: string
  task_id: string
}

type Handler = (args: MoveArgs) => Promise<{
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
      typeof registerMoveTask
    >[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

describe('weeek_move_task tool', () => {
  let fake: ReturnType<typeof makeFakeServer>

  beforeEach(() => {
    fake = makeFakeServer()
  })

  it('registers under the weeek_move_task name', () => {
    const client = {
      get: vi.fn(async () => ({ task: { id: 't1' } })),
      post: vi.fn(async () => ({ success: true })),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerMoveTask(fake.server, fakeRegistry(client))
    expect(fake.getName()).toBe('weeek_move_task')
  })

  it('description explains columns as the status mechanism and references weeek_list_board_columns', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerMoveTask(fake.server, fakeRegistry(client))
    const desc = fake.getDescription()
    expect(desc).toMatch(/weeek_list_board_columns/)
    expect(desc).toMatch(/weeek_update_task/)
    expect(desc).toMatch(/weeek_complete_task/)
  })

  it('pOSTs boardColumnId to /tm/tasks/{id}/board-column when no board_id', async () => {
    const postFn = vi.fn(async () => ({ success: true }))
    const getFn = vi.fn(async () => ({
      task: { id: 't1', boardColumnId: 'col-2' },
    }))
    const client = {
      get: getFn,
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerMoveTask(fake.server, fakeRegistry(client))

    await fake.getHandler()({
      task_id: 't1',
      board_column_id: 'col-2',
    })

    // single column move → one POST to the board-column endpoint, no /board
    expect(postFn).toHaveBeenCalledTimes(1)
    const [path, body] = postFn.mock.calls[0]!
    expect(path).toBe('/tm/tasks/t1/board-column')
    expect(body).toEqual({ boardColumnId: 'col-2' })
    // returns the refreshed task via a follow-up GET
    expect(getFn).toHaveBeenCalledWith('/tm/tasks/t1')
  })

  it('pOSTs to /board then /board-column when moving across boards', async () => {
    const postFn = vi.fn(async () => ({ success: true }))
    const getFn = vi.fn(async () => ({ task: { id: 't1' } }))
    const client = {
      get: getFn,
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerMoveTask(fake.server, fakeRegistry(client))

    await fake.getHandler()({
      task_id: 't1',
      board_column_id: 'col-3',
      board_id: 'board-B',
    })

    expect(postFn).toHaveBeenCalledTimes(2)
    // board change first, then column placement
    expect(postFn.mock.calls[0]![0]).toBe('/tm/tasks/t1/board')
    expect(postFn.mock.calls[0]![1]).toEqual({ boardId: 'board-B' })
    expect(postFn.mock.calls[1]![0]).toBe('/tm/tasks/t1/board-column')
    expect(postFn.mock.calls[1]![1]).toEqual({
      boardColumnId: 'col-3',
    })
  })

  it('shapes the re-fetched task and strips workspace-schema bloat', async () => {
    const client = {
      get: vi.fn(async () => ({
        task: {
          id: 't1',
          title: 'Moved',
          boardColumnId: 'col-2',
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
    registerMoveTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({
      task_id: 't1',
      board_column_id: 'col-2',
    })
    const payload = JSON.parse(res.content[0]!.text) as Record<
      string,
      unknown
    >
    expect(payload.id).toBe('t1')
    expect(payload.boardColumnId).toBe('col-2')
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
    registerMoveTask(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({
      task_id: 'missing',
      board_column_id: 'col-1',
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('Resource not found')
  })
})
