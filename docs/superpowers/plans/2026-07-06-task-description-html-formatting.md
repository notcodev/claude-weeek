# Task Description HTML Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guide agents to write formatted HTML (a whitelisted subset) into the `description` field of `weeek_create_task` / `weeek_update_task`, so task descriptions render richly in the WEEEK editor instead of as raw plain text.

**Architecture:** Documentation-only change. The tools already send `description` to WEEEK verbatim (passthrough) — no wire behavior changes. We add a shared guidance constant and wire it into the `description` field's `.describe()` on both write tools, plus a short clause on each tool-level `description`. A single shared constant keeps the two tools from drifting.

**Tech Stack:** TypeScript (ESM, NodeNext), `zod@^3.25`, `@modelcontextprotocol/sdk@^1.29`, `vitest`.

## Global Constraints

- ESM throughout — `.js` extensions on relative imports, no CommonJS.
- No `console.log` (`no-console` is `error`; only `console.error`/`warn` allowed).
- Do **not** upgrade zod past v3.25 or add new runtime dependencies.
- Node `>=20`.
- **No outgoing wire changes:** the request field stays `description` (string). `pnpm spec:check` must remain clean — do not touch request bodies.
- Advertised HTML whitelist (exactly, no more): `<p>`, `<strong>`, `<em>`, `<a href="...">`, `<br>`, `<ul>`/`<ol>` with `<li>`.
- DRY: the guidance text lives in exactly one place.

---

## File Structure

- **Create** `src/tools/write/_shared.ts` — exports two string constants: `DESCRIPTION_HTML_GUIDANCE` (used by create) and `DESCRIPTION_HTML_GUIDANCE_UPDATE` (base + update-specific tail). Single source of truth for the guidance copy.
- **Modify** `src/tools/write/create-task.ts` — import `DESCRIPTION_HTML_GUIDANCE`, use it as the `description` field `.describe()`; append an HTML clause to the tool-level `description`.
- **Modify** `src/tools/write/update-task.ts` — import `DESCRIPTION_HTML_GUIDANCE_UPDATE`, use it as the `description` field `.describe()`; append an HTML clause to the tool-level `description`.
- **Modify** `tests/tools/create-task.test.ts` — extend the fake server to capture `inputSchema`; add regression tests for the field guidance and the tool-level HTML clause.
- **Modify** `tests/tools/update-task.test.ts` — same, plus assert the update-specific tail survives.

**Note on testing the schema:** the fake server currently captures only `meta.description` (the tool-level string). Zod preserves `.describe()` through `.optional()`, so once the fake server also captures `meta.inputSchema`, the field guidance is readable as `inputSchema.description.description` (a plain string). Tests assert on stable substrings of that guidance, not exact equality, so wording tweaks that keep the whitelist won't break them.

---

### Task 1: Shared guidance constant + wire into create-task

**Files:**
- Create: `src/tools/write/_shared.ts`
- Modify: `src/tools/write/create-task.ts` (imports at top; `description` field at `:40-45`; tool-level `description` at `:90`)
- Test: `tests/tools/create-task.test.ts` (fake server at `:23-51`; new tests appended in the `describe` block)

**Interfaces:**
- Produces: `src/tools/write/_shared.ts` exporting
  - `export const DESCRIPTION_HTML_GUIDANCE: string`
  - `export const DESCRIPTION_HTML_GUIDANCE_UPDATE: string` (= `DESCRIPTION_HTML_GUIDANCE` + `' Omit to leave unchanged. Pass empty string to clear.'`)
- Consumes (in create-task): `DESCRIPTION_HTML_GUIDANCE` from `./_shared.js`.

- [ ] **Step 1: Extend the fake server and write failing tests**

In `tests/tools/create-task.test.ts`, add the import near the top (after the existing imports):

```typescript
import { DESCRIPTION_HTML_GUIDANCE } from '../../src/tools/write/_shared.js'
```

Widen the fake server to capture `inputSchema`. Replace the `makeFakeServer` function (currently `:23-51`) with:

```typescript
function makeFakeServer() {
  let capturedName = ''
  let capturedDescription = ''
  let capturedInputSchema: Record<string, { description?: string }> = {}
  let capturedHandler: Handler | null = null
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        meta: {
          description: string
          inputSchema: Record<string, { description?: string }>
        },
        handler: Handler,
      ) => {
        capturedName = name
        capturedDescription = meta.description
        capturedInputSchema = meta.inputSchema
        capturedHandler = handler
      },
    ),
  }
  return {
    server: server as unknown as Parameters<
      typeof registerCreateTask
    >[0],
    name: () => capturedName,
    description: () => capturedDescription,
    inputSchema: () => capturedInputSchema,
    handler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}
```

Then add these two tests inside the `describe('weeek_create_task tool', ...)` block (e.g. right after the existing `'description distinguishes itself...'` test):

