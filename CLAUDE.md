## Project

**WEEEK MCP Server**

MCP (Model Context Protocol) сервер для интеграции AI-агентов с таск-трекером WEEEK. Позволяет кодинг-агентам (Claude Code и др.) читать задачи, обновлять статусы и навигировать по проектам/доскам через WEEEK Public API. Распространяется как npm-пакет (`claude-weeek`), запускается через `npx`. Также включает Claude Code plugin layer — skills и hooks под `plugin/`, см. секцию "Plugin layer" ниже.

**Core Value:** Кодинг-агенты получают прямой доступ к контексту задач в WEEEK — без переключения контекста разработчиком.

### Constraints

- **Tech stack**: TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), npm package
- **API**: WEEEK Public API v1 — все возможности ограничены тем, что предоставляет API
- **Transport**: stdio (стандарт для npx MCP серверов)
- **Auth**: Two routes — (1) JSON config file (`~/.config/claude-weeek/config.json`, written by `npx claude-weeek setup`) for multi-workspace setups; (2) `WEEEK_API_TOKEN` env var fallback for single-workspace / backward-compatible setups. See `docs/superpowers/specs/2026-06-18-multi-workspace-and-setup-design.md` for the full design.

## Technology Stack

### Core Technologies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP protocol — stdio transport, tool/resource registration | Official Anthropic SDK. v1.x is stable; v2 alpha is pre-release. |
| TypeScript | `^6.0.2` | Type safety, compilation | TS 6 removed `moduleResolution: classic`; NodeNext is the standard. |
| Node.js | `>=20.0.0` | Runtime | Native `fetch` is stable on v20 LTS. Required for `"type": "module"` + NodeNext. |
| `zod` | `^3.25.0` | Tool input schema validation | MCP SDK 1.29 accepts zod v3.25+. **Do not upgrade to zod v4** standalone — incompatible with SDK v1.x (issues #906, #925). |

### HTTP Client

Use the native `fetch` (Node 20+). Zero deps; WEEEK API is a simple Bearer-token REST API — no streaming, no complex retry logic. Axios's advantages (interceptors, auto-JSON) are trivially replicated with a thin wrapper.

### Build & Test Tooling

| Tool | Purpose |
|------|---------|
| `tsdown` | Production build (`src/index.ts` → bundled `dist/index.js`). Powered by rolldown; preserves shebang and chmod+x's the bin output automatically. |
| `tsc` | Typecheck only (`tsc --noEmit`). Not used for build. |
| `tsx` | Dev-time TypeScript execution (`tsx src/index.ts`). |
| `vitest` | Unit tests. Native ESM support; uses Vite under the hood. Use `InMemoryTransport` from the SDK for integration tests. |
| `@modelcontextprotocol/inspector` | Interactive MCP testing during development. Run via `npx @modelcontextprotocol/inspector`. |

### Lint & Format

- ESLint flat config via `@notcodev/eslint` (antfu-style preset).
- Prettier config re-exported from `@notcodev/prettier`.
- Project-specific override: `no-console` is `error` (allow only `error`/`warn`) — see "What NOT to Use" below.

## Package.json Notes for npx Distribution

- `"type": "module"` — ESM throughout.
- `"bin": { "claude-weeek": "./dist/index.js" }` — single entry, runs without a subcommand.
- Entry file `src/index.ts` must keep `#!/usr/bin/env node` as line 1 (tsdown propagates it).
- `"files": ["dist", ...]` — prevents source files and dev configs from being published.
- `"engines": { "node": ">=20.0.0" }` — protects against Node 18 fetch edge cases.

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `zod` v4 (standalone upgrade) | Incompatible with MCP SDK v1.x ("w._parse is not a function" — SDK issues #906, #925). | `zod@^3.25.0`. |
| `console.log()` | MCP communicates over stdout — `console.log` corrupts the JSON-RPC channel. | `console.error()` (stderr) or the project `logger`. |
| CommonJS (`require`, `module.exports`) | MCP SDK is ESM-only; mixing with CJS causes `ERR_REQUIRE_ESM`. | ESM throughout. |
| SSE/HTTP transport | Out of scope. Adds server infra + session management. | `StdioServerTransport`. |
| `ts-node` | Deprecated for ESM; quirks with NodeNext. | `tsx`. |

## Plugin layer

Beyond the MCP server, the plugin ships skills and hooks under `plugin/`:

- `plugin/skills/<name>/SKILL.md` — five skills (`weeek-start`, `weeek-today`, `weeek-standup`, `weeek-advance`, `weeek-context`).
- `plugin/hooks/*.mjs` — two passive hooks (SessionStart, PostToolUse on `git commit`) registered via `plugin/hooks/hooks.json` (Claude Code plugin convention). Hooks never call the WEEEK API; they only inject context for the agent.
- `plugin/lib/task-detector.mjs` — zero-dependency regex detector shared by both hooks. Built-in patterns handle `WEEEK-N`, `task-N`, `#N`, and bare `N-slug`. Per-repo overrides live in `.weeek.json` (validated by `plugin/config.schema.json`).

A planned `weeek-log` skill (recording progress as task comments) was dropped after the WEEEK Public API was found not to expose comment endpoints. See the spec for detail.

See `docs/superpowers/specs/2026-04-28-weeek-skills-and-hooks-design.md` for the full design.

## Conventions

Conventions not yet established. Will populate as patterns emerge.

## Architecture

Architecture not yet mapped. Follow existing patterns in the codebase.
