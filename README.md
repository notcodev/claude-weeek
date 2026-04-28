# claude-weeek

[Claude Code](https://claude.com/claude-code) plugin for the [WEEEK](https://weeek.net) task tracker. Gives Claude direct read/write access to WEEEK projects, boards, tasks, and comments — no context switching.

## Features

- **12 tools** — 7 read (projects, boards, columns, tasks, comments) + 5 write (create/update/move/complete tasks, post comments)
- **Read/write split** — tools are grouped so reads can be auto-approved while writes stay gated
- **Token auth** — single `WEEEK_API_TOKEN` env var, never logged
- **Safe defaults** — list tools paginate (default 20, max 50) so responses stay under the 25k token MCP limit
- **Structured errors** — API failures return `isError: true` with a human-readable message, the server never crashes

## Getting a WEEEK API Token

1. Sign in to [WEEEK](https://weeek.net).
2. Open **Workspace settings → API**.
3. Generate a personal API token.
4. Treat it like a password — it grants full read/write access to your workspace. Rotate it if it leaks.

Export it before launching Claude Code so the plugin can read it from the environment:

```bash
export WEEEK_API_TOKEN="your-weeek-token-here"
```

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

## Tools

All tools are prefixed `weeek_`. Read tools are side-effect free and safe for auto-approve. Write tools mutate WEEEK state and should prompt for user confirmation.

### Read tools

| Tool | Purpose |
|------|---------|
| `weeek_list_projects` | List projects in the workspace. Use FIRST to discover project IDs. |
| `weeek_get_project` | Get a single project's full details by ID. |
| `weeek_list_boards` | List boards inside a project. |
| `weeek_list_board_columns` | List columns (statuses) inside a board. Required before moving tasks. |
| `weeek_list_tasks` | List tasks with filters (project, board, column, assignee, completion) and pagination. |
| `weeek_get_task` | Get full details of a single task by ID. |
| `weeek_list_task_comments` | List comments on a task. |

### Write tools

| Tool | Purpose |
|------|---------|
| `weeek_create_task` | Create a NEW task. Requires title + project_id. |
| `weeek_update_task` | Edit fields (title, description, priority, assignee, due date) of an existing task. |
| `weeek_move_task` | Move a task to a different board column (status change). |
| `weeek_complete_task` | Mark a task complete, or reopen a completed task. |
| `weeek_create_task_comment` | Post a comment on a task. |

## Safety

- **Read/write separation:** read tools and write tools are registered in separate groups. Configure your MCP client to auto-approve reads while gating writes.
- **No delete operations:** v1 intentionally does not expose delete endpoints — too destructive for an AI agent.
- **Pagination defaults:** list tools default to 20 results (max 50) to stay under the 25,000 token MCP response cap.
- **Token handling:** `WEEEK_API_TOKEN` is read from the `env` block only. It is never logged, echoed, or included in error messages.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `WEEEK_API_TOKEN environment variable is required` | Export the token in the shell that launched Claude Code: `export WEEEK_API_TOKEN=...`. |
| `Invalid WEEEK_API_TOKEN` | Token is wrong, revoked, or expired — regenerate in WEEEK workspace settings. |
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
