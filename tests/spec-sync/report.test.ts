import { describe, expect, it } from 'vitest'

import type { Finding } from '../../scripts/spec-sync/types.js'

import { formatFindings, hasErrors } from '../../scripts/spec-sync/report.js'

const err: Finding = {
  severity: 'error',
  code: 'endpoint-missing',
  tool: 'weeek_move_task',
  method: 'PUT',
  path: '/tm/tasks/TID',
  detail: 'no PUT operation matches',
}
const warn: Finding = {
  severity: 'warn',
  code: 'query-missing-required',
  tool: 'weeek_list_tasks',
  method: 'GET',
  path: '/tm/tasks',
  detail: 'required query param "limit" is never sent',
}

describe('hasErrors', () => {
  it('is false for empty and warn-only', () => {
    expect(hasErrors([])).toBe(false)
    expect(hasErrors([warn])).toBe(false)
  })
  it('is true when an error is present', () => {
    expect(hasErrors([warn, err])).toBe(true)
  })
})

describe('formatFindings', () => {
  it('reports a clean result', () => {
    expect(formatFindings([])).toContain('No spec drift detected')
  })
  it('summarizes counts and lists each finding', () => {
    const out = formatFindings([err, warn])
    expect(out).toContain('1 error(s), 1 warning(s)')
    expect(out).toContain('weeek_move_task PUT /tm/tasks/TID')
    expect(out).toContain('endpoint-missing')
  })
})
