/**
 * CLI. Default: download the live WEEEK spec and (re)write the committed
 * snapshot. With --check-upstream: compare live vs committed; exit 1 on drift.
 *
 * Output goes to stdout via process.stdout.write (the project bans console.log).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { OpenApiDoc } from './types.js'

import { loadSpec } from './load-spec.js'

const SNAPSHOT = path.join('spec', 'weeek-openapi.json')
const META = path.join('spec', 'weeek-openapi.meta.json')

interface SnapshotMeta {
  sourceUrl: string
  chunkHash: string
  fetchedAt: string
  openapiVersion?: string
}

function out(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

/** Compare two specs by their (method path) operation sets; return changed paths. */
function changedPaths(a: OpenApiDoc, b: OpenApiDoc): string[] {
  const sig = (s: OpenApiDoc): Map<string, string> => {
    const m = new Map<string, string>()
    for (const [p, methods] of Object.entries(s.paths ?? {})) {
      m.set(p, Object.keys(methods ?? {}).sort().join(','))
    }
    return m
  }
  const ma = sig(a)
  const mb = sig(b)
  const changed: string[] = []
  for (const [p, v] of mb) if (ma.get(p) !== v) changed.push(p)
  for (const [p] of ma) if (!mb.has(p)) changed.push(`${p} (removed)`)
  return changed.sort()
}

async function main(): Promise<number> {
  const checkUpstream = process.argv.includes('--check-upstream')
  const { schema, chunkUrl, chunkHash } = await loadSpec()

  if (!checkUpstream) {
    await mkdir('spec', { recursive: true })
    await writeFile(SNAPSHOT, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
    const meta: SnapshotMeta = {
      sourceUrl: chunkUrl,
      chunkHash,
      fetchedAt: new Date().toISOString(),
      openapiVersion: schema.openapi,
    }
    await writeFile(META, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    out(`✓ Snapshot written: ${SNAPSHOT} (chunk ${chunkHash})`)
    return 0
  }

  // --check-upstream: cheap hash short-circuit, then deep path diff.
  let committedMeta: SnapshotMeta
  try {
    committedMeta = JSON.parse(await readFile(META, 'utf8')) as SnapshotMeta
  } catch {
    out(`✗ No committed snapshot found at ${META}. Run \`pnpm spec:fetch\` first.`)
    return 1
  }
  if (committedMeta.chunkHash === chunkHash) {
    out(`✓ WEEEK spec unchanged upstream (chunk ${chunkHash}).`)
    return 0
  }
  const committed = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as OpenApiDoc
  const changed = changedPaths(committed, schema)
  out(`✗ WEEEK spec changed upstream: chunk ${committedMeta.chunkHash} → ${chunkHash}`)
  if (changed.length > 0) {
    out('Changed paths:')
    for (const p of changed) out(`  - ${p}`)
  } else {
    out('(no path-set changes; schema bodies/params differ — run `pnpm spec:fetch` and diff)')
  }
  out('Run `pnpm spec:fetch`, review the diff, reconcile the tools, and commit the refreshed snapshot.')
  return 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    process.stderr.write(`spec:fetch failed: ${(err as Error).message}\n`)
    process.exitCode = 1
  },
)
