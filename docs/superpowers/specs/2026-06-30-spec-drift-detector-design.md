# WEEEK API Spec-Drift Detector — Design

- **Date:** 2026-06-30
- **Status:** Approved (design); implementation plan pending
- **Author:** Erik Codev (with Claude Code)

## Problem

The MCP tools encode assumptions about the WEEEK Public API: HTTP verb, path,
request-body field names, and query parameters. These assumptions can silently
drift out of sync with the real API in two directions:

1. **Code drift** — a code change starts sending a request shape the API rejects.
2. **Upstream drift** — WEEEK changes the API (renamed field, moved endpoint,
   new required field) and our code no longer matches.

A recent fix (`d3417da`, "align task write tools with WEEEK API spec") was
exactly this class of bug, found only by manual end-to-end probing against a
live proxy:

- `create_task` sent `project`/`board`/`column` as top-level body fields, but
  WEEEK requires a `locations: [{ projectId, boardColumnId }]` array (403
  `scope_required` otherwise).
- `move_task` did `PUT /tm/tasks/{id}` with `boardColumnId`, but WEEEK exposes
  dedicated `POST /tm/tasks/{id}/board` and `/board-column` endpoints.
- `complete_task` did `PUT /tm/tasks/{id}` with `isCompleted`, but WEEEK uses
  `POST /tm/tasks/{id}/complete` and `/un-complete`.

We want an automated detector that compares the **current** WEEEK API
specification against what our code **actually sends**, and flags divergence —
on every PR (catch code drift) and on a schedule (catch upstream drift).

## Specification source

WEEEK does not publish a stable machine-readable spec URL. Its developer portal
(`https://developers.weeek.net/`) is a Zuplo / Vite single-page app. The HTML
loads only `/assets/entry.client-<hash>.js`. That entry chunk lazily references
a generated chunk **`/assets/weeek.yaml-<hash>.js`**, which is the OpenAPI
document compiled from `weeek.yaml` into an ESM module.

Confirmed structure of the chunk (hash `zrWBOv8I` at time of writing):

- Pure ESM, self-contained (builds an array of ~63 schema objects and wires
  `$ref` targets together via shared object references — i.e. the spec is
  **already dereferenced**).
- Final line: `export{a as schema,r as slugs}`.
  - `schema` — a full OpenAPI document (`paths`, `components/schemas`, etc.).
    Contains real paths: `/tm/tasks`, `/tm/board-columns/{id}/move`, …
  - `slugs` — mapping of doc slug → operation (e.g. `/tm/tasks-post-Create`).
    Not required for drift detection; captured opportunistically.

The hash in the chunk filename changes whenever the spec changes — this gives a
cheap "did anything change upstream?" signal before any deep diff.

### Acquisition flow

```
GET https://developers.weeek.net/
  → parse <script type=module src=/assets/entry.client-<h>.js>
GET /assets/entry.client-<h>.js
  → find "./weeek.yaml-<h>.js"
GET /assets/weeek.yaml-<h>.js
  → write to a temp .mjs → await import(pathToFileURL(tmp))
  → read { schema, slugs }
```

Robustness: assert both exports exist; if the chunk grows transitive
`import … from './…'` references, download the sibling chunks into the same temp
dir before importing. If the export shape changes, **fail loudly** — the tool
must never silently pass because it failed to load the spec.

## Architecture

Two independent flows that converge in a matcher:

```
FLOW A (spec):  HTML → entry.client-<h>.js → weeek.yaml-<h>.js
                → dynamic import() → { schema, slugs }
                → normalize → spec/weeek-openapi.json (committed snapshot)

FLOW B (code):  fakeServer + fakeRegistry + RecordingClient
                → register{Read,Write}Tools → for each tool: handler(fixture)
                → collect CapturedRequest[]

MATCHER:        for each CapturedRequest, find the matching spec operation
                → check verb / path / body fields / query params
                → Finding[] → report + process exit code
```

### The code seam (FLOW B)

The existing wiring makes runtime capture clean, with no production-code changes:

- `resolveClient(registry, workspace)` simply calls `registry.resolve(workspace)`.
  A fake registry `{ resolve: () => recordingClient }` is sufficient.
- Tools register via `server.registerTool(name, def, handler)`, grouped by
  `registerReadTools(server, registry)` and `registerWriteTools(server, registry)`.
  A fake "server" whose `registerTool` pushes `{ name, inputSchema, handler }`
  collects every tool's handler and its zod input shape (`def.inputSchema`).
- For each captured tool, invoke `await handler(fixtureArgs)`. The
  `RecordingClient` records every `{ method, path, query?, body? }` and returns a
  post-processing-safe stub so the handler's own shaping
  (`unwrapTask`, `extractArray`, re-fetch) does not throw. The returned value is
  irrelevant — we only keep the captured requests.
- A single tool may emit multiple requests (e.g. `move_task` → `POST …/board`,
  `POST …/board-column`, `GET /tm/tasks/{id}` re-fetch). Each captured request is
  validated independently.

`RecordingClient` implements the same surface as `WeeekApiClient`
(`get`, `post`, `put`, `patch`).

### Fixtures

`fixtures.ts` maps each tool name to a **maximal** argument set — every optional
parameter populated — so that every conditional body field and query key is
emitted. This is what makes `body-missing-required` detectable: if a spec
`requestBody` requires a field that even the maximal fixture never produces, the
code cannot satisfy the API.

ID-like fields use recognizable sentinel values; the path matcher treats any
single path segment as a `{param}` match, so sentinels do not need to be real.

## Components

All under `scripts/spec-sync/`:

