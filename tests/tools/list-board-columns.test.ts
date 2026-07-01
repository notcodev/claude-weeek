import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerListBoardColumns } from '../../src/tools/read/list-board-columns.js'
import { fakeRegistry } from './_registry.js'

type Handler = (args: {
  board_id: string
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
      typeof registerListBoardColumns
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

describe('weeek_list_board_columns tool', () => {
  let fake: ReturnType<typeof makeFakeServer>

  beforeEach(() => {
    fake = makeFakeServer()
  })

  it('registers under the weeek_list_board_columns name', () => {
    const client = makeFakeClient(async () => ({ boardColumns: [] }))
    registerListBoardColumns(fake.server, fakeRegistry(client))
    expect(fake.getName()).toBe('weeek_list_board_columns')
  })

  it('description references weeek_move_task as the consumer of column ids', () => {
    const client = makeFakeClient(async () => ({ boardColumns: [] }))
    registerListBoardColumns(fake.server, fakeRegistry(client))
    const desc = fake.getDescription()
    expect(desc).toMatch(/weeek_move_task/)
    expect(desc).toMatch(/weeek_list_boards/)
  })

  it('gETs /tm/board-columns with boardId query and shapes columns', async () => {
    const getFn = vi.fn(async (_path: string, _query?: unknown) => ({
      boardColumns: [
        { id: 1, name: 'Todo', boardId: 'b1', order: 0 },
        { id: 'c2', title: 'In Progress', boardId: 'b1', order: 1 },
        { id: 'c3', name: 'Done', boardId: 'b1' },
      ],
    }))
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerListBoardColumns(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ board_id: 'b1' })
    expect(res.isError).toBeUndefined()

    const [path, query] = getFn.mock.calls[0]!
    expect(path).toBe('/tm/board-columns')
    expect((query as Record<string, unknown>).boardId).toBe('b1')

    const payload = JSON.parse(res.content[0]!.text) as {
      columns: Array<{
        id: string
        name: string
        boardId: string
        order: number | null
      }>
      count: number
    }
    expect(payload.count).toBe(3)
    expect(payload.columns[0]).toEqual({
      id: '1',
      name: 'Todo',
      boardId: 'b1',
      order: 0,
    })
    expect(payload.columns[1]).toEqual({
      id: 'c2',
      name: 'In Progress',
      boardId: 'b1',
      order: 1,
    })
    expect(payload.columns[2]).toEqual({
      id: 'c3',
      name: 'Done',
      boardId: 'b1',
      order: null,
    })
  })

  it('forwards limit and offset to the query', async () => {
    const getFn = vi.fn(async () => ({ boardColumns: [] }))
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    }
    registerListBoardColumns(fake.server, fakeRegistry(client))

    await fake.getHandler()({ board_id: 'b1', limit: 3, offset: 9 })
    const query = getFn.mock.calls[0]![1] as Record<string, unknown>
    expect(query.perPage).toBe(3)
    expect(query.offset).toBe(9)
  })

  it('returns isError:true on WeeekApiError, does not throw', async () => {
    const client = makeFakeClient(async () => {
      throw new WeeekApiError(404, 'board not found')
    })
    registerListBoardColumns(fake.server, fakeRegistry(client))

    const res = await fake.getHandler()({ board_id: 'missing' })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('Resource not found')
  })
})
