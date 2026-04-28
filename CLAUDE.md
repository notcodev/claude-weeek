## Project

**WEEEK MCP Server**

MCP (Model Context Protocol) сервер для интеграции AI-агентов с таск-трекером WEEEK. Позволяет кодинг-агентам (Claude Desktop, Cursor, и др.) читать задачи, обновлять статусы, оставлять комментарии и навигировать по проектам/доскам через WEEEK Public API. Распространяется как npm-пакет (`claude-weeek`), запускается через `npx`.

**Core Value:** Кодинг-агенты получают прямой доступ к контексту задач в WEEEK — без переключения контекста разработчиком.

### Constraints

- **Tech stack**: TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), npm package
- **API**: WEEEK Public API v1 — все возможности ограничены тем, что предоставляет API
- **Transport**: stdio (стандарт для npx MCP серверов)
- **Auth**: Bearer token через переменную окружения WEEEK_API_TOKEN

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

## Conventions

Conventions not yet established. Will populate as patterns emerge.

## Architecture

Architecture not yet mapped. Follow existing patterns in the codebase.
