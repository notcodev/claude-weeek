import { describe, expect, it } from 'vitest'

import { RecordingClient } from '../../scripts/spec-sync/recording-client.js'

describe('RecordingClient', () => {
  it('records GET with query and returns a safe stub', async () => {
    const c = new RecordingClient()
    const res = await c.get('/tm/tasks', { limit: 50 })
    expect(res).toEqual({})
    expect(c.records).toEqual([
      { method: 'GET', path: '/tm/tasks', query: { limit: 50 } },
    ])
  })

  it('records POST/PUT/PATCH with body', async () => {
    const c = new RecordingClient()
    await c.post('/tm/tasks', { title: 'x' })
    await c.put('/tm/tasks/1', { title: 'y' })
    await c.patch('/tm/tasks/1', { title: 'z' })
    expect(c.records.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /tm/tasks',
      'PUT /tm/tasks/1',
      'PATCH /tm/tasks/1',
    ])
  })
})
