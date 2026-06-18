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
    const workspaces: ConfigFile['workspaces'] = {
      ...(existing?.workspaces ?? {}),
    }

    console.log('WEEEK MCP setup — add one or more workspaces.\n')

    let addMore = true
    while (addMore) {
      const name = (
        await rl.question('Workspace name (e.g. main): ')
      ).trim()
      if (!name) {
        console.log('Name cannot be empty.')
        continue
      }
      const token = (
        await rl.question(`Token for "${name}": `)
      ).trim()
      const baseUrlRaw = (
        await rl.question(`Base URL [${DEFAULT_BASE_URL}]: `)
      ).trim()
      const baseUrl = baseUrlRaw || DEFAULT_BASE_URL

      process.stdout.write('Validating token... ')
      const check = await validateToken(token, baseUrl)
      if (!check.ok) {
        console.log(
          `FAILED (status ${check.status ?? 'network error'}). Try again.`,
        )
        continue
      }
      console.log(
        `OK${check.workspaceName ? ` (${check.workspaceName})` : ''}.`,
      )

      workspaces[name] =
        baseUrl === DEFAULT_BASE_URL ? { token } : { token, baseUrl }

      const more = (
        await rl.question('Add another workspace? (y/N): ')
      )
        .trim()
        .toLowerCase()
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
        await rl.question(
          `Default workspace [${names[0]}] (${names.join(', ')}): `,
        )
      ).trim()
      if (answer && names.includes(answer)) defaultWorkspace = answer
    }

    const file: ConfigFile = { defaultWorkspace, workspaces }
    await writeConfigFile(configPath, file)

    const custom = process.env.WEEEK_CONFIG_PATH
      ? configPath
      : undefined
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
