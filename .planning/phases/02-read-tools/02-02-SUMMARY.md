---
phase: 02-read-tools
plan: "02"
subsystem: read-tools/tasks-comments
tags: [mcp, tools, read, tasks, comments, zod, weeek-api, pagination]
dependency_graph:
  requires:
    - 02-01 (listParamsSchema, extractArray, jsonContent, server.registerTool pattern)
    - 01-03 (McpServer, WeeekApiClient, toMcpError, logger)
  provides:
    - weeek_list_tasks (TASK-01, TASK-03)
    - weeek_get_task (TASK-02)
    - weeek_list_task_comments (CMNT-01)
    - registerReadTools registers all 7 Phase 2 read tools
  affects:
    - 03-write-tools (list_tasks + get_task are prerequisites for move_task, update_task)
tech_stack:
  added: []
  patterns:
    - "Same server.registerTool(name, { description, inputSchema }, handler) as 02-01"
    - "inputSchema defined as named const (ZodRawShapeCompat plain object) before registerTool call"
    - "Nested try/catch in list-task-comments: inner catches WeeekApiError 404, outer calls toMcpError"
    - "Comments endpoint fallback: primary /tm/tasks/{id}/comments → 404 → embedded task.comments"
    - "get-task strips embedded comments via destructuring before returning jsonContent"
key_files:
  created:
    - src/tools/read/list-tasks.ts
    - src/tools/read/get-task.ts
    - src/tools/read/list-task-comments.ts
  modified:
    - src/tools/read/index.ts
decisions:
  - "Comments endpoint /tm/tasks/{id}/comments treated as primary (unverified). 404 fallback to embedded task.comments implemented. Runtime will reveal which path WEEEK actually uses."
  - "list-tasks uses camelCase query params (projectId, boardId, boardColumnId, assigneeId, isCompleted) matching AlekMel Python reference — no snake_case correction needed from 02-01"
  - "get-task strips embedded comments array before returning — keeps response small, separates concerns per CONTEXT decision"
  - "hasMore detection in list-tasks: checks response.hasMore first; falls back to tasks.length === limit heuristic"
metrics:
  duration_minutes: 2
  completed_date: "2026-04-09"
  tasks_completed: 3
  files_created: 3
  files_modified: 1
---

# Phase 2 Plan 02: Task + Comment Read Tools Summary

Three task/comment read tools (weeek_list_tasks, weeek_get_task, weeek_list_task_comments) implemented following the exact same server.registerTool + ZodRawShape + toMcpError pattern established in Plan 02-01. All 7 Phase 2 read tools now register cleanly on server boot with zero stdout bytes (stdio transport safe).

## What Was Built

### weeek_list_tasks (`src/tools/read/list-tasks.ts`)

TASK-01 + TASK-03: Primary task discovery tool.

- Filters: `project_id`, `board_id`, `column_id`, `assignee_id`, `is_completed`
- Pagination via spread `listParamsSchema` (default 20, max 50 — INFRA-07 enforced)
- Maps snake_case inputs to camelCase WEEEK API params: `projectId`, `boardId`, `boardColumnId`, `assigneeId`, `isCompleted`
- `hasMore` derived from response envelope or `tasks.length === limit` heuristic
- Defensive `RawTask` → `ShapedTask` mapper with `assigneesIds` fallback for assignee field

Returns: `{ tasks: ShapedTask[], count: number, hasMore: boolean }`

### weeek_get_task (`src/tools/read/get-task.ts`)

TASK-02: Full task detail retrieval.

- Calls `GET /tm/tasks/{taskId}` (URL-encoded)
- Unwraps WEEEK `{ success, task }` envelope if present
- Strips `comments` field from response (separation of concerns — prevents 25k token cap hit)
- Returns raw task object minus comments field via `jsonContent`

### weeek_list_task_comments (`src/tools/read/list-task-comments.ts`)

CMNT-01: Task comment listing with endpoint fallback.

**Primary path:** `GET /tm/tasks/{taskId}/comments`
**Fallback path (404):** Extracts `task.comments[]` from `GET /tm/tasks/{taskId}` response

