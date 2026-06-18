/**
 * Token validation for the setup wizard.
 *
 * Task 0 probe result: primary endpoint `GET /ws` returns
 * `{ success, workspace: { id, title, ... } }` — workspace name is at
 * `body.workspace.title`. 401/403 => invalid token; any 2xx => valid.
 * Fallback `GET /tm/projects?limit=1` confirms validity when /ws is absent.
 */

export interface TokenCheck {
  ok: boolean
  status?: number
  workspaceName?: string
}

export async function validateToken(
  token: string,
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<TokenCheck> {
  const base = baseUrl.replace(/\/$/, '')
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }

  const res = await fetchFn(`${base}/ws`, { headers })
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status }
  }
  if (res.ok) {
    let workspaceName: string | undefined
    try {
      const body = (await res.json()) as Record<string, unknown>
      workspaceName = extractWorkspaceName(body)
    } catch {
      // ignore body parse issues — token is still valid
    }
    return { ok: true, status: res.status, workspaceName }
  }

  // /ws unavailable (e.g. 404) — fall back to a lightweight authed read
  const fb = await fetchFn(`${base}/tm/projects?limit=1`, { headers })
  if (fb.status === 401 || fb.status === 403) {
    return { ok: false, status: fb.status }
  }
  return { ok: fb.ok, status: fb.status }
}

function extractWorkspaceName(
  body: Record<string, unknown>,
): string | undefined {
  // Task 0 confirmed shape: { success, workspace: { id, title, ... } }
  const ws = body.workspace
  if (ws && typeof ws === 'object') {
    const title = (ws as Record<string, unknown>).title
    if (typeof title === 'string') return title
  }
  return undefined
}
