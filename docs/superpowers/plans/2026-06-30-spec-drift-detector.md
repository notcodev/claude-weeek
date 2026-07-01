# WEEEK API Spec-Drift Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a script that downloads WEEEK's current OpenAPI spec and flags any divergence between it and what the MCP tools actually send — on every PR (code drift) and on a nightly schedule (upstream drift).

**Architecture:** Two independent flows converge in a matcher. FLOW A downloads WEEEK's spec (delivered as a hashed ESM chunk `weeek.yaml-<hash>.js` exporting `schema`/`slugs`), normalizes it, and commits it as `spec/weeek-openapi.json`. FLOW B drives the real tool handlers against a `RecordingClient` (via a fake MCP server + fake registry) to capture every `{method, path, query, body}` the code emits. The matcher compares each captured request to the matching OpenAPI operation and reports findings.

**Tech Stack:** TypeScript (run via `tsx`, no build step), Node 20 native `fetch`, `zod` (already a dep), `vitest` (already a dev dep). No new dependencies.

## Global Constraints

Copied verbatim from the spec and project CLAUDE.md — every task implicitly includes these:

- **ESM throughout.** `"type": "module"`, NodeNext. Import Node built-ins as `node:fs/promises`, `node:os`, `node:path`, `node:url`, `node:process`. Internal relative imports use `.js` specifiers (NodeNext resolves to `.ts`).
- **No `console.log`.** Project rule `no-console` is `error` (only `warn`/`error` allowed). CLI scripts write user-facing output via `process.stdout.write(...)` / `process.stderr.write(...)`.
- **`zod@^3.25.0`** — do not upgrade to zod v4 (breaks MCP SDK v1.x).
- **Node `>=20.0.0`** — native `fetch`, `AbortController`, top-level `await import()` all available.
- **Package manager is `pnpm@10.27.0`.** Run scripts as `pnpm <script>`. No new deps → lockfile stays unchanged.
- **`tsconfig.json` has `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`.** Indexed access yields `T | undefined` — guard regex match groups, array indexing, and object lookups accordingly.
- **WEEEK base URL** is `https://api.weeek.net/public/v1` (`DEFAULT_BASE_URL` in `src/config.ts`); the developer portal lives at `https://developers.weeek.net`.

## File Structure

New files under `scripts/spec-sync/`:

| File | Responsibility |
|------|----------------|
| `types.ts` | Shared types: `HttpMethod`, `CapturedRequest`, `Finding`, minimal OpenAPI interfaces, `IndexedOperation` |
| `openapi.ts` | Index spec operations; path-template→regex matcher; base-path normalization; requestBody/param accessors |
| `compare.ts` | Pure comparison rules: `compareRequest`, `checkAll` → `Finding[]` |
| `report.ts` | `formatFindings`, `hasErrors` |
| `recording-client.ts` | `RecordingClient` — records `get/post/put/patch`, returns a post-processing-safe stub |
| `fixtures.ts` | `toolFixtures` — maximal argument sets per tool |
| `capture-contract.ts` | Fake server + fake registry → drive `register{Read,Write}Tools` → `captureContract`, `listRegisteredTools` |
| `discover.ts` | Pure HTML/JS parsing: `parseEntryUrl`, `parseYamlChunkRef`, `chunkHashFromName` |
| `load-spec.ts` | Network: `resolveChunkUrl`, `loadSpec` (download chunk → `import()` → `{schema, slugs}`) |
| `fetch-spec.ts` | CLI: orchestrate → write `spec/*.json`; `--check-upstream` mode |
| `check-drift.ts` | CLI: load snapshot → capture → compare → report → exit code |

Committed artifacts: `spec/weeek-openapi.json`, `spec/weeek-openapi.meta.json`.

Config: `tsconfig.scripts.json`, `vitest.integration.config.ts`, edits to `vitest.config.ts`, `package.json`. CI: `.github/workflows/spec-drift.yml`.

Tests under `tests/spec-sync/`: `openapi.test.ts`, `compare.test.ts`, `report.test.ts`, `recording-client.test.ts`, `capture-contract.test.ts`, `fixtures.test.ts`, `discover.test.ts`, `discover.integration.test.ts` (opt-in).

---

### Task 1: Spec model & operation matcher

**Files:**
- Create: `scripts/spec-sync/types.ts`
- Create: `scripts/spec-sync/openapi.ts`
- Create: `tsconfig.scripts.json`
- Modify: `package.json` (add `typecheck:scripts` script)
- Test: `tests/spec-sync/openapi.test.ts`

**Interfaces:**
- Produces: `types.ts` exports `HttpMethod`, `CapturedRequest`, `Severity`, `FindingCode`, `Finding`, `OpenApiSchemaObject`, `OpenApiParameter`, `OpenApiOperation`, `OpenApiDoc`, `IndexedOperation`. `openapi.ts` exports `specBasePath(spec): string`, `pathTemplateToRegex(t): RegExp`, `indexOperations(spec): IndexedOperation[]`, `matchOperation(index, method, path): IndexedOperation | null`, `requestBodySchema(op): OpenApiSchemaObject | null`, `requestBodyRequired(op): boolean`, `queryParams(op): OpenApiParameter[]`.

- [ ] **Step 1: Create `tsconfig.scripts.json`** so the new code is typechecked (the base `tsconfig.json` only includes `src`).

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["scripts"]
}
```

- [ ] **Step 2: Add the `typecheck:scripts` script to `package.json`** (in `"scripts"`, after `"typecheck"`).

```json
"typecheck:scripts": "tsc -p tsconfig.scripts.json --noEmit",
```

- [ ] **Step 3: Create `scripts/spec-sync/types.ts`**

```ts
/** Shared types for the WEEEK spec-drift detector. */

export type HttpMethod = 'GET' | 'PATCH' | 'POST' | 'PUT'

/** A single HTTP request the code emits, captured at runtime. */
export interface CapturedRequest {
  tool: string
  method: HttpMethod
  path: string
  query?: Record<string, unknown>
  body?: unknown
}

export type Severity = 'error' | 'warn'

export type FindingCode =
  | 'body-missing-required'
  | 'body-unknown-field'
  | 'endpoint-missing'
  | 'nested-mismatch'
  | 'query-missing-required'
  | 'query-unknown-param'

export interface Finding {
  severity: Severity
  code: FindingCode
  tool: string
  method: HttpMethod
  path: string
  detail: string
}

/** Minimal OpenAPI shapes — only the parts the matcher touches. */
export interface OpenApiSchemaObject {
  type?: string
  properties?: Record<string, OpenApiSchemaObject>
  required?: string[]
  items?: OpenApiSchemaObject
  additionalProperties?: boolean | OpenApiSchemaObject
  [k: string]: unknown
}

export interface OpenApiParameter {
  name: string
  in: string
  required?: boolean
}

export interface OpenApiOperation {
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: OpenApiSchemaObject }>
  }
  parameters?: OpenApiParameter[]
  [k: string]: unknown
}

