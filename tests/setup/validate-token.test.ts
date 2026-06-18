import { describe, expect, it, vi } from 'vitest'

import { validateToken } from '../../src/setup/validate-token.js'

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('validateToken', () => {
  it('returns ok with a workspace name on 200', async () => {
    const fetchFn = vi.fn(async () =>
      res(200, {
        success: true,
        workspace: { id: 1, title: 'Acme' },
      }),
    )
    const r = await validateToken(
      't',
      'https://api.weeek.net/public/v1',
      fetchFn as unknown as typeof fetch,
    )
    expect(r.ok).toBe(true)
    expect(r.workspaceName).toBe('Acme')
  })

  it('returns not-ok on 401', async () => {
    const fetchFn = vi.fn(async () =>
      res(401, { error: 'unauthorized' }),
    )
    const r = await validateToken(
      'bad',
      'https://api.weeek.net/public/v1',
      fetchFn as unknown as typeof fetch,
    )
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
  })
})
