# Design: WEEEK Skills & Hooks for the Claude Code Plugin

**Date:** 2026-04-28
**Status:** Approved (awaiting user review of written spec)
**Owner:** Erik Codev

## 1. Problem & Goal

The `claude-weeek` Claude Code plugin currently exposes 11 MCP tools that wrap the WEEEK Public API (read/write task, project, board operations). The MCP layer is the engine — but a Claude Code plugin can do more than expose tools. With **skills** (markdown instructions for the agent) and **hooks** (event-driven shell scripts), the plugin can drive end-to-end workflows: pulling task context into a coding session, recognising commits as task progress, generating standups, and using task comments as a cross-session/cross-repo context bus.

The goal of this work is to add a focused set of skills and hooks that make the plugin useful for **any** company's task workflow — solo or team, any column structure, any branch/commit naming convention — without prescribing a specific process.

### Non-goals

- Time tracking. WEEEK API supports it, but it is not on the critical path for "AI agent reads/writes task context" and would expand scope.
- Auto-posting comments on every commit or session stop. Too noisy; pollutes task history; teams have different policies.
- Replacing the developer's git workflow. Hooks must never block tool calls or modify git state.
- Server/SSE transport, multi-tenant configuration, or any cross-process state. Everything is per-repo, per-session.

## 2. Architecture

### 2.1 Single source of truth — MCP tools

Skills and hooks **never** call the WEEEK API directly. They orchestrate: read git/local state, apply detection logic, then either inject context for the agent or instruct the agent (via skill markdown) to call the appropriate `weeek_*` MCP tool.

This buys three properties:

- **Universality.** Per-repo `.weeek.json` config controls behaviour without touching code. Companies with different processes use the same plugin.
- **Team safety.** No state changes in WEEEK happen without an explicit decision by the agent acting on a user request.
- **No duplication.** Hook scripts don't need an HTTP client, an auth token, or retry logic. Those live once, in the MCP server.

### 2.2 Repository layout

New files under `plugin/` (as shipped — see §"Implementation deltas" below for what was dropped vs the original design intent):

```
plugin/
├── .claude-plugin/
│   └── plugin.json              (existing — manifest only; per Claude Code
│                                 convention, hooks/skills/commands MUST NOT
│                                 live inside .claude-plugin/)
├── .mcp.json                    (existing)
├── config.schema.json           (NEW — JSON Schema for .weeek.json)
├── hooks/                       (NEW)
│   ├── hooks.json               (registration; auto-discovered by
│   │                             Claude Code at this path)
│   ├── detect-task-on-session.mjs
│   └── detect-task-on-commit.mjs
├── lib/                         (NEW — zero-dep helpers shared by hooks)
│   └── task-detector.mjs
└── skills/                      (NEW)
    ├── weeek-start/SKILL.md
    ├── weeek-today/SKILL.md
    ├── weeek-standup/SKILL.md
    ├── weeek-advance/SKILL.md
    └── weeek-context/SKILL.md
```

Updated files:
- `package.json` — `"files"` includes `plugin`.
- `README.md` — Configuration / Skills / Hooks sections.
- `CLAUDE.md` — Plugin layer pointer.

#### Implementation deltas (post-Task-0)

Two pieces of the original design were dropped after the gate verification:

- A `weeek-log` skill that would record session progress as a task comment.
- Two MCP tools backing it: `weeek_list_comments` (read) and `weeek_add_comment` (write).

The WEEEK Public API v1 does not expose comment endpoints — only the internal workspace-scoped session-cookie API does. The mitigation listed under §"Risks & Mitigations" Risk #1 was applied: those three components are out of scope for this iteration. References to `weeek_list_comments` were also removed from `weeek-start` and `weeek-context` and from the SessionStart hook's injected context message.

### 2.3 Why hooks live as `.mjs` Node scripts

- Bundling Bash/POSIX scripts is fragile across macOS/Linux/Windows-WSL.
- Node 20 is already a hard requirement of the plugin (`"engines": { "node": ">=20.0.0" }`), so it's always available.
- Native `child_process`, `fs`, and `URL` cover everything hooks need; **zero npm dependencies** in the hook layer.

## 3. Data Flow

### 3.1 SessionStart flow