export interface OpenApiDoc {
  openapi?: string
  servers?: { url: string }[]
  paths: Record<string, Record<string, OpenApiOperation>>
}

export interface IndexedOperation {
  template: string
  method: string
  regex: RegExp
  paramCount: number
  op: OpenApiOperation
}
```

- [ ] **Step 4: Write the failing test** — `tests/spec-sync/openapi.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import type { OpenApiDoc } from '../../scripts/spec-sync/types.js'

import {
  indexOperations,
  matchOperation,
  pathTemplateToRegex,
  specBasePath,
} from '../../scripts/spec-sync/openapi.js'

const spec: OpenApiDoc = {
  servers: [{ url: 'https://api.weeek.net/public/v1' }],
  paths: {
    '/tm/tasks': { get: {}, post: {} },
    '/tm/tasks/{id}': { get: {} },
    '/tm/tasks/{id}/board-column': { post: {} },
  },
}

describe('specBasePath', () => {
  it('extracts the server pathname', () => {
    expect(specBasePath(spec)).toBe('/public/v1')
  })
})

describe('pathTemplateToRegex', () => {
  it('matches a concrete path against a {param} template', () => {
    expect(
      pathTemplateToRegex('/tm/tasks/{id}/board-column').test(
        '/tm/tasks/TID/board-column',
      ),
    ).toBe(true)
  })

  it('rejects a different segment count', () => {
    expect(
      pathTemplateToRegex('/tm/tasks/{id}').test('/tm/tasks/TID/board'),
    ).toBe(false)
  })
})

