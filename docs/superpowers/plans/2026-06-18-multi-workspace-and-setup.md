# Multi-Workspace, Setup Wizard & Per-Workspace Base URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one WEEEK MCP server hold several workspace tokens at once, configured via an interactive `npx claude-weeek setup` wizard and a JSON config file, with a per-workspace API base URL.

**Architecture:** `WeeekApiClient` stays single-workspace and is instantiated once per configured workspace. A new `WorkspaceRegistry` keys those clients by name and resolves one per tool call (`args.workspace` → client, default when omitted). `loadConfig` resolves credentials from a JSON file (or an env-var fallback that synthesizes a single `default` workspace, preserving backward compatibility). A `setup` subcommand on the existing binary runs an interactive wizard that validates tokens against the API and writes the config file.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk` ^1.29, `zod` ^3.25, native `fetch`, `node:readline/promises`, `node:fs`, vitest, tsdown.

## Global Constraints

- `"type": "module"` ESM throughout; NodeNext resolution; import paths end in `.js`.
- Node `>=20.0.0`; native `fetch` only — **no new runtime dependencies**.
- `zod@^3.25` only — **never upgrade to zod v4** (breaks MCP SDK v1.x).
- **Never `console.log`** — stdout is the JSON-RPC channel in server mode. Use `logger` (stderr). Exception: in `setup` subcommand mode the process is an interactive CLI, not a transport, so writing to stdout is allowed there.
- Tool handlers **never throw** — every error is caught and returned via `toMcpError` (INFRA-05).
- `src/index.ts` line 1 must stay `#!/usr/bin/env node`.
- Code style (antfu/@notcodev preset): single quotes, no semicolons, 2-space indent, trailing commas. `no-console` is `error` (only `console.error`/`warn` allowed — but use `logger`).
- Tokens must never appear in logs, error messages, or `weeek_list_workspaces` output.
- Config file is written with mode `0600`.

---

## Task 0: Probe the token-validation endpoint

