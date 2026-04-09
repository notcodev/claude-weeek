---
phase: 03-write-tools
plan: "01"
subsystem: write-tools
tags: [mcp, tools, write, zod, weeek-api, task-authoring]

# Dependency graph
requires:
  - phase: 02-read-tools
    provides: jsonContent helper, server.registerTool ZodRawShape pattern, toMcpError pattern
  - phase: 01-foundation
    provides: WeeekApiClient.post/put, McpServer, registerWriteTools hook, logger, errors.ts
provides:
  - registerCreateTask (src/tools/write/create-task.ts) — weeek_create_task (TASK-04)
  - registerUpdateTask (src/tools/write/update-task.ts) — weeek_update_task (TASK-05)
  - registerWriteTools wired with 2 tools (src/tools/write/index.ts)
affects:
  - 03-02 (move_task, complete_task, create_task_comment — same write-tool pattern to mirror)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Write tools follow identical server.registerTool ZodRawShape pattern as read tools"
    - "snake_case input schema keys, camelCase body mapping for WEEEK API"
    - "Empty-body guard: return toMcpError'd Error before HTTP call if no editable fields"
    - "Shared unwrapTask + strip-comments shaping pattern for task responses"
    - "jsonContent imported from ../read/_helpers.js (no duplication, no _shared.ts yet)"
    - "URL-encode task IDs with encodeURIComponent in path segments"

key-files:
  created:
    - src/tools/write/create-task.ts
    - src/tools/write/update-task.ts
  modified:
    - src/tools/write/index.ts

key-decisions:
  - "PUT for weeek_update_task — if WEEEK responds 405, Plan 03-02 gap closure will switch to PATCH"
  - "RawTask interface removed from create-task.ts — ESLint no-unused-vars flagged it; unwrapTask is sufficient without a named interface"
  - "jsonContent imported from ../read/_helpers.js per CONTEXT decision — no _shared.ts created yet"
  - "Empty body guard in update-task returns toMcpError (not a throw) — consistent with handler contract"

requirements-completed: [TASK-04, TASK-05]

# Metrics
duration: 12min
completed: 2026-04-09
---

# Phase 3 Plan 01: Task Write Tools Summary

**weeek_create_task (POST /tm/tasks) and weeek_update_task (PUT /tm/tasks/{id}) registered as WEEEK MCP write tools with ZodRawShape schemas, snake-to-camelCase body mapping, and toMcpError error handling**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-09T13:58:59Z
- **Completed:** 2026-04-09T14:01:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `weeek_create_task` (TASK-04): POST /tm/tasks, required title + project_id, 6 optional fields, returns shaped task identical to weeek_get_task
- `weeek_update_task` (TASK-05): PUT /tm/tasks/{id}, only provided fields sent, empty-body guard, returns shaped task
- `registerWriteTools` updated from Phase 1 stub: now wires both tools, parameters renamed from `_server/_client` to `server/client`
- Smoke test passed: 0 stdout bytes, both tool registration lines on stderr, "2 write tools registered" confirmation

## Task Commits

1. **Task 1: Create weeek_create_task tool (TASK-04)** - `e78cec7` (feat)
2. **Task 2: Create weeek_update_task tool (TASK-05)** - `fecfc81` (feat)
3. **Task 3: Wire create-task + update-task into registerWriteTools** - `f6bc278` (feat)

## Files Created/Modified

- `src/tools/write/create-task.ts` — weeek_create_task: POST /tm/tasks, ZodRawShape inputSchema, snake→camel body mapping, unwrapTask + strip-comments shaper
- `src/tools/write/update-task.ts` — weeek_update_task: PUT /tm/tasks/{id}, empty-body guard, same shaping pattern
- `src/tools/write/index.ts` — registerWriteTools: replaces Phase 1 stub, calls registerCreateTask + registerUpdateTask

## Decisions Made

- **PUT vs PATCH for update:** Used `client.put` per plan spec. If WEEEK API returns 405 on live testing, Plan 03-02 gap closure will switch to `client.patch` — this is documented in CONTEXT.md.
- **RawTask interface removed:** The plan's verbatim code included a `RawTask` interface in create-task.ts but it was never used (only `unwrapTask` uses inline object checks). ESLint `no-unused-vars` caught it. Removed as Rule 1 auto-fix.
- **No _shared.ts created:** `jsonContent` imported directly from `../read/_helpers.js` as per CONTEXT decision.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused RawTask interface from create-task.ts**
- **Found during:** Task 1 verification (npm run lint)
- **Issue:** Plan's verbatim code block included a `RawTask` interface that was defined but never referenced — ESLint `@typescript-eslint/no-unused-vars` flagged it as an error
- **Fix:** Removed the 14-line `RawTask` interface block. The `unwrapTask` function uses inline `Record<string, unknown>` casts, not the named interface.
- **Files modified:** `src/tools/write/create-task.ts`
- **Verification:** `npm run lint` passed cleanly after removal
- **Committed in:** `e78cec7` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 unused type definition)
**Impact on plan:** Minor lint compliance fix. No behavior change — the interface was documentation-only, all logic relies on inline type assertions.

## Issues Encountered

- macOS has no `timeout` command (it's a GNU coreutils utility). Used background process + `sleep 1` + `kill` for smoke test instead. No impact on verification outcome.

## Smoke Test Output

```
[weeek-mcp] info Registered tool: weeek_create_task
[weeek-mcp] info Registered tool: weeek_update_task
[weeek-mcp] info registerWriteTools: 2 write tools registered (Phase 3 Plan 01)
```

stdout: empty (0 bytes). All other registration lines (7 read tools) also visible, confirming no regression.

## Exports Available for Plan 03-02

Plan 03-02 (move_task, complete_task, create_task_comment) can mirror the exact pattern from this plan:

```typescript
// Same imports
import { jsonContent } from "../read/_helpers.js";
import { toMcpError } from "../../errors.js";

// Same unwrapTask inline pattern
function unwrapTask(raw: unknown): unknown { ... }

// Same registration
server.registerTool("weeek_xxx", { description, inputSchema }, async (args) => {
  try { ... return jsonContent(task); }
  catch (err) { return toMcpError(err); }
});
```

Wire new register functions into `registerWriteTools` in `src/tools/write/index.ts` and update the tool count in the logger.info message.

## Known Stubs / Unverified Items

- **PUT vs PATCH for weeek_update_task:** Implementation uses `client.put`. WEEEK API documentation suggests PUT for updates, but live testing is needed. If the endpoint responds with 405 Method Not Allowed, switch to `client.patch` — no logic changes required, only the method name.
- **API response shapes:** The `unwrapTask` + strip-comments shaper is defensive but untested against real WEEEK API responses. Shape mismatches (e.g., task not wrapped in `{ task: ... }`) will gracefully fall through to returning the raw response.

## User Setup Required

None - no external service configuration required beyond the existing `WEEEK_API_TOKEN` environment variable.

## Next Phase Readiness

- Plan 03-02 (move_task, complete_task, create_task_comment) can start immediately
- Pattern fully established — no architectural decisions pending
- `registerWriteTools` in index.ts is ready to receive 3 more `register*` calls

---
*Phase: 03-write-tools*
*Completed: 2026-04-09*
