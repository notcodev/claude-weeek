import { beforeAll, describe, expect, it } from 'vitest'

import type { CapturedRequest } from '../../scripts/spec-sync/types.js'

import { captureContract } from '../../scripts/spec-sync/capture-contract.js'
import { toolFixtures } from '../../scripts/spec-sync/fixtures.js'

describe('captureContract', () => {
  let reqs: CapturedRequest[]
  beforeAll(async () => {
    reqs = await captureContract(toolFixtures)
  })

  it('captures create_task as POST /tm/tasks with a locations array body', () => {
    const create = reqs.find(
      (r) => r.tool === 'weeek_create_task' && r.method === 'POST',
    )
    expect(create?.path).toBe('/tm/tasks')
    const body = create?.body as { locations: { projectId: string }[] }
    expect(body.locations[0]?.projectId).toBe('PID')
  })

  it('captures move_task as board + board-column + re-fetch', () => {
    const paths = reqs
      .filter((r) => r.tool === 'weeek_move_task')
      .map((r) => `${r.method} ${r.path}`)
    expect(paths).toContain('POST /tm/tasks/TID/board')
    expect(paths).toContain('POST /tm/tasks/TID/board-column')
    expect(paths).toContain('GET /tm/tasks/TID')
  })

  it('captures complete_task covering complete and un-complete', () => {
    const paths = reqs
      .filter((r) => r.tool === 'weeek_complete_task')
      .map((r) => `${r.method} ${r.path}`)
    expect(paths).toContain('POST /tm/tasks/TID/complete')
    expect(paths).toContain('POST /tm/tasks/TID/un-complete')
  })

  it('captures update_task as PUT /tm/tasks/{id} with userId mapped from assignee_id', () => {
    const put = reqs.find((r) => r.tool === 'weeek_update_task')
    expect(put?.method).toBe('PUT')
    expect(put?.path).toBe('/tm/tasks/TID')
    expect((put?.body as { userId?: string }).userId).toBe('UID')
  })

  it('emits no API calls for list_workspaces', () => {
    expect(reqs.filter((r) => r.tool === 'weeek_list_workspaces')).toHaveLength(0)
  })
})