```
Claude Code starts session
    └─→ Hook: detect-task-on-session.mjs
        ├─ git rev-parse --is-inside-work-tree   (silent exit if no)
        ├─ git symbolic-ref --short HEAD          (current branch)
        ├─ loadConfig(cwd)                        (find .weeek.json or use defaults)
        ├─ detectTaskId(branch, patterns)
        └─ if matched:
            stdout JSON:
              { hookSpecificOutput: {
                  hookEventName: "SessionStart",
                  additionalContext:
                    "Repo branch '<branch>' references WEEEK task <id>.
                     If the user asks about this work, consider calling
                     weeek_get_task. Do not announce proactively unless
                     asked." } }
```

### 3.2 PostToolUse on `git commit` flow

```
Agent ran Bash with `git commit ...`
    └─→ Hook: detect-task-on-commit.mjs
        ├─ Parse stdin payload (tool_input.command, tool_response)
        ├─ Filter: command must contain `git commit`,
                   reject `--amend`, `--dry-run`, `--no-verify`-only retries
        ├─ Extract commit message from tool_response or `git log -1 --pretty=%B`
        ├─ detectTaskId(commitMsg, patterns)
        └─ if matched:
            stdout JSON:
              { hookSpecificOutput: {
                  hookEventName: "PostToolUse",
                  additionalContext:
                    "Commit <sha> references WEEEK task <id>.
                     Suggested follow-ups: (a) verify status via weeek_get_task,
                     (b) ask the user if they want to advance the task via
                     /weeek-advance. Do NOT move the task without confirmation." } }
```

### 3.3 Skill invocation flow (example: `/weeek-start 1234`)

```
User: /weeek-start 1234
Agent reads skill markdown → executes the steps:
    1. weeek_get_task({ id: 1234 })
    2. Read .weeek.json branchTemplate → suggest `git switch -c …`
    3. weeek_list_board_columns({ boardId })
       → match against statusHints.inProgress
    4. Confirm with user → weeek_move_task to in-progress column
```

## 4. Components

### 4.1 `lib/task-detector.mjs`

Zero-dependency Node ESM module. Public API:

```ts
loadConfig(cwd: string): Config | null
getPatterns(config: Config | null): RegExp[]
detectTaskId(text: string, patterns: RegExp[]): number | null
emitContext(eventName: string, message: string): void  // writes hook stdout JSON
```

**Config search:** start at `cwd`, look for `.weeek.json` (or `.weeek.jsonc`). Walk up the directory tree until a `.git` directory is found or `$HOME` is reached. On JSON parse error, log to `stderr` and return `null` (hook continues with defaults).

**Built-in patterns** (used when config is absent or `taskIdPatterns` is omitted):

```js
const DEFAULT_PATTERNS = [
  /\bWEEEK[-_/](\d+)\b/i,    // WEEEK-1234, weeek_1234
  /\bweeek[-_/](\d+)\b/i,    // weeek/1234
  /\btask[-_/](\d+)\b/i,     // task-1234
  /^(\d{2,})[-_/]/,          // 1234-some-slug   (≥2 digits, anchored)
  /#(\d+)\b/,                // #1234
];
```

The `\d{2,}` anchor in the bare-number pattern prevents false positives on strings like `v1-foo`.

**Override semantics:** if `config.taskIdPatterns` is set, it **replaces** the defaults (does not extend). This is a deliberate predictability choice: companies with strict ID formats can guarantee no surprise matches.

### 4.2 `.weeek.json` (per-repo, optional)

```json
{
  "$schema": "https://raw.githubusercontent.com/notcodev/claude-weeek/main/plugin/config.schema.json",
  "taskIdPatterns": ["WEEEK-(\\d+)"],
  "branchTemplate": "feature/WEEEK-{id}-{slug}",
  "defaultBoardId": 567,
  "defaultProjectId": 89,
  "statusHints": {
    "inProgress": ["In Progress", "Doing", "В работе"],
    "review":     ["Review", "Code Review"],
    "testing":    ["Testing", "QA"],
    "done":       ["Done", "Completed", "Готово"]
  }
}
```

All fields optional. Behaviour with missing fields:

