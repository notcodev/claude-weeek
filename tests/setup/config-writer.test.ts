import { describe, expect, it, vi } from 'vitest'

import {
  serializeConfig,
  writeConfigFile,
} from '../../src/setup/config-writer.js'

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
      {
        defaultWorkspace: 'main',
        workspaces: { main: { token: 't' } },
      },
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