| File | Responsibility |
|------|----------------|
| `discover.ts` | HTML → `entry.client` hash → `weeek.yaml` chunk hash → absolute chunk URL |
| `fetch-spec.ts` | discover → download chunk to temp `.mjs` → `import()` → extract `schema`/`slugs` → write snapshot + meta. CLI. `--check-upstream`: do not write; diff live vs committed snapshot; exit ≠ 0 on drift |
| `capture-contract.ts` | fakeServer + fakeRegistry + `RecordingClient` → `Map<toolName, CapturedRequest[]>` |
| `fixtures.ts` | maximal argument fixtures per tool |
| `openapi.ts` | operation index over the snapshot; path-template matcher (`{id}` → segment regex); accessors for `requestBody` schema and `parameters` |
| `check-drift.ts` | load snapshot → capture contract → run matcher → print report → exit code. CLI |
| `report.ts` | format `Finding[]` grouped by severity |

### Snapshot files (committed)

- `spec/weeek-openapi.json` — the normalized `schema` object, pretty-printed.
- `spec/weeek-openapi.meta.json` — `{ sourceUrl, chunkHash, fetchedAt, openapiVersion }`.

The committed `chunkHash` lets the nightly job short-circuit: if the live chunk
hash equals the stored hash, nothing changed upstream and the job exits clean
without a deep diff.

## Data shapes

```ts
interface CapturedRequest {
  tool: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  path: string                 // concrete, e.g. /tm/tasks/__ID__/board-column
  query?: Record<string, unknown>
  body?: unknown
}

type Severity = 'error' | 'warn'

interface Finding {
  severity: Severity
  code:
    | 'endpoint-missing'
    | 'body-unknown-field'
    | 'body-missing-required'
    | 'query-unknown-param'
    | 'query-missing-required'
    | 'nested-mismatch'
  tool: string
  method: string
  path: string
  detail: string               // e.g. "field `boardColumnId` not in requestBody schema"
}
```

## Comparison rules

For each `CapturedRequest`, resolve the matching spec operation by (verb, path
template). Then:

| Code | Severity | Condition |
|------|----------|-----------|
| `endpoint-missing` | error | (method, path) matches no spec operation. Catches the `PUT → POST /board-column` bug. |
| `body-unknown-field` | error | a top-level body key is not declared in the operation's `requestBody` schema (and `additionalProperties !== true`). |
| `body-missing-required` | error | a `requestBody` required property is never emitted, even by the maximal fixture. Catches the `locations` bug. |
| `query-unknown-param` | error | a query key is not a declared `in: query` parameter. |
| `query-missing-required` | warn | a required query parameter is never emitted. |
| `nested-mismatch` | warn | one level into arrays-of-objects (e.g. inside `locations[]`); kept at warn to bound noise. |

Spec operations the code never touches are **ignored** — no "unused endpoint"
noise. The detector only judges what the tools actually send.

Path matching: spec path templates have `{param}` segments; convert each to a
`[^/]+` segment regex and test the concrete captured path. Reconcile base paths
between `client.baseUrl` (e.g. `…/public/v1`) and `schema.servers[].url` so both
are compared relative to the same logical root.

## CI (`.github/workflows/spec-drift.yml`)

- **Job `pr-drift`** — triggers: `pull_request`, `push`. Runs `pnpm spec:check`
  (code ↔ committed snapshot). Offline, deterministic. **Fails** on drift.
  Guards against code regressions.
- **Job `upstream-drift`** — triggers: `schedule` (nightly cron),
  `workflow_dispatch`. Runs `pnpm spec:check:upstream` (live ↔ committed
  snapshot). On drift: open/update a tracking GitHub issue. (A follow-up PR that
  runs `spec:fetch` to refresh the snapshot is optional and can be added later.)
  Guards against upstream WEEEK changes.

npm scripts:

- `spec:fetch` → `tsx scripts/spec-sync/fetch-spec.ts` (rewrite snapshot + meta)
- `spec:check` → `tsx scripts/spec-sync/check-drift.ts` (code ↔ snapshot, offline)
- `spec:check:upstream` → `tsx scripts/spec-sync/fetch-spec.ts --check-upstream`

## Error handling / resilience

- **Chunk import** — temp `.mjs` + `import(pathToFileURL(...))`. Follow
  transitive chunk imports if present. Assert `schema`/`slugs` exports exist;
  fail loudly on format change.
- **Loader trust:** `load-spec.ts` dynamically `import()`s a JS chunk downloaded over HTTPS from the hard-coded host `developers.weeek.net`. This runs only in `spec:fetch`/`spec:check:upstream` (maintainer/CI contexts) — `scripts/` is excluded from the npm `files` allowlist, so it never ships to end users. The loader trusts the WEEEK host.
- **Cycles** — `schema` is already dereferenced via shared object references;
  any structural walk uses a visited set / depth cap to avoid infinite loops.
- **Base path** — normalize `client.baseUrl` vs `schema.servers[].url` before
  path matching.
- **Network** — only the discover/fetch path touches the network. `spec:check`
  (PR job) is fully offline against the committed snapshot.

## Testing (vitest, offline by default)

- Unit: path-template matcher and body/query comparison against a tiny fake
  OpenAPI fixture.
- **Coverage test**: every registered tool has a fixture, and every fixture
  validates against that tool's own zod input schema (`def.inputSchema`). This
  prevents a newly added tool from silently escaping drift coverage and prevents
  fixture rot.
- Capture harness: unit-tested with a couple of real tools against the tiny fake
  spec.
- Network discover/import: a separate **opt-in** integration test, excluded from
  the default `vitest run`, so the unit suite stays offline and fast.

## Out of scope (v1)

- Response-shape checking (validating that fields the code reads from responses
  still exist in the spec). Valuable, but request-side drift is the proven bug
  class; deferred.
- Deep recursive body validation beyond one nested level.
- Auto-opening a snapshot-refresh PR from the nightly job (issue only for now).
