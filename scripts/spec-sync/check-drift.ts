/**
 * CLI. Compare what the MCP tools send (captured at runtime) against the
 * committed WEEEK OpenAPI snapshot. Exit 1 if any error-severity drift is found.
 * Fully offline — reads spec/weeek-openapi.json, never touches the network.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { OpenApiDoc } from './types.js'

import { captureContract } from './capture-contract.js'
import { checkAll } from './compare.js'
import { toolFixtures } from './fixtures.js'
import { indexOperations } from './openapi.js'
import { formatFindings, hasErrors } from './report.js'

const SNAPSHOT = path.join('spec', 'weeek-openapi.json')

async function main(): Promise<number> {
  let spec: OpenApiDoc
  try {
    spec = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as OpenApiDoc
  } catch {
    process.stderr.write(
      `No snapshot at ${SNAPSHOT}. Run \`pnpm spec:fetch\` first.\n`,
    )
    return 1
  }

  const index = indexOperations(spec)
  const captured = await captureContract(toolFixtures)
  const findings = checkAll(captured, index)
  process.stdout.write(formatFindings(findings))
  return hasErrors(findings) ? 1 : 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    process.stderr.write(`spec:check failed: ${(err as Error).message}\n`)
    process.exitCode = 1
  },
)