| Missing field        | Fallback                                                                 |
|----------------------|--------------------------------------------------------------------------|
| File absent          | Built-in patterns; no template; no status hints; agent asks the user.    |
| `taskIdPatterns`     | Built-in patterns (above).                                               |
| `branchTemplate`     | Skill suggests a generic `task-{id}` slug.                               |
| `defaultBoardId`     | Skill resolves board via `weeek_list_boards` and asks user to pick.      |
| `statusHints.*`      | Agent shows full column list ordered by board and asks user to choose.   |

### 4.3 `plugin/config.schema.json`

JSON Schema draft-07 describing every field of `.weeek.json`. Lives in the repo, served via `https://raw.githubusercontent.com/notcodev/claude-weeek/main/plugin/config.schema.json`. IDEs (VS Code / JetBrains / Cursor) auto-discover the URL via the `$schema` key and provide validation + autocomplete.

Draft-07 chosen for the broadest IDE support without quirks. The schema only needs to grow additively — fields are added, never removed — so a `main`-tracking URL is safe.

### 4.4 Hook scripts

#### `hooks/detect-task-on-session.mjs`

- Triggered: `SessionStart` event with matcher `startup|resume`.
- Inputs: none from stdin (SessionStart hooks receive minimal payload).
- Outputs: hook protocol JSON on stdout, or empty stdout + exit 0.
- Hard timeout: each `git` invocation capped at 1 second.
- Failure mode: any thrown error → log to stderr, exit 0 with no stdout.

#### `hooks/detect-task-on-commit.mjs`

- Triggered: `PostToolUse` event with matcher `Bash`.
- Inputs: hook payload JSON on stdin (`{ tool_name, tool_input, tool_response }`).
- Filter logic:
  - `tool_input.command` must include the literal substring `git commit`.
  - Reject if it includes `--dry-run` or is purely `git commit --amend --no-edit` (no new message to inspect — but allow `--amend` if a new message is present, since the hook still wants to react to the new content).
- Outputs: hook protocol JSON on stdout, or empty stdout + exit 0.
- Failure mode: same as SessionStart — log to stderr, exit 0, never block.

### 4.5 `plugin/hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/detect-task-on-session.mjs" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/detect-task-on-commit.mjs" }
        ]
      }
    ]
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is resolved by the Claude Code plugin runtime to the absolute path of `plugin/`, so the same script works regardless of where the user installed the plugin.

## 5. Skills

Each skill is a markdown file with YAML frontmatter (`name`, `description`) plus an instruction body for the agent.

### 5.1 `weeek-start` — start work on a task

- **Trigger:** `/weeek-start <task-id>` or natural language ("start task 1234", "начни задачу WEEEK-1234").
- **Steps:**
  1. `weeek_get_task({ id })` — show title, description, current status, priority, assignee.
  2. `weeek_list_comments({ taskId })` — pull cross-session/cross-repo context (e.g., "[backend] added POST /api/tasks").
  3. Compare current branch with `branchTemplate`. If mismatch, suggest `git switch -c <rendered template>`.
  4. `weeek_list_board_columns({ boardId })` → match against `statusHints.inProgress`. If 1 match, ask "move to In Progress?". If 0 or >1, present full ordered column list and ask user to pick.
  5. On confirm → `weeek_move_task` to chosen column.
- **Constraint:** never call any write tool without explicit user confirmation.

### 5.2 `weeek-today` — what's on my plate

- **Trigger:** `/weeek-today`, "my tasks today", "что в работе".
- **Steps:**
  1. `weeek_list_workspace_members` → match the current user via `git config user.email`.
  2. `weeek_list_projects` → for each active project, `weeek_list_tasks({ assigneeId: me, dueDate ≤ today })`.
  3. Render compact grouped list: by project → by column → `<id> <title> (due …)`.

### 5.3 `weeek-standup` — daily summary

