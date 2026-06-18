# WEEEK MCP — Multi-Workspace, Setup Wizard & Per-Workspace Base URL

**Date:** 2026-06-18
**Status:** Design approved, pending implementation plan
**Author:** brainstorming session

## Summary

Three related capabilities for the WEEEK MCP server:

1. **Setup wizard** — `npx claude-weeek setup` interactively collects workspace
   credentials, validates each token against the WEEEK API, writes a JSON config
   file (mode `0600`), and prints a ready-to-paste MCP server block.
2. **Multiple workspaces simultaneously** — the server can hold N workspace
   tokens at once. Every tool gains an optional `workspace` argument; omitting it
   uses the configured default. A new `weeek_list_workspaces` tool lets the agent
   discover available names.
3. **Per-workspace API base URL** — each workspace may set its own `baseUrl`
   (self-hosted / enterprise WEEEK instances), falling back to a global default.

WEEEK API tokens are workspace-scoped (one token = one workspace), so
"multiple workspaces" fundamentally means "multiple tokens" plus a selection
mechanism.

## Goals

- Configure and use several WEEEK workspaces from a single MCP server instance.
- First-run experience that does not require hand-editing JSON or constructing
  MCP config blocks by hand.
- Support self-hosted / non-default API endpoints, per workspace.
- **Zero new runtime dependencies** — built-in `node:readline/promises`, manual
  argv parsing, and `zod` (already a dependency) for config validation. Consistent
  with the project rule "native fetch, zero deps".
- **Full backward compatibility** — existing single-token `WEEEK_API_TOKEN`
  setups keep working unchanged, with no config file present.

## Non-Goals

- Patching arbitrary MCP client config files (`.mcp.json`, Claude Code settings).
  The wizard only writes claude-weeek's own config and prints a block to paste.
- Secret encryption / keychain integration. Tokens are stored in plaintext with
  `0600` permissions, the same model as `~/.aws/credentials`.
- Workspace discovery from a single token (WEEEK tokens do not enumerate other
  workspaces). The user supplies one token per workspace.
- Per-request token injection inside `WeeekApiClient` (rejected approach C).

## Architecture

### Chosen approach: `WorkspaceRegistry`

`WeeekApiClient` stays **single-workspace** — its responsibility (auth, timeout,
base URL, error handling for one token) does not change. It is simply
instantiated once per configured workspace.

A new `WorkspaceRegistry` holds the pre-built clients keyed by workspace name and
resolves a client per tool call:

```ts
class WorkspaceRegistry {
  constructor(clients: Map<string, WeeekApiClient>, defaultName: string, meta: Map<string, { baseUrl: string }>)
  resolve(name?: string): WeeekApiClient   // name omitted → default; unknown → WorkspaceNotFoundError
  list(): Array<{ name: string, baseUrl: string, isDefault: boolean }>  // never exposes tokens
  has(name: string): boolean
}
```

Tool registration signatures change from `(server, client)` to
`(server, registry)`. Each handler resolves its client inside the existing
`try/catch`, so an unknown workspace becomes a structured `toMcpError` response
(never a thrown error — preserves the INFRA-05 contract).

Rejected alternatives:

- **Client factory `(workspace?) => client`** — no first-class `list()`/`has()`;
  the `weeek_list_workspaces` tool would need workspace metadata threaded
  separately. Marginally worse ergonomics.
- **Multi-tenant single client** — `WeeekApiClient` would store all credentials
  and pick per request. Breaks the client's single responsibility and
  complicates its unit tests.

## Components

### 1. Config file format

```jsonc
{
  "defaultWorkspace": "main",
  "baseUrl": "https://api.weeek.net/public/v1",   // optional global default
  "workspaces": {
    "main":     { "token": "ws_...", "baseUrl": "https://self-hosted.example/public/v1" },
    "client-x": { "token": "ws_..." }              // baseUrl inherits the global default
  }
}
```

- Validated with a `zod` schema on load. Clear, actionable errors on failure.
- `workspaces` is an object keyed by workspace name (deduplicates names for free).
- Per-workspace `baseUrl` is optional; when absent it inherits the top-level
  `baseUrl`, which itself falls back to `DEFAULT_BASE_URL`.
- `defaultWorkspace` is required and must name an existing entry in `workspaces`
  (validation error otherwise). When the env-fallback path is used (single
  workspace), `defaultWorkspace` is implicitly `"default"`.

### 2. Config resolution (precedence)

Resolved once at startup, in `src/config.ts`:

1. If `WEEEK_CONFIG_PATH` is set → load that file (error if missing/invalid).
2. Else if the default path exists → load it:
   - `$XDG_CONFIG_HOME/claude-weeek/config.json` (default `~/.config/claude-weeek/config.json`)
   - Windows: `%APPDATA%\claude-weeek\config.json`
3. Else env-fallback: `WEEEK_API_TOKEN` (+ optional `WEEEK_API_BASE_URL`) →
   synthesize a single workspace named `default`. **Backward compatible.**
4. Else → `MissingConfigError` whose message points at both
   `npx claude-weeek setup` and the env-var route.

File beats env: when a config file is loaded, `WEEEK_API_TOKEN` is ignored for
workspace credentials. `WEEEK_API_BASE_URL` may still supply the global default
`baseUrl` if the file omits a top-level `baseUrl`.

### 3. Tool changes

- New shared helper `src/tools/workspace-param.ts`:
  - `workspaceParamSchema` — an optional `workspace` zod field with a
    `.describe(...)` instructing the agent to obtain names from
    `weeek_list_workspaces`.
  - `resolveClient(registry, workspaceArg)` — wraps `registry.resolve` so all
    11 tools resolve identically.