describe('indexOperations + matchOperation', () => {
  const idx = indexOperations(spec)

  it('matches POST /tm/tasks/{id}/board-column', () => {
    expect(
      matchOperation(idx, 'POST', '/tm/tasks/TID/board-column')?.template,
    ).toBe('/tm/tasks/{id}/board-column')
  })

  it('returns null for PUT /tm/tasks/{id} (only GET defined)', () => {
    expect(matchOperation(idx, 'PUT', '/tm/tasks/TID')).toBeNull()
  })

  it('prefers the literal /tm/tasks over a templated match', () => {
    expect(matchOperation(idx, 'GET', '/tm/tasks')?.template).toBe('/tm/tasks')
  })

  it('strips the server base path from spec path keys', () => {
    const withBase: OpenApiDoc = {
      servers: [{ url: 'https://api.weeek.net/public/v1' }],
      paths: { '/public/v1/tm/tasks': { get: {} } },
    }
    expect(
      matchOperation(indexOperations(withBase), 'GET', '/tm/tasks')?.template,
    ).toBe('/tm/tasks')
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm vitest run tests/spec-sync/openapi.test.ts`
Expected: FAIL — cannot resolve `../../scripts/spec-sync/openapi.js`.

- [ ] **Step 6: Create `scripts/spec-sync/openapi.ts`**

```ts
/** OpenAPI operation indexing + concrete-path → templated-operation matching. */

import type {
  HttpMethod,
  IndexedOperation,
  OpenApiDoc,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchemaObject,
} from './types.js'

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
] as const

/** The pathname of the first server URL, e.g. "/public/v1" (no trailing slash). */
export function specBasePath(spec: OpenApiDoc): string {
  const url = spec.servers?.[0]?.url
  if (!url) return ''
  try {
    return new URL(url).pathname.replace(/\/$/, '')
  } catch {
    return url.startsWith('/') ? url.replace(/\/$/, '') : ''
  }
}

function stripBase(path: string, base: string): string {
  if (base && path.startsWith(base)) return path.slice(base.length) || '/'
  return path
}

/** Convert an OpenAPI path template into a full-match regex; {param} → one segment. */
export function pathTemplateToRegex(template: string): RegExp {
  const parts = template.split('/').map((seg) =>
    /^\{.+\}$/.test(seg)
      ? '[^/]+'
      : seg.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&'),
  )
  return new RegExp(`^${parts.join('/')}$`)
}

export function indexOperations(spec: OpenApiDoc): IndexedOperation[] {
  const base = specBasePath(spec)
  const out: IndexedOperation[] = []
  for (const [rawPath, methods] of Object.entries(spec.paths ?? {})) {
    const template = stripBase(rawPath, base)
    const paramCount = (template.match(/\{[^}]+\}/g) ?? []).length
    const regex = pathTemplateToRegex(template)
    for (const [method, op] of Object.entries(methods ?? {})) {
      if ((HTTP_METHODS as readonly string[]).includes(method.toLowerCase())) {
        out.push({
          template,
          method: method.toLowerCase(),
          regex,
          paramCount,
          op,
        })
      }
    }
  }
  return out
}

/** Find the matching operation; prefer the most specific (fewest {param}) template. */
export function matchOperation(
  index: IndexedOperation[],
  method: HttpMethod,
  path: string,
): IndexedOperation | null {
  const m = method.toLowerCase()
  const candidates = index
    .filter((e) => e.method === m && e.regex.test(path))
    .sort((a, b) => a.paramCount - b.paramCount)
  return candidates[0] ?? null
}

export function requestBodySchema(
  op: OpenApiOperation,
): OpenApiSchemaObject | null {
  return op.requestBody?.content?.['application/json']?.schema ?? null
}

export function requestBodyRequired(op: OpenApiOperation): boolean {
  return op.requestBody?.required === true
}

export function queryParams(op: OpenApiOperation): OpenApiParameter[] {
  return (op.parameters ?? []).filter((p) => p.in === 'query')
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/spec-sync/openapi.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 8: Typecheck the new scripts**

Run: `pnpm typecheck:scripts`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add scripts/spec-sync/types.ts scripts/spec-sync/openapi.ts tsconfig.scripts.json package.json tests/spec-sync/openapi.test.ts
git commit -m "feat(spec-sync): OpenAPI operation index and path matcher"
```

---

### Task 2: Comparison rules

**Files:**
- Create: `scripts/spec-sync/compare.ts`
- Test: `tests/spec-sync/compare.test.ts`

**Interfaces:**
- Consumes: `IndexedOperation`, `CapturedRequest`, `Finding` from `types.js`; `matchOperation`, `requestBodySchema`, `requestBodyRequired`, `queryParams` from `openapi.js`; `indexOperations` (in tests).
- Produces: `compareRequest(req: CapturedRequest, index: IndexedOperation[]): Finding[]`, `checkAll(captured: CapturedRequest[], index: IndexedOperation[]): Finding[]`.

- [ ] **Step 1: Write the failing test** — `tests/spec-sync/compare.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import type {
  CapturedRequest,
  OpenApiDoc,
} from '../../scripts/spec-sync/types.js'

import { checkAll, compareRequest } from '../../scripts/spec-sync/compare.js'
import { indexOperations } from '../../scripts/spec-sync/openapi.js'

const spec: OpenApiDoc = {
  servers: [{ url: 'https://api.weeek.net/public/v1' }],
  paths: {
    '/tm/tasks': {
      get: {
        parameters: [
          { name: 'projectId', in: 'query' },
          { name: 'limit', in: 'query', required: true },
        ],
      },
      post: {
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['locations', 'title'],
                properties: {
                  title: { type: 'string' },
                  locations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['projectId'],
                      properties: {
                        projectId: { type: 'string' },
                        boardColumnId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/tm/tasks/{id}/board-column': { post: {} },
  },
}
const index = indexOperations(spec)

function req(partial: Partial<CapturedRequest>): CapturedRequest {
  return { tool: 't', method: 'POST', path: '/tm/tasks', ...partial }
}

describe('compareRequest', () => {
  it('flags endpoint-missing for an undefined verb/path', () => {
    const f = compareRequest(
      req({ method: 'PUT', path: '/tm/tasks/TID/board-column', body: {} }),
      index,
    )
    expect(f).toHaveLength(1)
    expect(f[0]?.code).toBe('endpoint-missing')
  })

  it('flags body-unknown-field', () => {
    const f = compareRequest(
      req({ body: { title: 'x', locations: [{ projectId: 'p' }], bogus: 1 } }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('body-unknown-field')
  })

  it('flags body-missing-required when locations is absent', () => {
    const f = compareRequest(req({ body: { title: 'x' } }), index)
    expect(f.map((x) => x.code)).toContain('body-missing-required')
  })

  it('passes a well-formed create body', () => {
    const f = compareRequest(
      req({ body: { title: 'x', locations: [{ projectId: 'p' }] } }),
      index,
    )
    expect(f).toHaveLength(0)
  })

  it('flags nested-mismatch when an array item lacks a required field', () => {
    const f = compareRequest(
      req({ body: { title: 'x', locations: [{ boardColumnId: 'c' }] } }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('nested-mismatch')
  })

  it('flags query-unknown-param', () => {
    const f = compareRequest(
      req({ method: 'GET', query: { projectId: 'p', limit: 50, bad: 1 } }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('query-unknown-param')
  })

  it('warns query-missing-required when a required param is absent', () => {
    const f = compareRequest(
      req({ method: 'GET', query: { projectId: 'p' } }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('query-missing-required')
  })

  it('ignores undefined/null query values', () => {
    const f = compareRequest(
      req({ method: 'GET', query: { projectId: 'p', limit: 50, bad: undefined } }),
      index,
    )
    expect(f).toHaveLength(0)
  })
})

describe('checkAll', () => {
  it('flattens findings across requests', () => {
    const findings = checkAll(
      [
        req({ method: 'PUT', path: '/nope', body: {} }),
        req({ body: { title: 'x', locations: [{ projectId: 'p' }] } }),
      ],
      index,
    )
    expect(findings).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/spec-sync/compare.test.ts`
Expected: FAIL — cannot resolve `compare.js`.

- [ ] **Step 3: Create `scripts/spec-sync/compare.ts`**

```ts
/** Pure comparison rules: a captured request vs the matching OpenAPI operation. */

import type {
  CapturedRequest,
  Finding,
  IndexedOperation,
  OpenApiSchemaObject,
} from './types.js'

import {
  matchOperation,
  queryParams,
  requestBodyRequired,
  requestBodySchema,
} from './openapi.js'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Query keys the client would actually send (it drops undefined/null). */
function definedQueryKeys(query: Record<string, unknown> | undefined): string[] {
  if (!query) return []
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k]) => k)
}

export function compareRequest(
  req: CapturedRequest,
  index: IndexedOperation[],
): Finding[] {
  const matched = matchOperation(index, req.method, req.path)
  if (!matched) {
    return [
      {
        severity: 'error',
        code: 'endpoint-missing',
        tool: req.tool,
        method: req.method,
        path: req.path,
        detail: `no ${req.method} operation matches path "${req.path}" in the spec`,
      },
    ]
  }

  const findings: Finding[] = []
  const op = matched.op

  const bodySchema = requestBodySchema(op)
  if (bodySchema && bodySchema.type !== 'array') {
    const props = bodySchema.properties ?? {}
    const required = bodySchema.required ?? []
    const addl = bodySchema.additionalProperties
    const body = isPlainObject(req.body) ? req.body : {}

    if (addl !== true) {
      for (const key of Object.keys(body)) {
        if (!(key in props)) {
          findings.push({
            severity: 'error',
            code: 'body-unknown-field',
            tool: req.tool,
            method: req.method,
            path: req.path,
            detail: `body field "${key}" is not declared in the requestBody schema`,
          })
        }
      }
    }

    if (requestBodyRequired(op) || Object.keys(body).length > 0) {
      for (const reqProp of required) {
        if (!(reqProp in body)) {
          findings.push({
            severity: 'error',
            code: 'body-missing-required',
            tool: req.tool,
            method: req.method,
            path: req.path,
            detail: `required body field "${reqProp}" is never sent by this tool`,
          })
        }
      }
    }

    for (const [key, val] of Object.entries(body)) {
      const propSchema = props[key]
      if (propSchema?.type === 'array' && propSchema.items && Array.isArray(val)) {
        findings.push(...checkNestedArray(req, key, propSchema.items, val))
      }
    }
  }

  const qParams = queryParams(op)
  const keys = definedQueryKeys(req.query)
  if (qParams.length > 0 || keys.length > 0) {
    const names = new Set(qParams.map((p) => p.name))
    for (const k of keys) {
      if (!names.has(k)) {
        findings.push({
          severity: 'error',
          code: 'query-unknown-param',
          tool: req.tool,
          method: req.method,
          path: req.path,
          detail: `query param "${k}" is not declared on this operation`,
        })
      }
    }
    for (const p of qParams) {
      if (p.required && !keys.includes(p.name)) {
        findings.push({
          severity: 'warn',
          code: 'query-missing-required',
          tool: req.tool,
          method: req.method,
          path: req.path,
          detail: `required query param "${p.name}" is never sent by this tool`,
        })
      }
    }
  }

  return findings
}

function checkNestedArray(
  req: CapturedRequest,
  key: string,
  itemSchema: OpenApiSchemaObject,
  arr: unknown[],
): Finding[] {
  const findings: Finding[] = []
  const props = itemSchema.properties ?? {}
  const required = itemSchema.required ?? []
  const addl = itemSchema.additionalProperties
  for (const el of arr) {
    if (!isPlainObject(el)) continue
    if (addl !== true) {
      for (const k of Object.keys(el)) {
        if (!(k in props)) {
          findings.push({
            severity: 'warn',
            code: 'nested-mismatch',
            tool: req.tool,
            method: req.method,
            path: req.path,
            detail: `"${key}[].${k}" is not declared in the item schema`,
          })
        }
      }
    }
    for (const r of required) {
      if (!(r in el)) {
        findings.push({
          severity: 'warn',
          code: 'nested-mismatch',
          tool: req.tool,
          method: req.method,
          path: req.path,
          detail: `required item field "${key}[].${r}" is missing`,
        })
      }
    }
  }
  return findings
}

export function checkAll(
  captured: CapturedRequest[],
  index: IndexedOperation[],
): Finding[] {
  return captured.flatMap((req) => compareRequest(req, index))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/spec-sync/compare.test.ts`
Expected: PASS (9 assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/spec-sync/compare.ts tests/spec-sync/compare.test.ts
git commit -m "feat(spec-sync): request-vs-spec comparison rules"
```

---

### Task 3: Report formatting & error gate

**Files:**
- Create: `scripts/spec-sync/report.ts`
- Test: `tests/spec-sync/report.test.ts`

**Interfaces:**
- Consumes: `Finding` from `types.js`.
- Produces: `hasErrors(findings: Finding[]): boolean`, `formatFindings(findings: Finding[]): string`.

- [ ] **Step 1: Write the failing test** — `tests/spec-sync/report.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/spec-sync/report.test.ts`
Expected: FAIL — cannot resolve `report.js`.

- [ ] **Step 3: Create `scripts/spec-sync/report.ts`**

```ts
/** Human-readable rendering of drift findings + the CI error gate. */

import type { Finding } from './types.js'

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'error')
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return '✓ No spec drift detected — every tool request matches the WEEEK OpenAPI snapshot.\n'
  }
  const errors = findings.filter((f) => f.severity === 'error')
  const warns = findings.filter((f) => f.severity === 'warn')
  const lines: string[] = [
    `Spec drift: ${errors.length} error(s), ${warns.length} warning(s)`,
    '',
  ]
  for (const f of [...errors, ...warns]) {
    const tag = f.severity === 'error' ? 'ERROR' : 'warn '
    lines.push(`  [${tag}] ${f.tool} ${f.method} ${f.path}`)
    lines.push(`          ${f.code}: ${f.detail}`)
  }
  lines.push('')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/spec-sync/report.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/spec-sync/report.ts tests/spec-sync/report.test.ts
git commit -m "feat(spec-sync): drift report formatting and error gate"
```

---

### Task 4: Recording client

**Files:**
- Create: `scripts/spec-sync/recording-client.ts`
- Test: `tests/spec-sync/recording-client.test.ts`

**Interfaces:**
- Consumes: `CapturedRequest`, `HttpMethod` from `types.js`.
- Produces: `RecordingClient` class with `records: RecordEntry[]` and `get/post/put/patch` methods matching `WeeekApiClient`'s signatures; `RecordEntry = Omit<CapturedRequest, 'tool'>`.

- [ ] **Step 1: Write the failing test** — `tests/spec-sync/recording-client.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/spec-sync/recording-client.test.ts`
Expected: FAIL — cannot resolve `recording-client.js`.

- [ ] **Step 3: Create `scripts/spec-sync/recording-client.ts`**

```ts
/**
 * A stand-in for WeeekApiClient that records outgoing requests instead of
 * making them. Returns an empty object — safe for the tools' post-processing
 * (unwrapTask({}) → {}, extractArray({}, key) → []), which never throws.
 */

import type { CapturedRequest, HttpMethod } from './types.js'

export type RecordEntry = Omit<CapturedRequest, 'tool'>

export class RecordingClient {
  readonly records: RecordEntry[] = []

  private record<T>(
    method: HttpMethod,
    path: string,
    extra: { query?: Record<string, unknown>; body?: unknown },
  ): Promise<T> {
    this.records.push({ method, path, ...extra })
    return Promise.resolve({} as T)
  }

  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.record<T>('GET', path, { query })
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.record<T>('POST', path, { body })
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.record<T>('PUT', path, { body })
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.record<T>('PATCH', path, { body })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/spec-sync/recording-client.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/spec-sync/recording-client.ts tests/spec-sync/recording-client.test.ts
git commit -m "feat(spec-sync): recording client for runtime request capture"
```

---

### Task 5: Fixtures & capture harness

**Files:**
- Create: `scripts/spec-sync/fixtures.ts`
- Create: `scripts/spec-sync/capture-contract.ts`
- Test: `tests/spec-sync/capture-contract.test.ts`
- Test: `tests/spec-sync/fixtures.test.ts`

**Interfaces:**
- Consumes: `CapturedRequest` from `types.js`; `RecordingClient` from `recording-client.js`; `registerReadTools` from `src/tools/read/index.js`; `registerWriteTools` from `src/tools/write/index.js`; types `WorkspaceRegistry` (`src/workspace-registry.js`), `WeeekApiClient` (`src/client/weeek-api-client.js`), `McpServer` (`@modelcontextprotocol/sdk/server/mcp.js`).
- Produces: `toolFixtures: Record<string, Record<string, unknown>[]>`; `captureContract(fixtures): Promise<CapturedRequest[]>`; `listRegisteredTools(): { name: string; inputSchema: Record<string, unknown> }[]`.

- [ ] **Step 1: Create `scripts/spec-sync/fixtures.ts`** — maximal argument sets (every optional field populated) so every body field and query key is emitted. `complete_task` gets two sets to cover `/complete` and `/un-complete`.

```ts
/**
 * Maximal argument fixtures per tool: every optional parameter populated so
 * the captured request surfaces every body field / query key the tool can
 * emit. ID-like values are sentinels — the path matcher treats any single
 * segment as a {param} match. Each tool maps to an ARRAY of arg sets so tools
 * with mutually-exclusive branches (complete vs un-complete) are fully covered.
 */

export const toolFixtures: Record<string, Record<string, unknown>[]> = {
  // Read tools
  weeek_list_projects: [{ limit: 50, offset: 0 }],
  weeek_get_project: [{ project_id: 'PID' }],
  weeek_list_boards: [{ project_id: 'PID', limit: 50, offset: 0 }],
  weeek_list_board_columns: [{ board_id: 'BID', limit: 50, offset: 0 }],
  weeek_list_tasks: [
    {
      project_id: 'PID',
      board_id: 'BID',
      column_id: 'CID',
      assignee_id: 'UID',
      is_completed: true,
      limit: 50,
      offset: 0,
    },
  ],
  weeek_get_task: [{ task_id: 'TID' }],
  weeek_list_workspace_members: [{ limit: 50, offset: 0 }],
  weeek_list_workspaces: [{}], // no API call — reads the local registry

  // Write tools
  weeek_create_task: [
    {
      title: 'Fixture task',
      project_id: 'PID',
      description: 'desc',
      board_id: 'BID',
      board_column_id: 'CID',
      priority: 1,
      assignee_id: 'UID',
      date_end: '2026-01-01',
    },
  ],
  weeek_update_task: [
    {
      task_id: 'TID',
      title: 'Fixture task',
      description: 'desc',
      priority: 1,
      assignee_id: 'UID',
      date_end: '2026-01-01',
    },
  ],
  weeek_move_task: [{ task_id: 'TID', board_column_id: 'CID', board_id: 'BID' }],
  weeek_complete_task: [
    { task_id: 'TID', completed: true },
    { task_id: 'TID', completed: false },
  ],
}
```

- [ ] **Step 2: Create `scripts/spec-sync/capture-contract.ts`**

```ts
/**
 * Drives the real tool handlers against a RecordingClient to capture the exact
 * requests the code emits. A fake MCP server collects each tool's handler +
 * input schema; a fake registry hands every handler a fresh RecordingClient so
 * each invocation's requests are isolated.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WeeekApiClient } from '../../src/client/weeek-api-client.js'
import type { WorkspaceRegistry } from '../../src/workspace-registry.js'
import type { CapturedRequest } from './types.js'

import { registerReadTools } from '../../src/tools/read/index.js'
import { registerWriteTools } from '../../src/tools/write/index.js'
import { RecordingClient } from './recording-client.js'

interface RegisteredTool {
  name: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

/** Register all tools against a fake server and return their handlers. */
function collectTools(registry: WorkspaceRegistry): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  const server = {
    registerTool: (
      name: string,
      def: { inputSchema?: Record<string, unknown> },
      handler: RegisteredTool['handler'],
    ) => {
      tools.push({ name, inputSchema: def.inputSchema ?? {}, handler })
    },
  } as unknown as McpServer
  registerReadTools(server, registry)
  registerWriteTools(server, registry)
  return tools
}

/** Tool names + their zod input shapes — used by the fixture coverage test. */
export function listRegisteredTools(): {
  name: string
  inputSchema: Record<string, unknown>
}[] {
  const client = new RecordingClient()
  const registry = {
    resolve: () => client as unknown as WeeekApiClient,
    list: () => [],
    has: () => true,
  } as unknown as WorkspaceRegistry
  return collectTools(registry).map((t) => ({
    name: t.name,
    inputSchema: t.inputSchema,
  }))
}

/** Invoke every tool with its fixtures and collect all emitted requests. */
export async function captureContract(
  fixtures: Record<string, Record<string, unknown>[]>,
): Promise<CapturedRequest[]> {
  let current = new RecordingClient()
  const registry = {
    resolve: () => current as unknown as WeeekApiClient,
    list: () => [],
    has: () => true,
  } as unknown as WorkspaceRegistry

  const tools = collectTools(registry)
  const out: CapturedRequest[] = []
  for (const tool of tools) {
    const argSets = fixtures[tool.name] ?? []
    for (const args of argSets) {
      current = new RecordingClient()
      await tool.handler(args)
      for (const rec of current.records) out.push({ tool: tool.name, ...rec })
    }
  }
  return out
}
```

- [ ] **Step 3: Write the failing test** — `tests/spec-sync/capture-contract.test.ts`

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes** (the harness + fixtures already exist)

Run: `pnpm vitest run tests/spec-sync/capture-contract.test.ts`
Expected: PASS (5 assertions). If `weeek_list_tasks` or others throw, the RecordingClient stub is wrong — re-check Task 4 returns `{}`.

- [ ] **Step 5: Write the coverage test** — `tests/spec-sync/fixtures.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { listRegisteredTools } from '../../scripts/spec-sync/capture-contract.js'
import { toolFixtures } from '../../scripts/spec-sync/fixtures.js'

const tools = listRegisteredTools()

describe('fixture coverage', () => {
  it('every registered tool has a fixture (and vice versa)', () => {
    const registered = tools.map((t) => t.name).sort()
    expect(Object.keys(toolFixtures).sort()).toEqual(registered)
  })

  it('every fixture validates against its tool zod input schema', () => {
    for (const t of tools) {
      const schema = z.object(t.inputSchema as z.ZodRawShape)
      for (const args of toolFixtures[t.name] ?? []) {
        expect(() => schema.parse(args)).not.toThrow()
      }
    }
  })
})
```

- [ ] **Step 6: Run the coverage test**

Run: `pnpm vitest run tests/spec-sync/fixtures.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck:scripts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/spec-sync/fixtures.ts scripts/spec-sync/capture-contract.ts tests/spec-sync/capture-contract.test.ts tests/spec-sync/fixtures.test.ts
git commit -m "feat(spec-sync): fixtures and runtime contract-capture harness"
```

---

### Task 6: Spec discovery (parse) + live loader

**Files:**
- Create: `scripts/spec-sync/discover.ts`
- Create: `scripts/spec-sync/load-spec.ts`
- Modify: `vitest.config.ts` (exclude integration tests)
- Create: `vitest.integration.config.ts`
- Modify: `package.json` (add `test:integration`)
- Test: `tests/spec-sync/discover.test.ts` (offline, default suite)
- Test: `tests/spec-sync/discover.integration.test.ts` (opt-in, network)

**Interfaces:**
- Produces: `discover.ts` → `parseEntryUrl(html): string`, `parseYamlChunkRef(entryJs): string`, `chunkHashFromName(name): string`. `load-spec.ts` → `resolveChunkUrl(fetchFn?): Promise<string>`, `loadSpec(): Promise<{ schema: OpenApiDoc; slugs: unknown; chunkUrl: string; chunkHash: string }>`.

- [ ] **Step 1: Write the failing test** — `tests/spec-sync/discover.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import {
  chunkHashFromName,
  parseEntryUrl,
  parseYamlChunkRef,
} from '../../scripts/spec-sync/discover.js'

describe('parseEntryUrl', () => {
  it('extracts the entry.client module src', () => {
    const html =
      '<script type="module" crossorigin src="/assets/entry.client-Dm62IRDB.js"></script>'
    expect(parseEntryUrl(html)).toBe('/assets/entry.client-Dm62IRDB.js')
  })
  it('throws when no entry chunk is present', () => {
    expect(() => parseEntryUrl('<html></html>')).toThrow(/entry chunk/i)
  })
})

describe('parseYamlChunkRef', () => {
  it('extracts the weeek.yaml chunk reference', () => {
    const js = 'await import("./weeek.yaml-zrWBOv8I.js");'
    expect(parseYamlChunkRef(js)).toBe('./weeek.yaml-zrWBOv8I.js')
  })
  it('throws when the chunk reference is missing', () => {
    expect(() => parseYamlChunkRef('const x = 1')).toThrow(/weeek\.yaml/i)
  })
})

describe('chunkHashFromName', () => {
  it('pulls the hash out of the filename', () => {
    expect(chunkHashFromName('/assets/weeek.yaml-zrWBOv8I.js')).toBe('zrWBOv8I')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/spec-sync/discover.test.ts`
Expected: FAIL — cannot resolve `discover.js`.

- [ ] **Step 3: Create `scripts/spec-sync/discover.ts`**

```ts
/** Pure parsing of the WEEEK dev-portal HTML/JS to locate the spec chunk. */

export function parseEntryUrl(html: string): string {
  const m = html.match(/src="(\/assets\/entry\.client-[^"]+\.js)"/)
  if (!m?.[1]) throw new Error('entry chunk not found in portal HTML')
  return m[1]
}

export function parseYamlChunkRef(entryJs: string): string {
  const m = entryJs.match(
    /["'`](\.?\/?(?:assets\/)?weeek\.yaml-[A-Za-z0-9_-]+\.js)["'`]/,
  )
  if (!m?.[1]) throw new Error('weeek.yaml chunk reference not found in entry bundle')
  return m[1]
}

export function chunkHashFromName(name: string): string {
  const m = name.match(/weeek\.yaml-([A-Za-z0-9_-]+)\.js/)
  return m?.[1] ?? ''
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/spec-sync/discover.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Create `scripts/spec-sync/load-spec.ts`** — the networked half. Downloads the chunk, follows any sibling `./*.js` imports into a temp dir, then dynamically imports it.

```ts
/** Network loader: resolve the spec chunk URL, download it, import schema/slugs. */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { OpenApiDoc } from './types.js'

import {
  chunkHashFromName,
  parseEntryUrl,
  parseYamlChunkRef,
} from './discover.js'

const PORTAL = 'https://developers.weeek.net'

async function getText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`)
  return res.text()
}

/** Walk HTML → entry chunk → weeek.yaml chunk and return its absolute URL. */
export async function resolveChunkUrl(): Promise<string> {
  const html = await getText(`${PORTAL}/`)
  const entry = parseEntryUrl(html)
  const entryJs = await getText(`${PORTAL}${entry}`)
  const ref = parseYamlChunkRef(entryJs).replace(/^\.?\//, '')
  return ref.startsWith('assets/')
    ? `${PORTAL}/${ref}`
    : `${PORTAL}/assets/${ref}`
}

/** Download the chunk (and any sibling ./*.js it imports) and import it. */
export async function loadSpec(): Promise<{
  schema: OpenApiDoc
  slugs: unknown
  chunkUrl: string
  chunkHash: string
}> {
  const chunkUrl = await resolveChunkUrl()
  const baseUrl = chunkUrl.slice(0, chunkUrl.lastIndexOf('/') + 1)
  const src = await getText(chunkUrl)

  const dir = await mkdtemp(path.join(tmpdir(), 'weeek-spec-'))
  const fileName = chunkUrl.slice(chunkUrl.lastIndexOf('/') + 1)
  await writeFile(path.join(dir, fileName), src, 'utf8')

  // Defensive: download any sibling chunks this module imports relatively.
  const siblings = new Set(
    [...src.matchAll(/["'`]\.\/([A-Za-z0-9._-]+\.js)["'`]/g)]
      .map((m) => m[1])
      .filter((n): n is string => Boolean(n) && n !== fileName),
  )
  for (const name of siblings) {
    await writeFile(path.join(dir, name), await getText(`${baseUrl}${name}`), 'utf8')
  }

  const mod = (await import(pathToFileURL(path.join(dir, fileName)).href)) as {
    schema?: OpenApiDoc
    slugs?: unknown
  }
  if (!mod.schema || !mod.slugs) {
    throw new Error(
      'spec chunk did not export both `schema` and `slugs` — the WEEEK portal format changed; update scripts/spec-sync/load-spec.ts',
    )
  }
  return {
    schema: mod.schema,
    slugs: mod.slugs,
    chunkUrl,
    chunkHash: chunkHashFromName(chunkUrl),
  }
}
```

- [ ] **Step 6: Exclude integration tests from the default suite** — edit `vitest.config.ts`. Add an `exclude` key inside `test`.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
    reporters: 'default',
  },
})
```

- [ ] **Step 7: Create `vitest.integration.config.ts`** — runs ONLY integration tests.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    reporters: 'default',
  },
})
```

- [ ] **Step 8: Add the `test:integration` script to `package.json`** (after `"test"`).

```json
"test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 9: Create the opt-in network test** — `tests/spec-sync/discover.integration.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { loadSpec, resolveChunkUrl } from '../../scripts/spec-sync/load-spec.js'

describe('live WEEEK spec loading (network)', () => {
  it('resolves a weeek.yaml chunk URL', async () => {
    const url = await resolveChunkUrl()
    expect(url).toMatch(/weeek\.yaml-.+\.js$/)
  })

  it('imports a dereferenced OpenAPI document', async () => {
    const { schema } = await loadSpec()
    expect(schema.paths['/tm/tasks']).toBeDefined()
  })
})
```

- [ ] **Step 10: Verify the default suite excludes the integration test**

Run: `pnpm vitest run tests/spec-sync/`
Expected: PASS; `discover.integration.test.ts` is NOT executed (no network hit). The offline `discover.test.ts` runs.

- [ ] **Step 11: Run the integration test explicitly (requires network)**

Run: `pnpm test:integration`
Expected: PASS (2 assertions). If the portal is unreachable, note it and continue — this test is opt-in and never runs in the offline PR job.

- [ ] **Step 12: Typecheck**

Run: `pnpm typecheck:scripts`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add scripts/spec-sync/discover.ts scripts/spec-sync/load-spec.ts vitest.config.ts vitest.integration.config.ts package.json tests/spec-sync/discover.test.ts tests/spec-sync/discover.integration.test.ts
git commit -m "feat(spec-sync): portal discovery and live OpenAPI chunk loader"
```

---

### Task 7: `fetch-spec` CLI + commit the snapshot

**Files:**
- Create: `scripts/spec-sync/fetch-spec.ts`
- Modify: `package.json` (add `spec:fetch`, `spec:check:upstream`)
- Create (generated): `spec/weeek-openapi.json`, `spec/weeek-openapi.meta.json`

**Interfaces:**
- Consumes: `loadSpec` from `load-spec.js`; `OpenApiDoc` from `types.js`.
- Produces: a CLI with two modes. Default: write snapshot + meta. `--check-upstream`: compare live spec to the committed snapshot; exit 1 on drift, 0 if identical. Writes user output via `process.stdout.write`.

- [ ] **Step 1: Create `scripts/spec-sync/fetch-spec.ts`**

```ts
/**
 * CLI. Default: download the live WEEEK spec and (re)write the committed
 * snapshot. With --check-upstream: compare live vs committed; exit 1 on drift.
 *
 * Output goes to stdout via process.stdout.write (the project bans console.log).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { OpenApiDoc } from './types.js'

import { loadSpec } from './load-spec.js'

const SNAPSHOT = path.join('spec', 'weeek-openapi.json')
const META = path.join('spec', 'weeek-openapi.meta.json')

interface SnapshotMeta {
  sourceUrl: string
  chunkHash: string
  fetchedAt: string
  openapiVersion?: string
}

function out(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

/** Compare two specs by their (method path) operation sets; return changed paths. */
function changedPaths(a: OpenApiDoc, b: OpenApiDoc): string[] {
  const sig = (s: OpenApiDoc): Map<string, string> => {
    const m = new Map<string, string>()
    for (const [p, methods] of Object.entries(s.paths ?? {})) {
      m.set(p, Object.keys(methods ?? {}).sort().join(','))
    }
    return m
  }
  const ma = sig(a)
  const mb = sig(b)
  const changed: string[] = []
  for (const [p, v] of mb) if (ma.get(p) !== v) changed.push(p)
  for (const [p] of ma) if (!mb.has(p)) changed.push(`${p} (removed)`)
  return changed.sort()
}

async function main(): Promise<number> {
  const checkUpstream = process.argv.includes('--check-upstream')
  const { schema, chunkUrl, chunkHash } = await loadSpec()

  if (!checkUpstream) {
    await mkdir('spec', { recursive: true })
    await writeFile(SNAPSHOT, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
    const meta: SnapshotMeta = {
      sourceUrl: chunkUrl,
      chunkHash,
      fetchedAt: new Date().toISOString(),
      openapiVersion: schema.openapi,
    }
    await writeFile(META, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    out(`✓ Snapshot written: ${SNAPSHOT} (chunk ${chunkHash})`)
    return 0
  }

  // --check-upstream: cheap hash short-circuit, then deep path diff.
  let committedMeta: SnapshotMeta
  try {
    committedMeta = JSON.parse(await readFile(META, 'utf8')) as SnapshotMeta
  } catch {
    out(`✗ No committed snapshot found at ${META}. Run \`pnpm spec:fetch\` first.`)
    return 1
  }
  if (committedMeta.chunkHash === chunkHash) {
    out(`✓ WEEEK spec unchanged upstream (chunk ${chunkHash}).`)
    return 0
  }
  const committed = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as OpenApiDoc
  const changed = changedPaths(committed, schema)
  out(`✗ WEEEK spec changed upstream: chunk ${committedMeta.chunkHash} → ${chunkHash}`)
  if (changed.length > 0) {
    out('Changed paths:')
    for (const p of changed) out(`  - ${p}`)
  } else {
    out('(no path-set changes; schema bodies/params differ — run `pnpm spec:fetch` and diff)')
  }
  out('Run `pnpm spec:fetch`, review the diff, reconcile the tools, and commit the refreshed snapshot.')
  return 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    process.stderr.write(`spec:fetch failed: ${(err as Error).message}\n`)
    process.exitCode = 1
  },
)
```

- [ ] **Step 2: Add the npm scripts to `package.json`** (after `"start"`).

```json
"spec:fetch": "tsx scripts/spec-sync/fetch-spec.ts",
"spec:check:upstream": "tsx scripts/spec-sync/fetch-spec.ts --check-upstream",
```

- [ ] **Step 3: Generate the snapshot for real** (requires network)

Run: `pnpm spec:fetch`
Expected: prints `✓ Snapshot written: spec/weeek-openapi.json (chunk <hash>)`; creates `spec/weeek-openapi.json` and `spec/weeek-openapi.meta.json`.

- [ ] **Step 4: Sanity-check the snapshot**

Run: `node -e "const s=require('./spec/weeek-openapi.json'); console.error('paths:', Object.keys(s.paths).length, 'has /tm/tasks:', !!s.paths['/tm/tasks'])"`
Expected: a positive path count and `has /tm/tasks: true`. (Uses `console.error` → stderr, allowed.)

- [ ] **Step 5: Verify `--check-upstream` reports "unchanged" against the just-written snapshot**

Run: `pnpm spec:check:upstream`
Expected: `✓ WEEEK spec unchanged upstream (chunk <hash>).`, exit 0.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck:scripts`
Expected: no errors.

- [ ] **Step 7: Commit (including the generated snapshot)**

```bash
git add scripts/spec-sync/fetch-spec.ts package.json spec/weeek-openapi.json spec/weeek-openapi.meta.json
git commit -m "feat(spec-sync): fetch-spec CLI and committed OpenAPI snapshot"
```

---

### Task 8: `check-drift` CLI

**Files:**
- Create: `scripts/spec-sync/check-drift.ts`
- Modify: `package.json` (add `spec:check`)

**Interfaces:**
- Consumes: `OpenApiDoc` from `types.js`; `indexOperations` from `openapi.js`; `captureContract` from `capture-contract.js`; `toolFixtures` from `fixtures.js`; `checkAll` from `compare.js`; `formatFindings`, `hasErrors` from `report.js`.
- Produces: a CLI that loads the committed snapshot, captures the code contract, compares, prints the report, and exits 1 if any error-severity finding exists.

- [ ] **Step 1: Create `scripts/spec-sync/check-drift.ts`**

```ts
/**
 * CLI. Compare what the MCP tools send (captured at runtime) against the
 * committed WEEEK OpenAPI snapshot. Exit 1 if any error-severity drift is found.
 * Fully offline — reads spec/weeek-openapi.json, never touches the network.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { OpenApiDoc } from './types.js'

import { captureContract } from './capture-contract.js'
import { checkAll } from './compare.js'
import { toolFixtures } from './fixtures.js'
import { indexOperations } from './openapi.js'
import { formatFindings, hasErrors } from './report.js'

const SNAPSHOT = path.join('spec', 'weeek-openapi.json')

async function main(): Promise<number> {
  let spec: OpenApiDoc
  try {
    spec = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as OpenApiDoc
  } catch {
    process.stderr.write(
      `No snapshot at ${SNAPSHOT}. Run \`pnpm spec:fetch\` first.\n`,
    )
    return 1
  }

  const index = indexOperations(spec)
  const captured = await captureContract(toolFixtures)
  const findings = checkAll(captured, index)
  process.stdout.write(formatFindings(findings))
  return hasErrors(findings) ? 1 : 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    process.stderr.write(`spec:check failed: ${(err as Error).message}\n`)
    process.exitCode = 1
  },
)
```

- [ ] **Step 2: Add the npm script to `package.json`** (after the `spec:fetch` lines).

```json
"spec:check": "tsx scripts/spec-sync/check-drift.ts",
```

- [ ] **Step 3: Run the detector against the committed snapshot**

Run: `pnpm spec:check`
Expected: Since the code was already aligned to the spec (commit `d3417da`), the most likely result is `✓ No spec drift detected …` and exit 0.
If errors appear, the detector is working — they are real divergences between the snapshot and the tools. Investigate each: confirm against the live WEEEK API, then either fix the tool or, if WEEEK's spec is the outlier, record the finding. Do NOT silence a finding to make the command pass.

- [ ] **Step 4: Confirm the exit code**

Run: `pnpm spec:check; echo "exit=$?"`
Expected: `exit=0` (clean) — or a non-zero code with a findings report if drift exists.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck:scripts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/spec-sync/check-drift.ts package.json
git commit -m "feat(spec-sync): check-drift CLI comparing tools to the snapshot"
```

---

### Task 9: CI workflow — PR gate + nightly upstream check

**Files:**
- Create: `.github/workflows/spec-drift.yml`

**Interfaces:**
- Consumes: npm scripts `spec:check` and `spec:check:upstream`; pnpm `packageManager` field (`pnpm@10.27.0`); `pnpm-lock.yaml`.
- Produces: a CI workflow with two jobs — `pr-drift` (PR + push, fails on code↔snapshot drift) and `upstream-drift` (nightly + manual, opens/updates a `spec-drift` issue on live↔snapshot drift).

- [ ] **Step 1: Create `.github/workflows/spec-drift.yml`**

```yaml
name: spec-drift

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '17 6 * * *'
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  pr-drift:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Check code against committed spec snapshot
        run: pnpm spec:check

  upstream-drift:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Compare live WEEEK spec to committed snapshot
        id: drift
        run: pnpm spec:check:upstream
        continue-on-error: true
      - name: Open or update a tracking issue on drift
        if: steps.drift.outcome == 'failure'
        uses: actions/github-script@v7
        with:
          script: |
            const title = 'WEEEK API spec drift detected'
            const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
            const body = [
              'The nightly `spec:check:upstream` job found that the WEEEK OpenAPI spec changed relative to the committed snapshot in `spec/`.',
              '',
              'Run `pnpm spec:fetch` locally, review the diff, reconcile the MCP tools, then commit the refreshed snapshot.',
              '',
              `Workflow run: ${runUrl}`,
            ].join('\n')
            const existing = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
              labels: 'spec-drift',
            })
            if (existing.data.length > 0) {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: existing.data[0].number,
                body,
              })
            } else {
              await github.rest.issues.create({
                owner: context.repo.owner,
                repo: context.repo.repo,
                title,
                body,
                labels: ['spec-drift'],
              })
            }
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run: `node -e "const fs=require('fs');const c=fs.readFileSync('.github/workflows/spec-drift.yml','utf8');console.error('jobs found:', /pr-drift:/.test(c) && /upstream-drift:/.test(c))"`
Expected: `jobs found: true`. (If `yamllint` or `actionlint` is available, prefer running that.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/spec-drift.yml
git commit -m "ci(spec-sync): PR drift gate and nightly upstream-drift check"
```

---

### Task 10: Documentation + full verification

**Files:**
- Modify: `CLAUDE.md` (add a "Spec-drift detector" subsection)
- Modify: `README.md` (mention `pnpm spec:check` for contributors)

**Interfaces:**
- Consumes: everything above. No code; documents the workflow and runs the full verification suite.

- [ ] **Step 1: Add a section to `CLAUDE.md`** — insert after the "Plugin layer" section.

```markdown
## Spec-drift detector

`scripts/spec-sync/` compares what the MCP tools actually send against WEEEK's
current OpenAPI spec, so request-shape drift (wrong verb, path, body field, or
query param) is caught automatically instead of via manual live probing.

- **Spec source:** WEEEK's dev portal ships its OpenAPI as a hashed ESM chunk
  (`weeek.yaml-<hash>.js` exporting `schema`/`slugs`). `load-spec.ts` discovers
  and imports it. The normalized spec is committed at `spec/weeek-openapi.json`
  (+ `spec/weeek-openapi.meta.json`).
- **Code side:** `capture-contract.ts` drives the real tool handlers against a
  `RecordingClient` (fake server + fake registry) to capture every request.
- **Commands:**
  - `pnpm spec:fetch` — refresh the committed snapshot from live WEEEK.
  - `pnpm spec:check` — offline: tools ↔ snapshot. Fails on error-severity drift.
  - `pnpm spec:check:upstream` — live ↔ snapshot. Detects WEEEK-side changes.
- **CI** (`.github/workflows/spec-drift.yml`): `spec:check` runs on every PR/push;
  a nightly job runs `spec:check:upstream` and opens a `spec-drift` issue on change.
- **Adding a tool:** add a maximal fixture in `scripts/spec-sync/fixtures.ts`.
  The `fixtures.test.ts` coverage test fails if a registered tool has no fixture.
```

- [ ] **Step 2: Add a short note to `README.md`** — under the contributor/development section (or create a brief "Spec drift" note near the test instructions).

```markdown
### Keeping in sync with the WEEEK API

The MCP tools are checked against WEEEK's OpenAPI spec automatically.
Run `pnpm spec:check` to verify the tools match the committed snapshot
(`spec/weeek-openapi.json`), and `pnpm spec:fetch` to refresh that snapshot
from the live WEEEK API. See the "Spec-drift detector" section in `CLAUDE.md`.
```

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all pre-existing tests plus the new `tests/spec-sync/*.test.ts` (integration test excluded). Confirm the total count grew and nothing regressed.

- [ ] **Step 4: Typecheck both source and scripts**

Run: `pnpm typecheck && pnpm typecheck:scripts`
Expected: no errors in either.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: clean. If the antfu preset flags anything in `scripts/spec-sync/` (e.g. import order, `node:` prefixes, `process` global), fix per the preset — do NOT introduce `console.log`.

- [ ] **Step 6: Run the offline drift check one more time end-to-end**

Run: `pnpm spec:check; echo "exit=$?"`
Expected: `exit=0` with `✓ No spec drift detected …` (or a real findings report if drift exists).

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs(spec-sync): document the spec-drift detector workflow"
```

---

## Self-Review

**Spec coverage** (each spec section → task):

- Specification source / acquisition flow → Task 6 (`discover.ts`, `load-spec.ts`) + Task 6 Step 5 sibling-chunk handling + the `schema`/`slugs` assertion.
- Architecture FLOW A (spec → snapshot) → Tasks 6 + 7.
- Architecture FLOW B (code seam, RecordingClient, fixtures) → Tasks 4 + 5.
- Matcher → Tasks 1 (index/match) + 2 (rules).
- Components table → Tasks 1–8 (every file mapped).
- Snapshot files (committed) → Task 7 (`spec/weeek-openapi.json` + meta).
- Data shapes (`CapturedRequest`, `Finding`) → Task 1 (`types.ts`).
- Comparison rules (6 codes + severities) → Task 2 (each code has a test).
- CI (pr-drift + upstream-drift) → Task 9.
- Error handling / resilience (loud failure on format change, base-path norm, offline PR job) → Task 6 (assertion + `specBasePath`), Task 8 (offline read).
- Testing (unit, coverage test, opt-in integration) → Tasks 1–6 + Task 5 coverage test + Task 6 integration test.
- Out of scope (response shapes, deep nesting, auto-PR) → intentionally not implemented; nested checks limited to one level (Task 2).

**Placeholder scan:** No TBD/TODO. Every code step shows complete, runnable code. No "implement later", no untyped references — every imported symbol is defined in an earlier task's produced interface.

**Type consistency:** `CapturedRequest`/`Finding`/`OpenApiDoc`/`IndexedOperation` defined once in Task 1 and imported everywhere. `captureContract` returns `Promise<CapturedRequest[]>` (Task 5) and is `await`ed in Task 8. `checkAll(captured, index)` signature matches Task 2 definition and Task 8 usage. `loadSpec()` return shape (`{ schema, slugs, chunkUrl, chunkHash }`) defined in Task 6 and consumed in Task 7. `toolFixtures` typed `Record<string, Record<string, unknown>[]>` in Task 5 and consumed by `captureContract` (same type) and `check-drift.ts`. `RecordingClient.get/post/put/patch` signatures mirror `WeeekApiClient` so the registry-seam cast is sound.
