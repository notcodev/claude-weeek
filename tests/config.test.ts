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
    expect(cfg.workspaces.main!.baseUrl).toBe(
      'https://main.example/v1',
    )
    expect(cfg.workspaces.other!.baseUrl).toBe(
      'https://global.example/v1',
    )
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
    expect(cfg.workspaces.main!.baseUrl).toBe(
      'https://env.example/v1',
    )
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
    const cfg = loadConfig({
      ...noFile,
      env: { WEEEK_API_TOKEN: 'tok_123' },
    })
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
    expect(cfg.workspaces.default!.baseUrl).toBe(
      'https://staging.example/v1',
    )
  })

  it('throws MissingConfigError when neither file nor token exist', () => {
    expect(() => loadConfig({ ...noFile, env: {} })).toThrow(
      MissingConfigError,
    )
  })

  it('missingConfigError mentions setup and never leaks the token', () => {
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
      resolveConfigPath({
        env: { WEEEK_CONFIG_PATH: '/custom/c.json' },
      }),
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
      resolveConfigPath({
        env: {},
        platform: 'linux',
        homeDir: '/home/u',
      }),
    ).toBe('/home/u/.config/claude-weeek/config.json')
  })

  it('uses APPDATA on win32', () => {
    expect(
      resolveConfigPath({
        env: {},
        platform: 'win32',
        appData: 'C:\\Users\\u\\AppData\\Roaming',
      }),
    ).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\claude-weeek\\config.json',
    )
  })
})
