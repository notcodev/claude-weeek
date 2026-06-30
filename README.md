# claude-weeek

[Claude Code](https://claude.com/claude-code) plugin for the [WEEEK](https://weeek.net) task tracker. Gives Claude direct read/write access to WEEEK projects, boards, and tasks — no context switching.

## Features

- **12 MCP tools** — 8 read (projects, boards, columns, tasks, workspaces) + 4 write (create/update/move/complete tasks)
- **5 skills** — `/weeek-start`, `/weeek-today`, `/weeek-standup`, `/weeek-advance`, `/weeek-context`
- **2 passive hooks** — auto-detect a WEEEK task ID from the current branch (SessionStart) or commit message (PostToolUse), inject context for the agent without ever calling the API
- **Read/write split** — tools are grouped so reads can be auto-approved while writes stay gated
- **Multi-workspace** — configure multiple WEEEK workspaces (including self-hosted instances) via `npx claude-weeek setup`; each tool accepts an optional `workspace` argument
- **Safe defaults** — list tools paginate (default 20, max 50) so responses stay under the 25k token MCP limit
- **Structured errors** — API failures return `isError: true` with a human-readable message, the server never crashes

## Getting a WEEEK API Token

1. Sign in to [WEEEK](https://weeek.net).
2. Open **Workspace settings → API**.
3. Generate a personal API token.
4. Treat it like a password — it grants full read/write access to your workspace. Rotate it if it leaks.

## Installation

Install via the Claude Code plugin marketplace.

### 1. Add the marketplace

In Claude Code, run:

```
/plugin marketplace add notcodev/notcodev-marketplace
```

### 2. Install the plugin

```
/plugin install claude-weeek@notcodev-marketplace
```

Claude Code will register the MCP server automatically. Restart the session if the tools don't appear immediately.

### 3. Run the setup wizard

```bash
npx claude-weeek setup
```

The wizard:
- Prompts for a workspace name, API token, and base URL (default `https://api.weeek.net/public/v1`).
- Validates the token against the WEEEK API and shows the workspace title on success.
- Asks whether to add another workspace (repeat for self-hosted / enterprise instances).
- When you have more than one workspace, asks which is the default.
- Writes the config to `~/.config/claude-weeek/config.json` (mode `0600`; respects `$XDG_CONFIG_HOME`; Windows: `%APPDATA%\claude-weeek\config.json`). Override the path with the `WEEEK_CONFIG_PATH` env var.
- Prints a ready-to-paste MCP server block at the end.

## Tools

All tools are prefixed `weeek_`. Read tools are side-effect free and safe for auto-approve. Write tools mutate WEEEK state and should prompt for user confirmation.

### Read tools

| Tool | Purpose |
|------|---------|
| `weeek_list_workspaces` | List configured workspaces (name, base URL, default flag). Never returns tokens. Use to discover workspace names for the `workspace` argument. |
| `weeek_list_projects` | List projects in the workspace. Use FIRST to discover project IDs. |
| `weeek_get_project` | Get a single project's full details by ID. |
| `weeek_list_boards` | List boards inside a project. |
| `weeek_list_board_columns` | List columns (statuses) inside a board. Required before moving tasks. |
| `weeek_list_tasks` | List tasks with filters (project, board, column, assignee, completion) and pagination. |
| `weeek_get_task` | Get full details of a single task by ID. |

### Write tools

| Tool | Purpose |
|------|---------|
| `weeek_create_task` | Create a NEW task. Requires title + project_id. |
| `weeek_update_task` | Edit fields (title, description, priority, assignee, due date) of an existing task. |
| `weeek_move_task` | Move a task to a different board column (status change). |
| `weeek_complete_task` | Mark a task complete, or reopen a completed task. |

## Configuration

### MCP server config (multi-workspace)

The setup wizard (`npx claude-weeek setup`) writes a JSON config file at `~/.config/claude-weeek/config.json` (or `%APPDATA%\claude-weeek\config.json` on Windows). Override the path with the `WEEEK_CONFIG_PATH` env var.

```jsonc
{
  "defaultWorkspace": "main",
  "baseUrl": "https://api.weeek.net/public/v1",   // optional global default
  "workspaces": {
    "main":     { "token": "...", "baseUrl": "https://self-hosted.example/public/v1" },
    "client-x": { "token": "..." }                 // inherits the global baseUrl
  }
}
```

- **`defaultWorkspace`** — the workspace used when no `workspace` argument is passed to a tool.
- **`baseUrl`** (top-level) — global fallback base URL. Defaults to `https://api.weeek.net/public/v1`.
- **`baseUrl`** (per workspace) — overrides the global default. Use this for self-hosted or enterprise WEEEK instances.

Every tool accepts an optional **`workspace`** argument (the key name from `workspaces`). Omit it to use the default. Call `weeek_list_workspaces` to discover the available names.

#### Env var fallback (single workspace, backward compatible)

If no config file exists, the server falls back to the env vars `WEEEK_API_TOKEN` (required) and `WEEEK_API_BASE_URL` (optional), synthesising a workspace named `default`. Existing single-token setups continue to work unchanged.

Resolution precedence: `WEEEK_CONFIG_PATH` → default OS config path → `WEEEK_API_TOKEN` env fallback.

### Repo-level config (`.weeek.json`)

To customise skill and hook behaviour for your team's process, drop a `.weeek.json` at the root of your repo. All fields are optional.

```json
{
  "$schema": "https://raw.githubusercontent.com/notcodev/claude-weeek/main/plugin/config.schema.json",
  "taskIdPatterns": ["WEEEK-(\\d+)"],
  "branchTemplate": "feature/WEEEK-{id}-{slug}",
  "defaultBoardId": 567,
  "defaultProjectId": 89,
  "statusHints": {
    "inProgress": ["In Progress", "Doing"],
    "review":     ["Review", "Code Review"],
    "testing":    ["Testing", "QA"],
    "done":       ["Done", "Completed"]
  }
}
```

| Field | Purpose |
|-------|---------|
| `taskIdPatterns` | Regex list (capture group 1 = numeric ID) used by SessionStart and PostToolUse hooks to extract task IDs from branch names and commit messages. **Replaces** the built-in defaults — does not extend. |
| `branchTemplate` | Template used by `/weeek-start` to suggest branch names. Placeholders: `{id}`, `{slug}`. |
| `defaultBoardId` / `defaultProjectId` | Skills use these as defaults instead of asking. |
| `statusHints` | Maps workflow stages to column-name candidates. The `/weeek-advance` skill uses these to label the menu of next stages. Multi-stage workflows (In Progress → Review → Testing → Done) are first-class. |

The `$schema` URL provides autocomplete and validation in VS Code, JetBrains IDEs, and Cursor.

## Skills

The plugin ships five skills. All are namespaced under `claude-weeek` (e.g. `/claude-weeek:weeek-start`). Triggers below are examples — each skill's description in `SKILL.md` covers a wider set of natural-language phrases.

### `weeek-start` — start work on a task

**Triggers:** `/weeek-start 1234`, `/weeek-start WEEEK-1234`, "start task 1234", "начни задачу WEEEK-1234".

Loads the task and prepares the workspace for work on it:
1. Calls `weeek_get_task` and shows a short summary (title, status, assignee, due date, priority, first paragraphs of description).
2. If `.weeek.json` defines `branchTemplate` (e.g. `feature/WEEEK-{id}-{slug}`), suggests a `git switch -c <rendered>` command. Never switches branches without confirmation.
3. If the task has a board, calls `weeek_list_board_columns` and matches the current column against `statusHints.inProgress`. Asks before moving — single match → confirm, ambiguous → menu, no match → no move.

Never calls a write tool without explicit confirmation in the same turn.

### `weeek-today` — what's on my plate

**Triggers:** `/weeek-today`, "what's on my plate", "мои задачи на сегодня", "что в работе".

Read-only daily list. Resolves the current user via `git config user.email`, then for each active project calls `weeek_list_tasks` filtered to assigned-to-me. Groups output by project and column. Excludes anything matching `statusHints.done`. If the list is empty, says so plainly — no invented summaries.

### `weeek-standup` — daily summary

**Triggers:** `/weeek-standup`, "make my standup", "что я делал вчера".

Cross-references recent commits with WEEEK task state to produce a Yesterday / Today / Blockers markdown block:
1. Runs `git log --author="$(git config user.email)" --since="yesterday"`.
2. Extracts task IDs from each commit subject using the same regex set the hooks use (or `taskIdPatterns` from `.weeek.json`).
3. Categorises each unique task as Done (column matches `statusHints.done`) vs In Progress.
4. Renders the markdown. Blockers are echoed only if the user mentions them — never invented.

Read-only. Does not push the report anywhere.

### `weeek-advance` — move task to next workflow stage

**Triggers:** `/weeek-advance`, "переведи в Review", "продвинь задачу", "ready for QA".

Supports any column structure — never assumes a layout. Determines the task ID from the current branch (or asks), reads the board's column order via `weeek_list_board_columns`, and builds an advance menu showing:
- **Next column** (immediately after current by board order).
- **Named candidates** — `Review`, `Testing`, `Done` if their columns can be matched against `statusHints.review` / `statusHints.testing` / `statusHints.done`.

User picks; the skill never auto-selects. Calls `weeek_complete_task` if the destination matches `statusHints.done`, otherwise `weeek_move_task`. Multi-stage workflows (In Progress → Review → Testing → Done) are first-class — no jumping stages without explicit confirmation.

### `weeek-context` — read-only task summary

**Triggers:** `/weeek-context 1234`, "tell me about WEEEK-1234", "что это за задача".

Pure information lookup. Calls `weeek_get_task`, translates `boardColumnId` to a column name via `weeek_list_board_columns` if needed, and renders a compact markdown summary. Useful when the SessionStart hook didn't fire (e.g. you're on a non-task branch but want to look up a ticket). Never calls a write tool — if the user asks to act on the task, the agent routes them to `weeek-start` or `weeek-advance`.

## Hooks

The plugin ships two passive hooks that never block tool calls:

- **SessionStart** — if your branch references a WEEEK task, the agent gets a hint to consider `weeek_get_task`.
- **PostToolUse on `git commit`** — if a commit message references a WEEEK task, the agent gets a hint about `/weeek-advance`.

Both hooks are silent until they detect a task ID. Errors never surface.

## Safety

- **Read/write separation:** read tools and write tools are registered in separate groups. Configure your MCP client to auto-approve reads while gating writes.
- **No delete operations:** v1 intentionally does not expose delete endpoints — too destructive for an AI agent.
- **Pagination defaults:** list tools default to 20 results (max 50) to stay under the 25,000 token MCP response cap.
- **Token handling:** Tokens are read from the config file (mode `0600`) or the `WEEEK_API_TOKEN` env var. They are never logged, echoed, or included in error messages.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `WEEEK_API_TOKEN environment variable is required` | No config file found and `WEEEK_API_TOKEN` is not set. Either run `npx claude-weeek setup` to create the config, or export the token: `export WEEEK_API_TOKEN=...`. |
| `Invalid WEEEK_API_TOKEN` | Token is wrong, revoked, or expired — regenerate in WEEEK workspace settings. |
| `Workspace "x" not found` | The `workspace` argument doesn't match any key in your config. Call `weeek_list_workspaces` to see available names. |
| Server disconnects immediately after starting | You are on Node < 20. Upgrade Node (`nvm install 20`) and relaunch Claude Code from the upgraded shell. |
| Tool returns "Resource not found (404)" | The ID doesn't exist in the workspace — list the parent resource first (e.g., `weeek_list_projects` before `weeek_get_project`). |

## Development

```bash
git clone https://github.com/notcodev/claude-weeek.git
cd claude-weeek
pnpm install
pnpm build
pnpm test
```

Scripts:
- `pnpm build` — bundle to `dist/` via tsdown
- `pnpm dev` — run from source via `tsx`
- `pnpm lint` — ESLint (enforces no-console rule for stdio safety)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — vitest unit tests

### Keeping in sync with the WEEEK API

The MCP tools are checked against WEEEK's OpenAPI spec automatically.
Run `pnpm spec:check` to verify the tools match the committed snapshot
(`spec/weeek-openapi.json`); it prints any "accepted" known spec gaps and fails
only on new drift. Run `pnpm spec:fetch` to refresh the snapshot from the live
WEEEK API. See the "Spec-drift detector" section in `CLAUDE.md`.

To smoke-test the built binary:

```bash
pnpm build
WEEEK_API_TOKEN=test node dist/index.js
# server blocks on stdin — press Ctrl+C to exit
```

## Requirements

- Node.js >= 20.0.0
- A WEEEK account with API access

## License

MIT — see [LICENSE](./LICENSE).