- All 11 existing tools (read: `list_projects`, `get_project`, `list_boards`,
  `list_board_columns`, `list_tasks`, `get_task`, `list_workspace_members`;
  write: `create_task`, `update_task`, `move_task`, `complete_task`) gain the
  optional `workspace` param and resolve their client inside `try`.
- New read tool `weeek_list_workspaces` → returns
  `[{ name, baseUrl, isDefault }]`. **Never returns tokens.**
- `src/tools/read/index.ts` and `src/tools/write/index.ts` change to accept and
  pass the `WorkspaceRegistry` instead of a single client.

### 4. Error handling

- New `WorkspaceNotFoundError` in `src/errors.ts`, carrying the requested name
  and the list of available names.
- `toMcpError` maps it to a human-readable message listing valid workspace
  names so the agent can self-correct (e.g. retry with a known name).

### 5. Setup wizard (`npx claude-weeek setup`)

- `src/index.ts` branches on `process.argv`: a `setup` subcommand runs the
  wizard; otherwise it starts the MCP server exactly as today.
  - In setup mode, writing to **stdout is allowed** — it is an interactive TTY
    CLI, not the JSON-RPC channel. The server-mode stdout restriction is
    unaffected.
- `src/setup/` modules:
  - Interactive loop via `node:readline/promises`: workspace name → token →
    optional base URL → repeat; then choose the default workspace.
  - **Token validation:** probe `GET /ws` (display the workspace name on
    success); fall back to `GET /tm/projects?limit=1` if `/ws` is unavailable.
    `401`/`403` → invalid token, re-prompt. The exact validation endpoint is
    confirmed by a Task 0 API probe before the wizard is wired (mirrors the
    earlier comments-API gate).
  - Writes `config.json` with `mkdir -p` on the directory and file mode `0600`.
  - Prints the config path and a ready-to-paste MCP server block.
  - Re-run behavior: loads the existing file, shows current workspaces, and lets
    the user add/overwrite entries and change the default.
- Pure, unit-testable pieces are extracted from the interactive loop: config
  (de)serialization, MCP-block generation, and the token validator (testable
  with a mocked `fetch`).

### MCP block printed by the wizard

```jsonc
{
  "mcpServers": {
    "weeek": {
      "command": "npx",
      "args": ["-y", "claude-weeek"]
    }
  }
}
```

No `env` token is required because credentials now live in the config file. If
the user chose a non-default config location, the block includes
`"env": { "WEEEK_CONFIG_PATH": "<path>" }`.

## Data Flow

```
startup (server mode)
  loadConfig()  ──> resolves file | env | error
       │
       ▼
  build WorkspaceRegistry { name → WeeekApiClient }
       │
       ▼
  registerReadTools(server, registry)
  registerWriteTools(server, registry)
       │
tool call (e.g. weeek_list_tasks { workspace?: "client-x", ... })
       │
       ▼
  client = registry.resolve(args.workspace)   // default if omitted
       │
       ▼
  client.get('/tm/tasks', {...})  ──> WEEEK API (per-workspace baseUrl)
```

```
startup (setup mode: argv[2] === "setup")
  readline loop → collect workspaces → validate tokens via fetch
       │
       ▼
  write config.json (0600) → print path + MCP block
```

## File-Level Changes

**New:**
- `src/workspace-registry.ts`
- `src/tools/workspace-param.ts`
- `src/tools/read/list-workspaces.ts`
- `src/setup/` (wizard loop, config writer, token validator, mcp-block generator)

**Modified:**
- `src/config.ts` — file loading, zod schema, path resolution, env-fallback,
  multi-workspace shape.
- `src/index.ts` — argv branch (setup vs serve), registry construction.
- `src/errors.ts` — `WorkspaceNotFoundError` + `toMcpError` mapping.
- `src/tools/read/index.ts`, `src/tools/write/index.ts` — pass registry.
- All 11 tool files — `workspace` param + client resolution.
- `README.md`, `CLAUDE.md` — config/auth sections rewritten for multi-workspace
  and the setup wizard.

**Unchanged:**
- `src/client/weeek-api-client.ts` — remains single-workspace.

## Testing Strategy

- `tests/config.test.ts` (extend): file parsing, precedence (file > env),
  env-fallback path, per-workspace `baseUrl` inheritance, default resolution,
  and failure cases (malformed JSON, missing token, `defaultWorkspace` not in
  `workspaces`).
- `tests/workspace-registry.test.ts` (new): `resolve(name)`,
  `resolve(undefined)` → default, unknown name → `WorkspaceNotFoundError`,
  `list()` omits tokens.
- Tool tests (extend): `workspace` arg routes to the correct base URL (mock
  `fetch` per URL); unknown workspace → `isError` response.
- `tests/tools/list-workspaces.test.ts` (new).
- Setup tests (new): config (de)serialization round-trip, MCP-block generation,
  token validator with a mocked `fetch` (200 → valid, 401 → invalid). The
  interactive readline loop itself is kept thin; logic lives in tested pure
  functions.

## Backward Compatibility

- A user with only `WEEEK_API_TOKEN` set and no config file: the env-fallback
  synthesizes one workspace named `default`; the optional `workspace` param is
  simply unused. No behavior change, no breakage.
- `WEEEK_API_BASE_URL` continues to work as the global default base URL.

## Open Questions / Risks

- **Validation endpoint:** `/ws` vs `/tm/projects?limit=1` is settled by a Task 0
  API probe before wiring the wizard (defined fallback, not a blocker).
- **Windows config path:** uses `%APPDATA%`; verified on the implementation pass.
