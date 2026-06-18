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
    return path.win32.join(appData, 'claude-weeek', 'config.json')
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