```typescript
it('description field advertises the WEEEK HTML subset', () => {
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  }
  registerCreateTask(fake.server, fakeRegistry(client))
  const guide = fake.inputSchema().description?.description ?? ''
  // wired to the shared constant...
  expect(guide).toBe(DESCRIPTION_HTML_GUIDANCE)
  // ...and the constant carries the whole whitelist + escaping + fallback note
  for (const marker of [
    '<p>',
    '<strong>',
    '<em>',
    '<a href',
    '<br>',
    '<li>',
    '&lt;',
    'Plain text is still accepted',
  ]) {
    expect(guide).toContain(marker)
  }
})

it('tool description mentions HTML formatting', () => {
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  }
  registerCreateTask(fake.server, fakeRegistry(client))
  expect(fake.description()).toMatch(/HTML/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/tools/create-task.test.ts`
Expected: FAIL — cannot resolve `../../src/tools/write/_shared.js` (module does not exist yet). If the module resolution error masks the assertions, that still counts as red.

- [ ] **Step 3: Create the shared guidance module**

Create `src/tools/write/_shared.ts`:

```typescript
/**
 * Shared copy for the `description` field of the write tools.
 *
 * WEEEK's task editor renders a small HTML subset. There is no sanitizer on
 * the write path — the string is sent verbatim — so this guidance advertises
 * exactly the tags WEEEK is known to render, and no others. Kept in one place
 * so weeek_create_task and weeek_update_task cannot drift apart.
 */
export const DESCRIPTION_HTML_GUIDANCE =
  'Task description / body. Optional. Supports a small HTML subset rendered by '
  + 'the WEEEK editor. Allowed tags only: <p> (paragraph), <strong> (bold), '
  + '<em> (italic), <a href="..."> (link), <br> (line break inside a paragraph), '
  + '<ul>/<ol> with <li> (bullet / numbered lists). Wrap each paragraph in '
  + '<p>...</p>. Do NOT use Markdown, headings, tables, or any tag outside this '
  + "list — unsupported tags are stored raw and won't render. Escape literal "
  + '<, >, & in text as &lt;, &gt;, &amp;. Plain text is still accepted.'

/** Same guidance, plus the update-only clarification about omitted/empty values. */
export const DESCRIPTION_HTML_GUIDANCE_UPDATE
  = `${DESCRIPTION_HTML_GUIDANCE} Omit to leave unchanged. Pass empty string to clear.`
```

- [ ] **Step 4: Wire the constant into create-task**

In `src/tools/write/create-task.ts`, add the import (alongside the other local imports, e.g. after the `../read/_helpers.js` import block):

```typescript
import { DESCRIPTION_HTML_GUIDANCE } from './_shared.js'
```

Replace the `description` field definition (currently `:40-45`) with:

```typescript
  description: z
    .string()
    .describe(DESCRIPTION_HTML_GUIDANCE)
    .optional(),
```

Append an HTML clause to the tool-level `description` string (currently ends with `...do not guess IDs.` at `:90`). Change the final sentence so the string ends with:

```
...All *_id parameters must come from the corresponding list tools — do not guess IDs. The description parameter accepts a small WEEEK HTML subset (paragraphs, bold, italic, links, lists) for rich formatting — see its parameter guidance for the exact allowed tags.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tools/create-task.test.ts`
Expected: PASS (all create-task tests, including the two new ones and the pre-existing `'description distinguishes itself'`).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors. (If the preset flags the multi-line string concatenation style, run `pnpm lint --fix` and re-run `pnpm typecheck`.)

- [ ] **Step 7: Commit**

```bash
git add src/tools/write/_shared.ts src/tools/write/create-task.ts tests/tools/create-task.test.ts
git commit -m "feat(create-task): advertise WEEEK HTML subset in description guidance"
```

---

### Task 2: Wire guidance into update-task

**Files:**
- Modify: `src/tools/write/update-task.ts` (imports at top; `description` field at `:43-48`; tool-level `description` at `:79`)
- Test: `tests/tools/update-task.test.ts` (fake server; new tests in the `describe` block)

**Interfaces:**
- Consumes: `DESCRIPTION_HTML_GUIDANCE_UPDATE` from `./_shared.js` (created in Task 1).

- [ ] **Step 1: Extend the fake server and write failing tests**

Open `tests/tools/update-task.test.ts`. It mirrors the create-task test (its own `makeFakeServer` capturing `meta.description` + handler). Apply the **same** fake-server widening as Task 1 Step 1: capture `meta.inputSchema` and expose an `inputSchema: () => capturedInputSchema` accessor (use the identical `capturedInputSchema: Record<string, { description?: string }>` typing and the widened `meta` type). Add the import near the top:

```typescript
import { DESCRIPTION_HTML_GUIDANCE_UPDATE } from '../../src/tools/write/_shared.js'
```

Add these tests inside the update-task `describe` block:

