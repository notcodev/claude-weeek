import { describe, expect, it } from 'vitest'

import type { Finding } from '../../scripts/spec-sync/types.js'

import {
  allowlist,
  isAllowed,
  partitionFindings,
} from '../../scripts/spec-sync/allowlist.js'

function finding(p: Partial<Finding>): Finding {
  return {
    severity: 'error',
    code: 'query-unknown-param',
    tool: 'weeek_list_projects',
    method: 'GET',
    path: '/tm/projects',
    detail: 'query param "perPage" is not declared on this operation',
    ...p,
  }
}

describe('isAllowed', () => {
  it('matches a known pagination param on a list tool', () => {
    expect(isAllowed(finding({}))?.name).toBe('perPage')
  })

  it('matches dueDate body field on create_task', () => {
    expect(
      isAllowed(
        finding({
          tool: 'weeek_create_task',
          code: 'body-unknown-field',
          method: 'POST',
          path: '/tm/tasks',
          detail:
            'body field "dueDate" is not declared in the requestBody schema',
        }),
      )?.name,
    ).toBe('dueDate')
  })

  it('does NOT allowlist an unrelated unknown field', () => {
    expect(
      isAllowed(
        finding({
          tool: 'weeek_create_task',
          code: 'body-unknown-field',
          detail:
            'body field "bogus" is not declared in the requestBody schema',
        }),
      ),
    ).toBeNull()
  })

  it('does NOT allowlist a structural finding (endpoint-missing) even on an allowlisted tool', () => {
    expect(
      isAllowed(
        finding({
          code: 'endpoint-missing',
          detail: 'no GET operation matches path "/tm/projects"',
        }),
      ),
    ).toBeNull()
  })
})

describe('allowlist data integrity', () => {
  it('only ever allowlists query-unknown-param or body-unknown-field', () => {
    for (const e of allowlist) {
      expect(['query-unknown-param', 'body-unknown-field']).toContain(
        e.code,
      )
    }
  })

  it('every entry has a non-empty reason', () => {
    for (const e of allowlist)
      expect(e.reason.length).toBeGreaterThan(0)
  })

  it('contains exactly the 11 verified entries', () => {
    expect(allowlist).toHaveLength(11)
  })
})

describe('partitionFindings', () => {
  it('splits accepted from active', () => {
    const allowed = finding({})
    const real = finding({
      code: 'endpoint-missing',
      detail: 'no GET operation matches path "/tm/nope"',
    })
    const { active, accepted } = partitionFindings([allowed, real])
    expect(accepted).toHaveLength(1)
    expect(active).toHaveLength(1)
    expect(active[0]?.code).toBe('endpoint-missing')
  })
})
