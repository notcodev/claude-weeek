import { describe, expect, it } from 'vitest'

import { generateMcpBlock } from '../../src/setup/mcp-block.js'

describe('generateMcpBlock', () => {
  it('emits a valid npx-based mcpServers block', () => {
    const block = JSON.parse(generateMcpBlock())
    expect(block.mcpServers.weeek.command).toBe('npx')
    expect(block.mcpServers.weeek.args).toEqual([
      '-y',
      'claude-weeek',
    ])
  })

  it('includes WEEEK_CONFIG_PATH env when a custom path is given', () => {
    const block = JSON.parse(
      generateMcpBlock({ configPath: '/custom/c.json' }),
    )
    expect(block.mcpServers.weeek.env.WEEEK_CONFIG_PATH).toBe(
      '/custom/c.json',
    )
  })
})