```typescript
it('description field advertises the WEEEK HTML subset', () => {
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  }
  registerUpdateTask(fake.server, fakeRegistry(client))
  const guide = fake.inputSchema().description?.description ?? ''
  expect(guide).toBe(DESCRIPTION_HTML_GUIDANCE_UPDATE)
  for (const marker of [
    '<p>',
    '<strong>',
    '<em>',
    '<a href',
    '<br>',
    '<li>',
    '&lt;',
    'Plain text is still accepted',
    // update-only tail must survive
    'Omit to leave unchanged',
    'Pass empty string to clear',
  ]) {
    expect(guide).toContain(marker)
  }
})

it('tool description mentions HTML formatting', () => {
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  }
  registerUpdateTask(fake.server, fakeRegistry(client))
  expect(fake.description()).toMatch(/HTML/)
})
```

> If `registerUpdateTask` is not already imported in this test file, add `import { registerUpdateTask } from '../../src/tools/write/update-task.js'` — match the existing import in the file rather than duplicating.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/tools/update-task.test.ts`
Expected: FAIL — `guide` is the old `'New task description...'` text, so `toBe(...)` and the marker assertions fail; `/HTML/` fails on the tool description.

- [ ] **Step 3: Wire the constant into update-task**

In `src/tools/write/update-task.ts`, add the import (alongside the other local imports):

```typescript
import { DESCRIPTION_HTML_GUIDANCE_UPDATE } from './_shared.js'
```

Replace the `description` field definition (currently `:43-48`) with:

```typescript
  description: z
    .string()
    .describe(DESCRIPTION_HTML_GUIDANCE_UPDATE)
    .optional(),
```

Append an HTML clause to the tool-level `description` (currently ends `...must come from weeek_list_tasks.` at `:79`) so the string ends with:

```
...The task_id must come from weeek_list_tasks. The description parameter accepts a small WEEEK HTML subset (paragraphs, bold, italic, links, lists) for rich formatting — see its parameter guidance for the exact allowed tags.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tools/update-task.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification gate**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors (use `pnpm lint --fix` if only formatting is flagged, then re-typecheck).

Run: `pnpm vitest run`
Expected: entire suite green (no snapshot or metadata test elsewhere depends on the old `description` copy — confirm 0 failures).

Run: `pnpm spec:check`
Expected: no active drift — the request shape is unchanged, so this must be clean. If it reports anything new, stop: something touched the wire path that should not have.

- [ ] **Step 6: Commit**

```bash
git add src/tools/write/update-task.ts tests/tools/update-task.test.ts
git commit -m "feat(update-task): advertise WEEEK HTML subset in description guidance"
```

- [ ] **Step 7 (optional, manual): Confirm the `ul/ol/li` assumption against live WEEEK**

The whitelist assumes WEEEK renders lists. With a real token configured, create one throwaway task whose description exercises the full whitelist and eyeball it in the WEEEK UI:

```
<p><strong>Smoke test</strong> — HTML rendering.</p>
<p>Line one<br>line two</p>
<ul><li>bullet <em>italic</em></li><li>bullet <a href="https://example.com">link</a></li></ul>
<ol><li>first</li><li>second</li></ol>
```

If lists do **not** render, remove `<ul>/<ol>/<li>` from `DESCRIPTION_HTML_GUIDANCE` (and the corresponding markers from both tests) and re-run Task 2 Step 5. Otherwise no change. This step produces no commit unless the whitelist needs trimming.

---

## Self-Review

**Spec coverage:**
- HTML passthrough interface, no code/wire change → Task 1 & 2 change only guidance strings; Task 2 Step 5 asserts `spec:check` clean. ✓
- Whitelist `p, strong, em, a, br, ul/ol/li` → encoded in `DESCRIPTION_HTML_GUIDANCE` (Task 1 Step 3) and asserted via markers (both tasks). ✓
- Shared constant so the two tools cannot drift → `_shared.ts`, consumed by both; tests assert equality to the shared constant. ✓
- update-task tail "Omit to leave unchanged / Pass empty string to clear" → `DESCRIPTION_HTML_GUIDANCE_UPDATE`, asserted in Task 2. ✓
- Tool-level `description` notes the HTML subset → appended clause + `/HTML/` test in both tasks. ✓
- Read tools out of scope → not touched. ✓
- Verify `ul/ol/li` assumption before merge → Task 2 Step 7. ✓
- English guidance → all copy is English. ✓

**Placeholder scan:** No TBD/TODO; every code and command step shows concrete content. ✓

**Type consistency:** `DESCRIPTION_HTML_GUIDANCE` / `DESCRIPTION_HTML_GUIDANCE_UPDATE` names, the `inputSchema: () => Record<string, { description?: string }>` accessor, and `registerCreateTask`/`registerUpdateTask` usages match across tasks and tests. ✓
