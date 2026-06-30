/**
 * Verified-valid-but-undocumented WEEEK divergences. Each entry was confirmed
 * against the live API; the spec simply omits the param/field on that operation.
 * Allowlisted findings are still PRINTED by check-drift (never silently dropped) —
 * they just do not fail the build. Only `query-unknown-param` and
 * `body-unknown-field` may be allowlisted; structural findings
 * (endpoint-missing, body-missing-required) can NEVER be allowlisted.
 */
import type { Finding } from './types.js'

export interface AllowEntry {
  tool: string
  code: 'body-unknown-field' | 'query-unknown-param'
  name: string // the param/field the finding is about
  reason: string
}

const PAGINATION_TOOLS = [
  'weeek_list_projects',
  'weeek_list_boards',
  'weeek_list_board_columns',
  'weeek_list_workspace_members',
]

export const allowlist: AllowEntry[] = [
  ...PAGINATION_TOOLS.flatMap((tool): AllowEntry[] => [
    {
      tool,
      code: 'query-unknown-param',
      name: 'perPage',
      reason:
        'WEEEK pagination param (offset+perPage); verified on /tm/tasks; spec omits it on this op',
    },
    {
      tool,
      code: 'query-unknown-param',
      name: 'offset',
      reason:
        'WEEEK pagination param (offset+perPage); verified on /tm/tasks; spec omits it on this op',
    },
  ]),
  {
    tool: 'weeek_create_task',
    code: 'body-unknown-field',
    name: 'dueDate',
    reason:
      'verified accepted + persisted on POST /tm/tasks; spec lists `day` instead and omits dueDate',
  },
  {
    tool: 'weeek_update_task',
    code: 'body-unknown-field',
    name: 'description',
    reason: 'verified accepted on PUT /tm/tasks/{id}; PUT schema incomplete',
  },
  {
    tool: 'weeek_update_task',
    code: 'body-unknown-field',
    name: 'userId',
    reason: 'verified accepted on PUT /tm/tasks/{id}; PUT schema incomplete',
  },
]

/** The finding's quoted name token, e.g. detail contains `"perPage"`. */
export function isAllowed(f: Finding): AllowEntry | null {
  for (const e of allowlist) {
    if (e.tool !== f.tool) continue
    if (e.code !== f.code) continue
    if (!f.detail.includes(`"${e.name}"`)) continue
    return e
  }
  return null
}

export function partitionFindings(findings: Finding[]): {
  active: Finding[]
  accepted: { finding: Finding; entry: AllowEntry }[]
} {
  const active: Finding[] = []
  const accepted: { finding: Finding; entry: AllowEntry }[] = []
  for (const f of findings) {
    const e = isAllowed(f)
    if (e) accepted.push({ finding: f, entry: e })
    else active.push(f)
  }
  return { active, accepted }
}
