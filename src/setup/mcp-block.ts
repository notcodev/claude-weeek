export function generateMcpBlock(
  opts: { configPath?: string } = {},
): string {
  const weeek: Record<string, unknown> = {
    command: 'npx',
    args: ['-y', 'claude-weeek'],
  }
  if (opts.configPath) {
    weeek.env = { WEEEK_CONFIG_PATH: opts.configPath }
  }
  return JSON.stringify({ mcpServers: { weeek } }, null, 2)
}