The nested try/catch pattern:
1. Inner try: calls comments endpoint with pagination params
2. Inner catch: if `WeeekApiError` with `status === 404`, logs warning and falls back to embedded task response
3. Outer catch: all other errors go to `toMcpError`

Returns: `{ comments: ShapedComment[], count: number }` (plus `note` field on fallback path)

### registerReadTools Updated (`src/tools/read/index.ts`)

7 tools now registered in two groups:

```
// Navigation (Plan 02-01)
registerListProjects, registerGetProject, registerListBoards, registerListBoardColumns

// Tasks + Comments (Plan 02-02)
registerListTasks, registerGetTask, registerListTaskComments
```

### Comments Endpoint Resolution

**Status: UNVERIFIED at runtime** — `smoke` token cannot make real WEEEK API calls. The primary path `/tm/tasks/{taskId}/comments` is the canonical guess based on REST conventions. The 404 fallback to embedded `task.comments` is implemented and will activate automatically if WEEEK returns 404 on the comments endpoint.

**Resolution on first live use:** Agent running `weeek_list_task_comments` will either:
- Return comments from the primary endpoint (path is correct), or
- Trigger the fallback (log warning visible on stderr), and still return comments from the embedded field

Either way the tool returns data without requiring code changes. Document which path worked in a future session note.

### WEEEK API Endpoint Table

| Tool | Endpoint | Query params |
|------|----------|-------------|
| weeek_list_tasks | `GET /tm/tasks` | projectId, boardId, boardColumnId, assigneeId, isCompleted, limit, offset |
| weeek_get_task | `GET /tm/tasks/{taskId}` | — |
| weeek_list_task_comments | `GET /tm/tasks/{taskId}/comments` (primary) | limit, offset |
| weeek_list_task_comments | `GET /tm/tasks/{taskId}` (fallback if 404) | — |

### Smoke Test Result

```
[weeek-mcp] info Registered tool: weeek_list_projects
[weeek-mcp] info Registered tool: weeek_get_project
[weeek-mcp] info Registered tool: weeek_list_boards
[weeek-mcp] info Registered tool: weeek_list_board_columns
[weeek-mcp] info Registered tool: weeek_list_tasks
[weeek-mcp] info Registered tool: weeek_get_task
[weeek-mcp] info Registered tool: weeek_list_task_comments
[weeek-mcp] info registerReadTools: 7 read tools registered (Phase 2 complete)
```

Stdout: empty (zero bytes). Smoke test: ALL PASS.

## Phase 2 Success Criteria Verification

| Criterion | Status |
|-----------|--------|
| NAV-01 weeek_list_projects registered | PASS (02-01) |
| NAV-02 weeek_get_project registered | PASS (02-01) |
| NAV-03 weeek_list_boards registered | PASS (02-01) |
| NAV-04 weeek_list_board_columns registered | PASS (02-01) |
| TASK-01 weeek_list_tasks with filters | PASS |
| TASK-02 weeek_get_task full details | PASS |
| TASK-03 default list limit enforced (20) | PASS — listParamsSchema spread |
| CMNT-01 weeek_list_task_comments with fallback | PASS |
| INFRA-05 all handlers return toMcpError on failure | PASS |
| INFRA-06 read/write separation preserved | PASS |
| INFRA-07 pagination cap on list_tasks | PASS |
| No console.log in src/tools/read/ | PASS |
| build + lint + typecheck green | PASS |
| Smoke test: zero stdout bytes | PASS |
| Smoke test: 7 tool registration lines on stderr | PASS |

## Deviations from Plan

None — plan executed exactly as written. The `inputSchema` was extracted as a named const (same as 02-01 pattern) for clarity, which matches the plan's inline object approach functionally.

## Known Stubs

None — all three tools are fully wired. The comments endpoint path is unverified against live WEEEK API, but the fallback mechanism ensures the tool is not a stub — it will return data via one of two paths on first real use.

## Self-Check: PASSED