- **Trigger:** `/weeek-standup`, "сделай standup", "что я делал вчера".
- **Steps:**
  1. `git log --author=<me> --since="yesterday"` to collect commits.
  2. Apply detector patterns inline (agent-side; the regex list is documented in the skill body so the skill works even if `lib/` isn't reachable from a non-hook context).
  3. For each unique task-id: `weeek_get_task` → categorise as Done (status in `statusHints.done`) or In Progress.
  4. Render markdown: **Yesterday** / **Today** / **Blockers**.

### 5.4 `weeek-advance` — move task to next stage

- **Trigger:** `/weeek-advance`, "продвинь задачу", "переведи в Review".
- **Steps:**
  1. Determine task-id from current branch (detector). Else ask user.
  2. `weeek_get_task` to confirm current column.
  3. `weeek_list_board_columns({ boardId })` → list ordered.
  4. Build a menu of next options:
     - "Next column" (the column immediately after current by board order).
     - Named candidates: `Review`, `Testing`, `Done` — only those whose columns can be matched via `statusHints`.
  5. On confirm → `weeek_move_task` (or `weeek_complete_task` if destination matches `statusHints.done`).
  6. Optionally prompt: "Add a handoff comment summarising what changed?" — if yes, branch into the same logic as `weeek-log`.
- **Constraint:** never skip stages without explicit confirmation. The skill is specifically designed to support multi-stage workflows (`In Progress → Review → Testing → Done`), not just two-stage flows.

### 5.5 `weeek-context` — read-only task info

- **Trigger:** `/weeek-context <task-id>`, plain mention of `WEEEK-<id>` in user prompt without a verb.
- **Steps:** `weeek_get_task` + `weeek_list_comments` + (if `boardId`) `weeek_list_board_columns` to translate column ID to column name.
- **Constraint:** read-only. No write calls allowed from this skill.

### 5.6 `weeek-log` — record progress in a task comment

- **Trigger:** `/weeek-log [free-text]`, "зафиксируй прогресс", "оставь комментарий по задаче".
- **Steps:**
  1. Determine task-id (detector → branch). Else ask.
  2. Build a draft comment:
     - Auto-prefix from changed file paths: `[backend]`, `[frontend]`, `[infra]`, `[tests]`, `[docs]`. Multiple if applicable.
     - Body assembled from `git diff --stat`, recent `git log` for the session, and any free-text the user passed.
  3. Show draft → user edits or confirms → `weeek_add_comment({ taskId, body })`.
- **Why this matters for cross-repo workflows:** when the same task is being worked in a backend repo and a frontend repo, this comment becomes the shared context. The next session in the other repo pulls it via `weeek_list_comments` (called by `weeek-start` / `weeek-context` / SessionStart-injected suggestion).

## 6. New MCP Tools

To support `weeek-log` and the comment-pulling behaviour of other skills, two new tools are added to the MCP server:

### 6.1 `weeek_list_comments`

- **Input:** `{ taskId: number }`
- **Output:** array of `{ id, author, body, createdAt }` ordered chronologically (oldest first).
- **WEEEK API endpoint:** to be verified during implementation. WEEEK Public API v1 is expected to expose `GET /tm/tasks/{taskId}/comments` or similar; verification is part of the implementation plan, not the design.

### 6.2 `weeek_add_comment`

- **Input:** `{ taskId: number, body: string }` where `body` is markdown or plain text. Length cap to be set after API verification (likely 10k chars).
- **Output:** `{ id, createdAt }` of the new comment.
- **WEEEK API endpoint:** `POST /tm/tasks/{taskId}/comments` (to be verified).

Both tools follow the existing patterns in `src/tools/read/` and `src/tools/write/`, including:
- Zod input validation matching the SDK-compatible v3 dialect.
- The shared error shape from `src/errors.ts`.
- Logging via the project `logger` (never `console.log`).

## 7. Testing Strategy

### 7.1 Unit tests

| File | What it covers |
|------|----------------|
| `tests/lib/task-detector.test.ts` | Each built-in pattern with positive and negative inputs (e.g., `release-2024.10` must NOT match). `loadConfig` returns `null` when no file / broken JSON. Override patterns replace, not extend. |
| `tests/hooks/detect-task-on-session.test.ts` | Spawn the script as a child process. Verify silent exit when not in a git repo. Verify stdout JSON shape when a task ID matches. |
| `tests/hooks/detect-task-on-commit.test.ts` | Pipe synthetic hook payloads via stdin. Verify filter rejects non-`git commit` Bash calls. Verify silent exit on broken config. |
| `tests/tools/list-comments.test.ts` | Mock WEEEK API client; assert correct endpoint + parsing. |
| `tests/tools/add-comment.test.ts` | Mock WEEEK API client; assert request shape; assert error pass-through. |

### 7.2 Manual / smoke

- Skills are markdown for the agent — testing them = testing agent behaviour. Validated manually with `claude` CLI in a repo whose branch matches a real WEEEK task ID, plus `@modelcontextprotocol/inspector` for MCP-tool isolation.
- New comment tools get one smoke run against the real WEEEK API before release, gated by `WEEEK_API_TOKEN` in the dev environment.

### 7.3 What is NOT tested

- Real network calls to the WEEEK API in CI — no shared smoke token, results would be flaky. Manual smoke only.
- End-to-end skill execution with a real Claude model — out of scope for unit tests.
- Compatibility with WEEEK API endpoint *paths* (e.g., `/tm/tasks/{id}/comments` vs an alternative shape) — verified once during implementation, not on every run.

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WEEEK API doesn't expose comments in the expected shape. | Verify endpoint before writing the skill. If the API is missing it, drop `weeek-log` from this iteration and document the gap. |
| Hook script crashes on Windows-WSL or unusual git setups. | All git invocations have a 1-second timeout; any thrown error is caught and the hook exits 0. The plugin's `engines` already requires Node 20, which behaves consistently across platforms. |
| User has multiple boards per project, each with different column conventions. | Skills always resolve `boardId` (from `defaultBoardId`, the task itself, or asking the user) before fetching columns. `statusHints` are global per-repo; if a repo spans multiple incompatible boards, the user simply omits `statusHints` and the agent asks each time. |
| `${CLAUDE_PLUGIN_ROOT}` is not expanded on a non-Claude-Code host (e.g., another MCP client running the plugin). | Hooks are a Claude Code feature; non-Claude hosts won't read `hooks.json` at all. The MCP tools continue to work regardless. |
| `.weeek.json` config drift across team members causes inconsistent agent behaviour. | The config is committed to the repo, so it's shared. Schema URL provides IDE validation. Override semantics for `taskIdPatterns` (replace, not extend) make behaviour predictable. |

## 9. Out of Scope (Explicit)

- A `/weeek-init` skill that auto-generates `.weeek.json` by scanning the repo. Possible follow-up; not blocking.
- Time tracking integration (read or write).
- A `Stop` hook that prompts to advance the task. Too noisy in long sessions.
- A `UserPromptSubmit` hook that auto-resolves any `WEEEK-\d+` mention. Replaced by the explicit `weeek-context` skill.
- A `PreToolUse` confirmation guard on write MCP tools. That's the agent's / skill's job, not a global hook (and would break automated runs).
- Multi-language `statusHints` defaults beyond what users put in their config.

## 10. Deliverables Summary

In this work item:

1. `plugin/config.schema.json` — JSON Schema draft-07 for `.weeek.json`.
2. `plugin/hooks/hooks.json` — hook registration.
3. `plugin/lib/task-detector.mjs` — zero-dep helper.
4. `plugin/hooks/detect-task-on-session.mjs` — SessionStart hook.
5. `plugin/hooks/detect-task-on-commit.mjs` — PostToolUse hook.
6. `plugin/skills/weeek-start/SKILL.md`
7. `plugin/skills/weeek-today/SKILL.md`
8. `plugin/skills/weeek-standup/SKILL.md`
9. `plugin/skills/weeek-advance/SKILL.md`
10. `plugin/skills/weeek-context/SKILL.md`
11. `plugin/skills/weeek-log/SKILL.md`
12. `src/tools/read/list-comments.ts` + register in `src/tools/read/index.ts`.
13. `src/tools/write/add-comment.ts` + register in `src/tools/write/index.ts`.
14. `tests/lib/task-detector.test.ts`
15. `tests/hooks/detect-task-on-session.test.ts`
16. `tests/hooks/detect-task-on-commit.test.ts`
17. `tests/tools/list-comments.test.ts`
18. `tests/tools/add-comment.test.ts`
19. `package.json` — verify `"files"` includes `plugin/**`.
20. `README.md` — Configuration section with `.weeek.json` example.
21. `CLAUDE.md` — short note that the plugin now ships skills/hooks; pointers only.