**Files:** none (spike; record the result in Task 8's `validate-token.ts` header comment).

- [ ] **Step 1: Probe `/ws` with a real token**

Run (substitute a real workspace token):

```bash
TOKEN='<real-weeek-token>'
curl -s -o /tmp/ws.json -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' \
  'https://api.weeek.net/public/v1/ws'
head -c 600 /tmp/ws.json; echo
```

Expected: a `2xx` status and a JSON body. Note which key holds the workspace name (e.g. `workspace.title`, `name`).

- [ ] **Step 2: Probe the fallback**

```bash
curl -s -o /tmp/p.json -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' \
  'https://api.weeek.net/public/v1/tm/projects?limit=1'
```

Expected: `200`. Confirm `401`/`403` is what an invalid token returns (re-run with a bogus token).

- [ ] **Step 3: Record findings**

Decide the primary validation endpoint (`/ws` if it returns a workspace name, else `/tm/projects?limit=1`) and the JSON path to the workspace name. This decision feeds `validateToken` in Task 8. No commit.

---

## Task 1: `WorkspaceNotFoundError` + `toMcpError` mapping

**Files:**
- Modify: `src/errors.ts`
- Test: `tests/errors.test.ts`

**Interfaces:**
- Produces: `class WorkspaceNotFoundError extends Error` with `readonly requested: string`, `readonly available: string[]`; `toMcpError` returns the existing `McpErrorResponse` shape for it.

- [ ] **Step 1: Write the failing test**

Append to `tests/errors.test.ts`:

```ts
import { toMcpError, WorkspaceNotFoundError } from '../src/errors.js'

describe('WorkspaceNotFoundError', () => {
  it('lists available workspaces and points at weeek_list_workspaces', () => {
    const res = toMcpError(
      new WorkspaceNotFoundError('client-x', ['main', 'staging']),
    )
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('client-x')
    expect(res.content[0]!.text).toContain('main, staging')
    expect(res.content[0]!.text).toContain('weeek_list_workspaces')
  })
})
```

(If `describe`/`expect`/`it` are not yet imported at the top of the file, add `import { describe, expect, it } from 'vitest'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/errors.test.ts`
Expected: FAIL — `WorkspaceNotFoundError` is not exported.

- [ ] **Step 3: Add the error class and mapping**

In `src/errors.ts`, after the `WeeekTimeoutError` class:

```ts
export class WorkspaceNotFoundError extends Error {
  constructor(
    public readonly requested: string,
    public readonly available: string[],
  ) {
    super(
      `Workspace "${requested}" is not configured. ` +
        `Available workspaces: ${available.join(', ')}. ` +
        'Use weeek_list_workspaces to see configured workspaces.',
    )
    this.name = 'WorkspaceNotFoundError'
  }
}
```

In `toMcpError`, add a branch before the generic `else if (err instanceof Error)`:

```ts
  } else if (err instanceof WorkspaceNotFoundError) {
    text = err.message
    logger.error('WorkspaceNotFoundError', {
      requested: err.requested,
      available: err.available,
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat: add WorkspaceNotFoundError and toMcpError mapping"
```

---

## Task 2: Multi-workspace config loader

**Files:**
- Modify: `src/config.ts` (rewrite the config shape + loader; keep the `DEFAULT_*` constants)
- Modify: `src/index.ts` (adapt to the new `WeeekConfig` shape — single default client, no registry yet)
- Test: `tests/config.test.ts` (rewrite)

**Interfaces:**
- Produces:
  - `interface WorkspaceConfig { token: string; baseUrl: string }`
  - `interface WeeekConfig { defaultWorkspace: string; workspaces: Record<string, WorkspaceConfig>; requestTimeoutMs: number }`
  - `interface ConfigSources { env?: NodeJS.ProcessEnv; fileExists?: (p: string) => boolean; readFile?: (p: string) => string; homeDir?: string; appData?: string; platform?: NodeJS.Platform }`
  - `function loadConfig(sources?: ConfigSources): WeeekConfig`
  - `function resolveConfigPath(sources?: ConfigSources): string`
  - `function parseConfig(json: string, globalBaseUrlEnv?: string): WeeekConfig`
  - `class MissingConfigError`, `class InvalidConfigError`
  - unchanged constants: `DEFAULT_LIST_LIMIT`, `MAX_LIST_LIMIT`, `DEFAULT_BASE_URL`, `DEFAULT_REQUEST_TIMEOUT_MS`

- [ ] **Step 1: Write the failing tests**

Replace the body of `tests/config.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BASE_URL,
  InvalidConfigError,
  loadConfig,
  MissingConfigError,
  parseConfig,
  resolveConfigPath,
} from '../src/config.js'

describe('parseConfig', () => {
  it('resolves per-workspace baseUrl, then global, then default', () => {
    const cfg = parseConfig(
      JSON.stringify({
        defaultWorkspace: 'main',
        baseUrl: 'https://global.example/v1',
        workspaces: {
          main: { token: 't1', baseUrl: 'https://main.example/v1' },
          other: { token: 't2' },
        },
      }),
    )
    expect(cfg.defaultWorkspace).toBe('main')
    expect(cfg.workspaces.main!.baseUrl).toBe('https://main.example/v1')
    expect(cfg.workspaces.other!.baseUrl).toBe('https://global.example/v1')
  })

  it('falls back to DEFAULT_BASE_URL when no baseUrl anywhere', () => {
    const cfg = parseConfig(
      JSON.stringify({
        defaultWorkspace: 'main',
        workspaces: { main: { token: 't1' } },
      }),
    )
    expect(cfg.workspaces.main!.baseUrl).toBe(DEFAULT_BASE_URL)
  })

  it('uses the env global base url when the file omits one', () => {
    const cfg = parseConfig(
      JSON.stringify({
        defaultWorkspace: 'main',
        workspaces: { main: { token: 't1' } },
      }),
      'https://env.example/v1',
    )
    expect(cfg.workspaces.main!.baseUrl).toBe('https://env.example/v1')
  })

  it('throws InvalidConfigError when defaultWorkspace is missing from workspaces', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          defaultWorkspace: 'nope',
          workspaces: { main: { token: 't1' } },
        }),
      ),
    ).toThrow(InvalidConfigError)
  })

  it('throws InvalidConfigError on malformed JSON', () => {
    expect(() => parseConfig('{not json')).toThrow(InvalidConfigError)
  })

  it('throws InvalidConfigError when a workspace has no token', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          defaultWorkspace: 'main',
          workspaces: { main: {} },
        }),
      ),
    ).toThrow(InvalidConfigError)
  })
})

describe('loadConfig — env fallback (no file)', () => {
  const noFile = { fileExists: () => false }

  it('synthesizes a single "default" workspace from WEEEK_API_TOKEN', () => {
    const cfg = loadConfig({ ...noFile, env: { WEEEK_API_TOKEN: 'tok_123' } })
    expect(cfg.defaultWorkspace).toBe('default')
    expect(cfg.workspaces.default!.token).toBe('tok_123')
    expect(cfg.workspaces.default!.baseUrl).toBe(DEFAULT_BASE_URL)
  })

  it('honors WEEEK_API_BASE_URL in the env-fallback path', () => {
    const cfg = loadConfig({
      ...noFile,
      env: {
        WEEEK_API_TOKEN: 'tok',
        WEEEK_API_BASE_URL: 'https://staging.example/v1',
      },
    })
    expect(cfg.workspaces.default!.baseUrl).toBe('https://staging.example/v1')
  })

  it('throws MissingConfigError when neither file nor token exist', () => {
    expect(() => loadConfig({ ...noFile, env: {} })).toThrow(MissingConfigError)
  })

  it('MissingConfigError mentions setup and never leaks the token', () => {
    try {
      loadConfig({ ...noFile, env: {} })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MissingConfigError)
      expect((err as Error).message).toContain('claude-weeek setup')
    }
  })
})

describe('loadConfig — file path', () => {
  it('loads and parses an existing config file', () => {
    const file = JSON.stringify({
      defaultWorkspace: 'a',
      workspaces: { a: { token: 't' }, b: { token: 'u' } },
    })
    const cfg = loadConfig({
      env: {},
      fileExists: () => true,
      readFile: () => file,
    })
    expect(Object.keys(cfg.workspaces).sort()).toEqual(['a', 'b'])
    expect(cfg.defaultWorkspace).toBe('a')
  })

  it('a present file beats the env token', () => {
    const file = JSON.stringify({
      defaultWorkspace: 'a',
      workspaces: { a: { token: 'from-file' } },
    })
    const cfg = loadConfig({
      env: { WEEEK_API_TOKEN: 'from-env' },
      fileExists: () => true,
      readFile: () => file,
    })
    expect(cfg.workspaces.a!.token).toBe('from-file')
    expect(cfg.workspaces.default).toBeUndefined()
  })
})

describe('resolveConfigPath', () => {
  it('prefers WEEEK_CONFIG_PATH', () => {
    expect(
      resolveConfigPath({ env: { WEEEK_CONFIG_PATH: '/custom/c.json' } }),
    ).toBe('/custom/c.json')
  })

  it('uses XDG_CONFIG_HOME on linux/mac', () => {
    expect(
      resolveConfigPath({
        env: { XDG_CONFIG_HOME: '/home/u/.config' },
        platform: 'linux',
      }),
    ).toBe('/home/u/.config/claude-weeek/config.json')
  })

  it('falls back to ~/.config when XDG is unset', () => {
    expect(
      resolveConfigPath({ env: {}, platform: 'linux', homeDir: '/home/u' }),
    ).toBe('/home/u/.config/claude-weeek/config.json')
  })

  it('uses APPDATA on win32', () => {
    expect(
      resolveConfigPath({
        env: {},
        platform: 'win32',
        appData: 'C:\\Users\\u\\AppData\\Roaming',
      }),
    ).toBe('C:\\Users\\u\\AppData\\Roaming\\claude-weeek\\config.json')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — `parseConfig`/`resolveConfigPath`/`InvalidConfigError` not exported; shape mismatch.

- [ ] **Step 3: Rewrite `src/config.ts`**

```ts
/**
 * Configuration loader for the WEEEK MCP server.
 *
 * Resolution precedence (loadConfig):
 *   1. WEEEK_CONFIG_PATH (must exist)            → JSON config file
 *   2. default OS config path, if it exists       → JSON config file
 *   3. WEEEK_API_TOKEN env var                     → synthesized single "default" workspace
 *   4. none of the above                           → MissingConfigError
 *
 * Never logs or includes a token value in error messages.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { z } from 'zod'

export const DEFAULT_LIST_LIMIT = 20
export const MAX_LIST_LIMIT = 50
export const DEFAULT_BASE_URL = 'https://api.weeek.net/public/v1'
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export interface WorkspaceConfig {
  baseUrl: string
  token: string
}

export interface WeeekConfig {
  defaultWorkspace: string
  requestTimeoutMs: number
  workspaces: Record<string, WorkspaceConfig>
}

export interface ConfigSources {
  appData?: string
  env?: NodeJS.ProcessEnv
  fileExists?: (p: string) => boolean
  homeDir?: string
  platform?: NodeJS.Platform
  readFile?: (p: string) => string
}

export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingConfigError'
  }
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidConfigError'
  }
}

const workspaceFileSchema = z.object({
  baseUrl: z.string().url().optional(),
  token: z.string().min(1),
})

const configFileSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    defaultWorkspace: z.string().min(1),
    workspaces: z.record(z.string().min(1), workspaceFileSchema),
  })
  .refine((c) => Object.keys(c.workspaces).length > 0, {
    message: 'workspaces must contain at least one entry',
  })
  .refine((c) => c.workspaces[c.defaultWorkspace] !== undefined, {
    message: 'defaultWorkspace must reference a key in workspaces',
  })

export type ConfigFile = z.infer<typeof configFileSchema>

/**
 * Validate + resolve a config JSON string into a WeeekConfig.
 * Per-workspace baseUrl resolves: workspace.baseUrl ?? file.baseUrl ?? globalBaseUrlEnv ?? DEFAULT_BASE_URL.
 */
export function parseConfig(
  json: string,
  globalBaseUrlEnv?: string,
): WeeekConfig {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new InvalidConfigError(
      `Config file is not valid JSON: ${(err as Error).message}`,
    )
  }

  const parsed = configFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new InvalidConfigError(
      `Config file is invalid: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    )
  }

  const file = parsed.data
  const globalDefault = file.baseUrl ?? globalBaseUrlEnv ?? DEFAULT_BASE_URL
  const workspaces: Record<string, WorkspaceConfig> = {}
  for (const [name, ws] of Object.entries(file.workspaces)) {
    workspaces[name] = {
      token: ws.token,
      baseUrl: ws.baseUrl ?? globalDefault,
    }
  }

  return {
    defaultWorkspace: file.defaultWorkspace,
    workspaces,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  }
}

export function resolveConfigPath(sources: ConfigSources = {}): string {
  const env = sources.env ?? process.env
  if (env.WEEEK_CONFIG_PATH && env.WEEEK_CONFIG_PATH.trim() !== '') {
    return env.WEEEK_CONFIG_PATH
  }
  const platform = sources.platform ?? process.platform
  if (platform === 'win32') {
    const appData = sources.appData ?? env.APPDATA ?? ''
    return path.join(appData, 'claude-weeek', 'config.json')
  }
  const xdg = env.XDG_CONFIG_HOME
  const base =
    xdg && xdg.trim() !== ''
      ? xdg
      : path.join(sources.homeDir ?? homedir(), '.config')
  return path.join(base, 'claude-weeek', 'config.json')
}

export function loadConfig(sources: ConfigSources = {}): WeeekConfig {
  const env = sources.env ?? process.env
  const fileExists = sources.fileExists ?? existsSync
  const readFile = sources.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const explicitPath = env.WEEEK_CONFIG_PATH?.trim()
  const configPath = resolveConfigPath(sources)

  // 1 + 2: a config file (explicit or default location)
  if (explicitPath) {
    if (!fileExists(configPath)) {
      throw new InvalidConfigError(
        `WEEEK_CONFIG_PATH points at "${configPath}" but no file exists there.`,
      )
    }
    return parseConfig(readFile(configPath), env.WEEEK_API_BASE_URL)
  }
  if (fileExists(configPath)) {
    return parseConfig(readFile(configPath), env.WEEEK_API_BASE_URL)
  }

  // 3: env-var fallback — single synthesized workspace
  const token = env.WEEEK_API_TOKEN
  if (token && token.trim() !== '') {
    return {
      defaultWorkspace: 'default',
      workspaces: {
        default: {
          token,
          baseUrl: env.WEEEK_API_BASE_URL ?? DEFAULT_BASE_URL,
        },
      },
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    }
  }

  // 4: nothing
  throw new MissingConfigError(
    'No WEEEK configuration found. Run `npx claude-weeek setup` to create ' +
      `a config file (looked at ${configPath}), or set WEEEK_API_TOKEN for a ` +
      'single workspace.',
  )
}
```

- [ ] **Step 4: Adapt `src/index.ts` to the new shape (single default client, no registry yet)**

Replace the client construction in `main()`:

```ts
  const config = loadConfig()
  const ws = config.workspaces[config.defaultWorkspace]!
  const client = new WeeekApiClient(ws.token, {
    baseUrl: ws.baseUrl,
    timeoutMs: config.requestTimeoutMs,
  })
```

Keep the `MissingConfigError` catch around `loadConfig()` (it also catches `InvalidConfigError` — widen the catch to log and exit for both):

```ts
  } catch (err) {
    if (
      err instanceof MissingConfigError ||
      err instanceof InvalidConfigError
    ) {
      logger.error(err.message)
      process.exit(1)
    }
    throw err
  }
```

Add `InvalidConfigError` to the import from `./config.js`. Leave the `registerReadTools(server, client)` / `registerWriteTools(server, client)` calls as-is.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run tests/config.test.ts && pnpm typecheck`
Expected: PASS / no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/index.ts tests/config.test.ts
git commit -m "feat: multi-workspace config loader with file + env fallback"
```

---

## Task 3: `WorkspaceRegistry` + `createRegistry`

**Files:**
- Create: `src/workspace-registry.ts`
- Test: `tests/workspace-registry.test.ts`

**Interfaces:**
- Consumes: `WeeekConfig` (Task 2), `WeeekApiClient` (existing), `WorkspaceNotFoundError` (Task 1).
- Produces:
  - `interface WorkspaceInfo { baseUrl: string; isDefault: boolean; name: string }`
  - `class WorkspaceRegistry` with `resolve(name?: string): WeeekApiClient`, `has(name: string): boolean`, `list(): WorkspaceInfo[]`
  - `function createRegistry(config: WeeekConfig): WorkspaceRegistry`

- [ ] **Step 1: Write the failing test**

Create `tests/workspace-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { WeeekApiClient } from '../src/client/weeek-api-client.js'
import { WorkspaceNotFoundError } from '../src/errors.js'
import { createRegistry, WorkspaceRegistry } from '../src/workspace-registry.js'

function clients() {
  return new Map([
    ['main', new WeeekApiClient('t1', { baseUrl: 'https://main.example/v1' })],
    ['alt', new WeeekApiClient('t2', { baseUrl: 'https://alt.example/v1' })],
  ])
}
function meta() {
  return new Map([
    ['main', { baseUrl: 'https://main.example/v1' }],
    ['alt', { baseUrl: 'https://alt.example/v1' }],
  ])
}

describe('WorkspaceRegistry', () => {
  it('resolve(undefined) returns the default workspace client', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    expect(reg.resolve()).toBe(reg.resolve('main'))
  })

  it('resolve(name) returns that workspace client', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    expect(reg.resolve('alt')).not.toBe(reg.resolve('main'))
  })

  it('resolve(unknown) throws WorkspaceNotFoundError listing names', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    try {
      reg.resolve('ghost')
      expect.fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceNotFoundError)
      expect((err as WorkspaceNotFoundError).available.sort()).toEqual([
        'alt',
        'main',
      ])
    }
  })

  it('has() reflects membership', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    expect(reg.has('alt')).toBe(true)
    expect(reg.has('ghost')).toBe(false)
  })

  it('list() exposes names + baseUrl + isDefault, never tokens', () => {
    const reg = new WorkspaceRegistry(clients(), 'main', meta())
    const list = reg.list()
    expect(list).toContainEqual({
      name: 'main',
      baseUrl: 'https://main.example/v1',
      isDefault: true,
    })
    expect(JSON.stringify(list)).not.toContain('t1')
  })

  it('constructor rejects a default not present in clients', () => {
    expect(() => new WorkspaceRegistry(clients(), 'ghost', meta())).toThrow()
  })
})

describe('createRegistry', () => {
  it('builds one client per configured workspace', () => {
    const reg = createRegistry({
      defaultWorkspace: 'a',
      requestTimeoutMs: 30_000,
      workspaces: {
        a: { token: 't', baseUrl: 'https://a.example/v1' },
        b: { token: 'u', baseUrl: 'https://b.example/v1' },
      },
    })
    expect(reg.has('a')).toBe(true)
    expect(reg.has('b')).toBe(true)
    expect(reg.list().find((w) => w.name === 'a')!.isDefault).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/workspace-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/workspace-registry.ts`**

```ts
/**
 * Registry of per-workspace WeeekApiClient instances.
 *
 * WeeekApiClient stays single-workspace; this registry keys one client per
 * configured workspace and resolves the right one per tool call.
 */

import type { WeeekConfig } from './config.js'

import { WeeekApiClient } from './client/weeek-api-client.js'
import { WorkspaceNotFoundError } from './errors.js'

export interface WorkspaceInfo {
  baseUrl: string
  isDefault: boolean
  name: string
}

export class WorkspaceRegistry {
  constructor(
    private readonly clients: Map<string, WeeekApiClient>,
    private readonly defaultName: string,
    private readonly meta: Map<string, { baseUrl: string }>,
  ) {
    if (!clients.has(defaultName)) {
      throw new Error(
        `WorkspaceRegistry: default workspace "${defaultName}" is not registered`,
      )
    }
  }

  resolve(name?: string): WeeekApiClient {
    const key = name ?? this.defaultName
    const client = this.clients.get(key)
    if (!client) {
      throw new WorkspaceNotFoundError(key, [...this.clients.keys()])
    }
    return client
  }

  has(name: string): boolean {
    return this.clients.has(name)
  }

  list(): WorkspaceInfo[] {
    return [...this.meta.entries()].map(([name, m]) => ({
      name,
      baseUrl: m.baseUrl,
      isDefault: name === this.defaultName,
    }))
  }
}

export function createRegistry(config: WeeekConfig): WorkspaceRegistry {
  const clients = new Map<string, WeeekApiClient>()
  const meta = new Map<string, { baseUrl: string }>()
  for (const [name, ws] of Object.entries(config.workspaces)) {
    clients.set(
      name,
      new WeeekApiClient(ws.token, {
        baseUrl: ws.baseUrl,
        timeoutMs: config.requestTimeoutMs,
      }),
    )
    meta.set(name, { baseUrl: ws.baseUrl })
  }
  return new WorkspaceRegistry(clients, config.defaultWorkspace, meta)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/workspace-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace-registry.ts tests/workspace-registry.test.ts
git commit -m "feat: WorkspaceRegistry and createRegistry factory"
```

---

## Task 4: `workspace` param helper + test registry helper

**Files:**
- Create: `src/tools/workspace-param.ts`
- Create: `tests/tools/_registry.ts` (shared fake for tool tests)
- Test: `tests/tools/workspace-param.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRegistry`, `WeeekApiClient`.
- Produces:
  - `const workspaceParamSchema` — `{ workspace: ZodOptional<ZodString> }`
  - `function resolveClient(registry: WorkspaceRegistry, workspace?: string): WeeekApiClient`
  - test helper `function fakeRegistry(client: unknown): WorkspaceRegistry`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/workspace-param.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import {
  resolveClient,
  workspaceParamSchema,
} from '../../src/tools/workspace-param.js'
import type { WorkspaceRegistry } from '../../src/workspace-registry.js'

describe('workspace param helper', () => {
  it('exposes an optional workspace string with a description', () => {
    const parsed = workspaceParamSchema.workspace.safeParse(undefined)
    expect(parsed.success).toBe(true)
    expect(workspaceParamSchema.workspace.description).toMatch(
      /weeek_list_workspaces/,
    )
  })

  it('resolveClient delegates to registry.resolve', () => {
    const resolve = vi.fn(() => 'CLIENT')
    const reg = { resolve } as unknown as WorkspaceRegistry
    expect(resolveClient(reg, 'main')).toBe('CLIENT')
    expect(resolve).toHaveBeenCalledWith('main')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tools/workspace-param.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/tools/workspace-param.ts`**

```ts
/**
 * Shared `workspace` argument for every WEEEK tool, plus the client resolver.
 * Keeps workspace selection identical across read and write tools.
 */

import { z } from 'zod'

import type { WeeekApiClient } from '../client/weeek-api-client.js'
import type { WorkspaceRegistry } from '../workspace-registry.js'

export const workspaceParamSchema = {
  workspace: z
    .string()
    .min(1)
    .describe(
      'Optional WEEEK workspace name to target. Obtain names from ' +
        'weeek_list_workspaces. If omitted, the default workspace is used.',
    )
    .optional(),
}

export function resolveClient(
  registry: WorkspaceRegistry,
  workspace?: string,
): WeeekApiClient {
  return registry.resolve(workspace)
}
```

- [ ] **Step 4: Create the shared test fake `tests/tools/_registry.ts`**

```ts
import type { WorkspaceRegistry } from '../../src/workspace-registry.js'

/**
 * Wrap a fake client object as a WorkspaceRegistry for tool tests.
 * resolve() always returns the given client regardless of name.
 */
export function fakeRegistry(client: unknown): WorkspaceRegistry {
  return {
    resolve: () => client,
    has: () => true,
    list: () => [],
  } as unknown as WorkspaceRegistry
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/tools/workspace-param.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/workspace-param.ts tests/tools/_registry.ts tests/tools/workspace-param.test.ts
git commit -m "feat: shared workspace param schema and client resolver"
```

---

## Task 5: Migrate read-tool group to the registry

**Files:**
- Modify: `src/tools/read/index.ts`
- Modify: `src/tools/read/list-projects.ts`, `get-project.ts`, `list-boards.ts`, `list-board-columns.ts`, `list-tasks.ts`, `get-task.ts`, `list-workspace-members.ts`
- Modify: `src/index.ts` (build registry; pass it to read group; temp default client to write group)
- Modify tests: each `tests/tools/<read-tool>.test.ts` to wrap the client via `fakeRegistry`
- Test (new behavior): add a routing assertion in `tests/tools/list-tasks.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRegistry`, `resolveClient`, `workspaceParamSchema`, `createRegistry`.
- Produces: `registerReadTools(server: McpServer, registry: WorkspaceRegistry): void`; each `registerXxx(server, registry)`.

### The uniform per-tool recipe

Apply this identical transformation to **each** of the 7 read tool files:

1. Replace the client type import
   `import type { WeeekApiClient } from '../../client/weeek-api-client.js'`
   with
   `import type { WorkspaceRegistry } from '../../workspace-registry.js'`
2. Add the helper import (next to the existing `_helpers.js` import):
   `import { resolveClient, workspaceParamSchema } from '../workspace-param.js'`
3. In the `inputSchema` object literal, add `...workspaceParamSchema,` (alongside `...listParamsSchema` where present; otherwise just add the spread).
4. Change the register function signature param from `client: WeeekApiClient` to `registry: WorkspaceRegistry`.
5. Add `workspace?: string` to the handler's `args` destructured type.
6. As the **first statement inside the `try`**, add: `const client = resolveClient(registry, args.workspace)`.

Worked example — `get-task.ts` handler before/after (illustrates the pattern; `list-projects.ts`, `list-tasks.ts` etc. differ only in their existing args/paths):

```ts
// signature
export function registerGetTask(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  // ...
    async (args: { task_id: string; workspace?: string }) => {
      try {
        const client = resolveClient(registry, args.workspace)
        const raw = await client.get<unknown>(
          `/tm/tasks/${encodeURIComponent(args.task_id)}`,
        )
        // ...unchanged...
```

- [ ] **Step 1: Apply the recipe to all 7 read tool files**

Edit `list-projects.ts`, `get-project.ts`, `list-boards.ts`, `list-board-columns.ts`, `list-tasks.ts`, `get-task.ts`, `list-workspace-members.ts` per the 6-step recipe above.

- [ ] **Step 2: Update `src/tools/read/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { logger } from '../../logger.js'
import { registerGetProject } from './get-project.js'
import { registerGetTask } from './get-task.js'
import { registerListBoardColumns } from './list-board-columns.js'
import { registerListBoards } from './list-boards.js'
import { registerListProjects } from './list-projects.js'
import { registerListTasks } from './list-tasks.js'
import { registerListWorkspaceMembers } from './list-workspace-members.js'

export function registerReadTools(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  registerListProjects(server, registry)
  registerGetProject(server, registry)
  registerListBoards(server, registry)
  registerListBoardColumns(server, registry)
  registerListTasks(server, registry)
  registerGetTask(server, registry)
  registerListWorkspaceMembers(server, registry)

  logger.info('registerReadTools: 7 read tools registered')
}
```

- [ ] **Step 3: Wire `src/index.ts` (registry for read, temp default client for write)**

```ts
import { createRegistry } from './workspace-registry.js'
// ...
  const registry = createRegistry(config)
  // remove the `const ws = ...` / `const client = new WeeekApiClient(...)` block

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  registerReadTools(server, registry)
  // Write group is migrated in Task 7; until then pass the default client.
  registerWriteTools(server, registry.resolve())
```

Remove the now-unused `WeeekApiClient` import from `src/index.ts` (lint `no-unused-vars`).

- [ ] **Step 4: Update the 7 read-tool tests to pass a registry**

In each `tests/tools/<read-tool>.test.ts`, import the fake and wrap the client at every `registerXxx(fake.server, client)` call site:

```ts
import { fakeRegistry } from './_registry.js'
// ...
registerListProjects(fake.server, fakeRegistry(client))
```

Where a test casts the client as `... as unknown as Parameters<typeof registerXxx>[1]`, drop that cast (the second parameter is now a registry) and instead build the plain client object and wrap it: `fakeRegistry(client)`. The client object can be typed loosely (e.g. `const client = { get: vi.fn(...), post: vi.fn(), put: vi.fn(), patch: vi.fn() }`).

- [ ] **Step 5: Add a workspace-routing test to `tests/tools/list-tasks.test.ts`**

```ts
import { WorkspaceRegistry } from '../../src/workspace-registry.js'
import { WeeekApiClient } from '../../src/client/weeek-api-client.js'

it('routes to the workspace named in args.workspace', async () => {
  const calls: string[] = []
  const mk = (tag: string) =>
    ({ get: vi.fn(async () => { calls.push(tag); return { tasks: [] } }) }) as unknown as WeeekApiClient
  const reg = new WorkspaceRegistry(
    new Map([
      ['main', mk('main')],
      ['alt', mk('alt')],
    ]),
    'main',
    new Map([
      ['main', { baseUrl: 'https://m/v1' }],
      ['alt', { baseUrl: 'https://a/v1' }],
    ]),
  )
  registerListTasks(fake.server, reg)
  await fake.getHandler()({ workspace: 'alt' })
  expect(calls).toEqual(['alt'])
})
```

(Adjust the `fake` helper / `getHandler` arg type in that file to allow an optional `workspace` field.)

- [ ] **Step 6: Run the suite + typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS — all read tools resolve through the registry; write tools still work via the temp default client.

- [ ] **Step 7: Commit**

```bash
git add src/tools/read src/index.ts tests/tools
git commit -m "feat: route read tools through WorkspaceRegistry with optional workspace arg"
```

---

## Task 6: `weeek_list_workspaces` tool

**Files:**
- Create: `src/tools/read/list-workspaces.ts`
- Modify: `src/tools/read/index.ts` (register it; update the count log to 8)
- Test: `tests/tools/list-workspaces.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRegistry.list()`, `jsonContent`, `toMcpError`.
- Produces: `function registerListWorkspaces(server: McpServer, registry: WorkspaceRegistry): void` registering tool name `weeek_list_workspaces`.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/list-workspaces.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { registerListWorkspaces } from '../../src/tools/read/list-workspaces.js'
import type { WorkspaceRegistry } from '../../src/workspace-registry.js'

function makeFakeServer() {
  let name = ''
  let handler: ((args: unknown) => Promise<{ content: Array<{ text: string }> }>) | null = null
  const server = {
    registerTool: vi.fn((n: string, _meta: unknown, h: typeof handler) => {
      name = n
      handler = h
    }),
  }
  return {
    server: server as unknown as Parameters<typeof registerListWorkspaces>[0],
    getName: () => name,
    getHandler: () => handler!,
  }
}

describe('weeek_list_workspaces tool', () => {
  it('registers under weeek_list_workspaces and returns list() output without tokens', async () => {
    const reg = {
      list: () => [
        { name: 'main', baseUrl: 'https://m/v1', isDefault: true },
        { name: 'alt', baseUrl: 'https://a/v1', isDefault: false },
      ],
    } as unknown as WorkspaceRegistry
    const fake = makeFakeServer()
    registerListWorkspaces(fake.server, reg)
    expect(fake.getName()).toBe('weeek_list_workspaces')

    const res = await fake.getHandler()({})
    const payload = JSON.parse(res.content[0]!.text)
    expect(payload.workspaces).toHaveLength(2)
    expect(payload.workspaces[0]).toEqual({
      name: 'main',
      baseUrl: 'https://m/v1',
      isDefault: true,
    })
    expect(res.content[0]!.text).not.toContain('token')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tools/list-workspaces.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/tools/read/list-workspaces.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_list_workspaces
 *
 * Lists the workspaces configured for this MCP server so the agent can pass a
 * `workspace` argument to other tools. Returns name, baseUrl, and which one is
 * the default. NEVER returns API tokens.
 */
import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import { jsonContent } from './_helpers.js'

export function registerListWorkspaces(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  server.registerTool(
    'weeek_list_workspaces',
    {
      description:
        'List the WEEEK workspaces configured for this server. Returns each ' +
        "workspace's name, baseUrl, and whether it is the default. Use a " +
        "returned name as the optional `workspace` argument on any other tool " +
        'to target that workspace. Never returns API tokens. Call this when a ' +
        'user references more than one workspace or asks which workspaces exist.',
      inputSchema: {},
    },
    async () => {
      try {
        const workspaces = registry.list()
        return jsonContent({ workspaces, count: workspaces.length })
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_workspaces')
}
```

- [ ] **Step 4: Register it in `src/tools/read/index.ts`**

Add the import `import { registerListWorkspaces } from './list-workspaces.js'`, call `registerListWorkspaces(server, registry)` after `registerListWorkspaceMembers(...)`, and update the log line to `'registerReadTools: 8 read tools registered'`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/tools/list-workspaces.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/read/list-workspaces.ts src/tools/read/index.ts tests/tools/list-workspaces.test.ts
git commit -m "feat: add weeek_list_workspaces tool"
```

---

## Task 7: Migrate write-tool group to the registry

**Files:**
- Modify: `src/tools/write/index.ts`
- Modify: `src/tools/write/create-task.ts`, `update-task.ts`, `move-task.ts`, `complete-task.ts`
- Modify: `src/index.ts` (pass `registry` to the write group; drop the temp client)
- Modify tests: each `tests/tools/<write-tool>.test.ts` to wrap the client via `fakeRegistry`

**Interfaces:**
- Produces: `registerWriteTools(server: McpServer, registry: WorkspaceRegistry): void`; each `registerXxx(server, registry)`.

Apply the **same 6-step recipe from Task 5** to the 4 write tool files. Note write tools import `jsonContent` from `'../read/_helpers.js'` and the helper from `'../workspace-param.js'` (one level up from `write/`). The `WorkspaceRegistry` type import path is `'../../workspace-registry.js'`.

- [ ] **Step 1: Apply the recipe to all 4 write tool files**

Edit `create-task.ts`, `update-task.ts`, `move-task.ts`, `complete-task.ts` per the recipe (replace client import with registry import; add `import { resolveClient, workspaceParamSchema } from '../workspace-param.js'`; add `...workspaceParamSchema,` to `inputSchema`; change the param to `registry: WorkspaceRegistry`; add `workspace?: string` to the args type; add `const client = resolveClient(registry, args.workspace)` as the first statement in `try`).

- [ ] **Step 2: Update `src/tools/write/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WorkspaceRegistry } from '../../workspace-registry.js'

import { logger } from '../../logger.js'
import { registerCompleteTask } from './complete-task.js'
import { registerCreateTask } from './create-task.js'
import { registerMoveTask } from './move-task.js'
import { registerUpdateTask } from './update-task.js'

export function registerWriteTools(
  server: McpServer,
  registry: WorkspaceRegistry,
): void {
  registerCreateTask(server, registry)
  registerUpdateTask(server, registry)
  registerMoveTask(server, registry)
  registerCompleteTask(server, registry)

  logger.info('registerWriteTools: 4 write tools registered')
}
```

- [ ] **Step 3: Finalize `src/index.ts`**

Change `registerWriteTools(server, registry.resolve())` to `registerWriteTools(server, registry)`.

- [ ] **Step 4: Update the 4 write-tool tests**

In each `tests/tools/<write-tool>.test.ts`, import `fakeRegistry` from `./_registry.js` and wrap the client object: `registerMoveTask(fake.server, fakeRegistry(client))`. Drop any `as unknown as Parameters<typeof registerXxx>[1]` cast on the client object.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS — all 11 tools resolve through the registry.

- [ ] **Step 6: Commit**

```bash
git add src/tools/write src/index.ts tests/tools
git commit -m "feat: route write tools through WorkspaceRegistry with optional workspace arg"
```

---

## Task 8: Setup wizard (`npx claude-weeek setup`)

**Files:**
- Create: `src/setup/validate-token.ts`
- Create: `src/setup/mcp-block.ts`
- Create: `src/setup/config-writer.ts`
- Create: `src/setup/wizard.ts`
- Modify: `src/index.ts` (branch on `process.argv[2] === 'setup'`)
- Test: `tests/setup/validate-token.test.ts`, `tests/setup/mcp-block.test.ts`, `tests/setup/config-writer.test.ts`

**Interfaces:**
- Produces:
  - `async function validateToken(token: string, baseUrl: string, fetchFn?: typeof fetch): Promise<{ ok: boolean; status?: number; workspaceName?: string }>`
  - `function generateMcpBlock(opts?: { configPath?: string }): string`
  - `function serializeConfig(file: ConfigFile): string`
  - `async function writeConfigFile(path: string, file: ConfigFile, deps?: { mkdir; writeFile; chmod }): Promise<void>`
  - `async function runSetup(): Promise<void>`

- [ ] **Step 1: Write failing tests for the pure pieces**

Create `tests/setup/validate-token.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { validateToken } from '../../src/setup/validate-token.js'

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('validateToken', () => {
  it('returns ok with a workspace name on 200', async () => {
    const fetchFn = vi.fn(async () =>
      res(200, { success: true, workspace: { id: 1, title: 'Acme' } }),
    )
    const r = await validateToken('t', 'https://api.weeek.net/public/v1', fetchFn as unknown as typeof fetch)
    expect(r.ok).toBe(true)
    expect(r.workspaceName).toBe('Acme')
  })

  it('returns not-ok on 401', async () => {
    const fetchFn = vi.fn(async () => res(401, { error: 'unauthorized' }))
    const r = await validateToken('bad', 'https://api.weeek.net/public/v1', fetchFn as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
  })
})
```

Create `tests/setup/mcp-block.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { generateMcpBlock } from '../../src/setup/mcp-block.js'

describe('generateMcpBlock', () => {
  it('emits a valid npx-based mcpServers block', () => {
    const block = JSON.parse(generateMcpBlock())
    expect(block.mcpServers.weeek.command).toBe('npx')
    expect(block.mcpServers.weeek.args).toEqual(['-y', 'claude-weeek'])
  })

  it('includes WEEEK_CONFIG_PATH env when a custom path is given', () => {
    const block = JSON.parse(generateMcpBlock({ configPath: '/custom/c.json' }))
    expect(block.mcpServers.weeek.env.WEEEK_CONFIG_PATH).toBe('/custom/c.json')
  })
})
```

Create `tests/setup/config-writer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { serializeConfig, writeConfigFile } from '../../src/setup/config-writer.js'

describe('serializeConfig', () => {
  it('round-trips and pretty-prints', () => {
    const file = {
      defaultWorkspace: 'main',
      workspaces: { main: { token: 't' } },
    }
    expect(JSON.parse(serializeConfig(file))).toEqual(file)
    expect(serializeConfig(file)).toContain('\n')
  })
})

describe('writeConfigFile', () => {
  it('creates the directory and writes mode 0600', async () => {
    const mkdir = vi.fn(async () => undefined)
    const writeFile = vi.fn(async () => undefined)
    const chmod = vi.fn(async () => undefined)
    await writeConfigFile(
      '/home/u/.config/claude-weeek/config.json',
      { defaultWorkspace: 'main', workspaces: { main: { token: 't' } } },
      { mkdir, writeFile, chmod },
    )
    expect(mkdir).toHaveBeenCalledWith(
      '/home/u/.config/claude-weeek',
      { recursive: true },
    )
    expect(writeFile.mock.calls[0]![0]).toBe(
      '/home/u/.config/claude-weeek/config.json',
    )
    expect(chmod).toHaveBeenCalledWith(
      '/home/u/.config/claude-weeek/config.json',
      0o600,
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/setup`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/setup/validate-token.ts`**

Use the endpoint confirmed in Task 0. Default to `/ws` with a `/tm/projects?limit=1` fallback:

```ts
/**
 * Token validation for the setup wizard.
 *
 * Task 0 probe result: primary endpoint `GET /ws` returns
 * `{ success, workspace: { id, title, ... } }` — workspace name is at
 * `body.workspace.title`. 401/403 => invalid token; any 2xx => valid.
 * Fallback `GET /tm/projects?limit=1` confirms validity when /ws is absent.
 */

export interface TokenCheck {
  ok: boolean
  status?: number
  workspaceName?: string
}

export async function validateToken(
  token: string,
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<TokenCheck> {
  const base = baseUrl.replace(/\/$/, '')
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }

  const res = await fetchFn(`${base}/ws`, { headers })
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status }
  }
  if (res.ok) {
    let workspaceName: string | undefined
    try {
      const body = (await res.json()) as Record<string, unknown>
      workspaceName = extractWorkspaceName(body)
    } catch {
      // ignore body parse issues — token is still valid
    }
    return { ok: true, status: res.status, workspaceName }
  }

  // /ws unavailable (e.g. 404) — fall back to a lightweight authed read
  const fb = await fetchFn(`${base}/tm/projects?limit=1`, { headers })
  if (fb.status === 401 || fb.status === 403) {
    return { ok: false, status: fb.status }
  }
  return { ok: fb.ok, status: fb.status }
}

function extractWorkspaceName(body: Record<string, unknown>): string | undefined {
  // Task 0 confirmed shape: { success, workspace: { id, title, ... } }
  const ws = body.workspace
  if (ws && typeof ws === 'object') {
    const title = (ws as Record<string, unknown>).title
    if (typeof title === 'string') return title
  }
  return undefined
}
```

- [ ] **Step 4: Implement `src/setup/mcp-block.ts`**

```ts
export function generateMcpBlock(opts: { configPath?: string } = {}): string {
  const weeek: Record<string, unknown> = {
    command: 'npx',
    args: ['-y', 'claude-weeek'],
  }
  if (opts.configPath) {
    weeek.env = { WEEEK_CONFIG_PATH: opts.configPath }
  }
  return JSON.stringify({ mcpServers: { weeek } }, null, 2)
}
```

- [ ] **Step 5: Implement `src/setup/config-writer.ts`**

```ts
import { mkdir as fsMkdir, writeFile as fsWriteFile, chmod as fsChmod } from 'node:fs/promises'
import path from 'node:path'

import type { ConfigFile } from '../config.js'

export function serializeConfig(file: ConfigFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

export interface WriteDeps {
  chmod?: (p: string, mode: number) => Promise<void>
  mkdir?: (p: string, opts: { recursive: boolean }) => Promise<unknown>
  writeFile?: (p: string, data: string) => Promise<void>
}

export async function writeConfigFile(
  filePath: string,
  file: ConfigFile,
  deps: WriteDeps = {},
): Promise<void> {
  const mkdir = deps.mkdir ?? fsMkdir
  const writeFile = deps.writeFile ?? fsWriteFile
  const chmod = deps.chmod ?? fsChmod
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, serializeConfig(file))
  await chmod(filePath, 0o600)
}
```

- [ ] **Step 6: Implement `src/setup/wizard.ts`**

```ts
/* eslint-disable no-console */
/**
 * Interactive setup wizard. CLI mode only — stdout is a TTY here, NOT the
 * JSON-RPC transport, so console output is intentional and allowed.
 */

import process from 'node:process'
import * as readline from 'node:readline/promises'

import type { ConfigFile } from '../config.js'

import {
  DEFAULT_BASE_URL,
  loadConfig,
  resolveConfigPath,
} from '../config.js'
import { writeConfigFile } from './config-writer.js'
import { generateMcpBlock } from './mcp-block.js'
import { validateToken } from './validate-token.js'

export async function runSetup(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const configPath = resolveConfigPath()
    const existing = readExisting(configPath)
    const workspaces: ConfigFile['workspaces'] = { ...(existing?.workspaces ?? {}) }

    console.log('WEEEK MCP setup — add one or more workspaces.\n')

    let addMore = true
    while (addMore) {
      const name = (await rl.question('Workspace name (e.g. main): ')).trim()
      if (!name) {
        console.log('Name cannot be empty.')
        continue
      }
      const token = (await rl.question(`Token for "${name}": `)).trim()
      const baseUrlRaw = (
        await rl.question(`Base URL [${DEFAULT_BASE_URL}]: `)
      ).trim()
      const baseUrl = baseUrlRaw || DEFAULT_BASE_URL

      process.stdout.write('Validating token... ')
      const check = await validateToken(token, baseUrl)
      if (!check.ok) {
        console.log(`FAILED (status ${check.status ?? 'network error'}). Try again.`)
        continue
      }
      console.log(`OK${check.workspaceName ? ` (${check.workspaceName})` : ''}.`)

      workspaces[name] =
        baseUrl === DEFAULT_BASE_URL ? { token } : { token, baseUrl }

      const more = (await rl.question('Add another workspace? (y/N): ')).trim().toLowerCase()
      addMore = more === 'y' || more === 'yes'
    }

    const names = Object.keys(workspaces)
    if (names.length === 0) {
      console.log('No workspaces configured. Aborting.')
      return
    }

    let defaultWorkspace = names[0]!
    if (names.length > 1) {
      const answer = (
        await rl.question(`Default workspace [${names[0]}] (${names.join(', ')}): `)
      ).trim()
      if (answer && names.includes(answer)) defaultWorkspace = answer
    }

    const file: ConfigFile = { defaultWorkspace, workspaces }
    await writeConfigFile(configPath, file)

    const custom = process.env.WEEEK_CONFIG_PATH ? configPath : undefined
    console.log(`\nWrote ${configPath} (mode 0600).`)
    console.log('\nAdd this to your MCP client config:\n')
    console.log(generateMcpBlock({ configPath: custom }))
  } finally {
    rl.close()
  }
}

function readExisting(configPath: string): ConfigFile | undefined {
  try {
    const cfg = loadConfig()
    // Reconstruct a ConfigFile-shaped object from the loaded config so the
    // wizard can show/extend existing workspaces.
    const workspaces: ConfigFile['workspaces'] = {}
    for (const [name, ws] of Object.entries(cfg.workspaces)) {
      workspaces[name] =
        ws.baseUrl === DEFAULT_BASE_URL
          ? { token: ws.token }
          : { token: ws.token, baseUrl: ws.baseUrl }
    }
    return { defaultWorkspace: cfg.defaultWorkspace, workspaces }
  } catch {
    void configPath
    return undefined
  }
}
```

- [ ] **Step 7: Branch on the `setup` subcommand in `src/index.ts`**

At the very start of `main()` (before `loadConfig`):

```ts
  if (process.argv[2] === 'setup') {
    const { runSetup } = await import('./setup/wizard.js')
    await runSetup()
    return
  }
```

(Dynamic import keeps `readline`/wizard code out of the server hot path.)

- [ ] **Step 8: Run setup tests + typecheck + lint**

Run: `pnpm vitest run tests/setup && pnpm typecheck && pnpm lint`
Expected: PASS / clean.

- [ ] **Step 9: Smoke-test the wizard manually**

```bash
pnpm build
node dist/index.js setup
```

Expected: interactive prompts; entering a real token prints `OK`, writes the config file, and prints an `mcpServers` block. (Use Ctrl-C to abort without writing.)

- [ ] **Step 10: Commit**

```bash
git add src/setup src/index.ts tests/setup
git commit -m "feat: interactive setup wizard with token validation"
```

---

## Task 9: Documentation

**Files:**
- Modify: `README.md` (configuration / setup / multi-workspace sections)
- Modify: `CLAUDE.md` (Auth/config constraint + config note)

- [ ] **Step 1: Update `README.md`**

Rewrite the configuration section to cover:
- `npx claude-weeek setup` as the recommended path (what it asks, where it writes — `~/.config/claude-weeek/config.json` / `%APPDATA%\claude-weeek\config.json`, `WEEEK_CONFIG_PATH` override).
- The config file format (the JSONC block from the spec).
- Per-workspace `baseUrl` for self-hosted instances.
- The optional `workspace` argument on tools + `weeek_list_workspaces`.
- The single-token env fallback (`WEEEK_API_TOKEN` / `WEEEK_API_BASE_URL`) for backward compatibility.

- [ ] **Step 2: Update `CLAUDE.md`**

In the **Constraints** section, change the Auth line to note both routes: a JSON config file (multi-workspace, written by `npx claude-weeek setup`) and the `WEEEK_API_TOKEN` env fallback (single workspace). Add a one-line pointer to the new design spec `docs/superpowers/specs/2026-06-18-multi-workspace-and-setup-design.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document setup wizard, multi-workspace config, per-workspace base URL"
```

---

## Task 10: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the complete suite**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`
Expected: typecheck clean; lint clean; all tests pass (prior 107 + the new config/registry/workspace-param/list-workspaces/setup tests + routing tests); build emits `dist/index.js` with the `#!/usr/bin/env node` shebang preserved.

- [ ] **Step 2: Verify the built binary still serves and still does `setup`**

```bash
WEEEK_API_TOKEN=dummy node dist/index.js <<< '' 2>&1 | head -5   # server starts, logs to stderr
node dist/index.js setup < /dev/null 2>&1 | head -5              # wizard starts (EOF aborts cleanly)
```

Expected: server-mode logs the startup line to stderr; setup-mode prints the first prompt.

- [ ] **Step 3: Confirm no token leakage**

Run: `git grep -nE 'console\.log' src || echo 'no console.log in src'`
Expected: only the intentional `eslint-disable no-console` wizard file; no `console.log` elsewhere in `src/`.

---

## Self-Review (completed during planning)

- **Spec coverage:** setup wizard (Task 8), multi-workspace config (Task 2), `WorkspaceRegistry` (Task 3), optional `workspace` param on all tools (Tasks 4/5/7), `weeek_list_workspaces` (Task 6), per-workspace base URL (Task 2 `parseConfig` + Task 3 `createRegistry`), `WorkspaceNotFoundError` (Task 1), backward compat env fallback (Task 2), docs (Task 9), token validation via API (Task 0 + Task 8). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO. Task 0's "confirmed endpoint" is a deliberate spike whose result is substituted into Task 8 Step 3.
- **Type consistency:** `WeeekConfig` / `WorkspaceConfig` shape is identical across config.ts, workspace-registry.ts, and createRegistry; `WorkspaceRegistry.resolve/has/list` signatures match their consumers; `ConfigFile` (zod-inferred) is the type shared by parseConfig and the setup writer.
