/** Network loader: resolve the spec chunk URL, download it, import schema/slugs. */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { OpenApiDoc } from './types.js'

import {
  chunkHashFromName,
  parseEntryUrl,
  parseYamlChunkRef,
} from './discover.js'

const PORTAL = 'https://developers.weeek.net'

async function getText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`)
  return res.text()
}

/** Walk HTML → entry chunk → weeek.yaml chunk and return its absolute URL. */
export async function resolveChunkUrl(): Promise<string> {
  const html = await getText(`${PORTAL}/`)
  const entry = parseEntryUrl(html)
  const entryJs = await getText(`${PORTAL}${entry}`)
  const ref = parseYamlChunkRef(entryJs).replace(/^\.?\//, '')
  return ref.startsWith('assets/')
    ? `${PORTAL}/${ref}`
    : `${PORTAL}/assets/${ref}`
}

/** Download the chunk (and any sibling ./*.js it imports) and import it. */
export async function loadSpec(): Promise<{
  schema: OpenApiDoc
  slugs: unknown
  chunkUrl: string
  chunkHash: string
}> {
  const chunkUrl = await resolveChunkUrl()
  const baseUrl = chunkUrl.slice(0, chunkUrl.lastIndexOf('/') + 1)
  const src = await getText(chunkUrl)

  const dir = await mkdtemp(path.join(tmpdir(), 'weeek-spec-'))
  const fileName = chunkUrl.slice(chunkUrl.lastIndexOf('/') + 1)
  await writeFile(path.join(dir, fileName), src, 'utf8')

  // Defensive: download any sibling chunks this module imports relatively.
  const siblings = new Set(
    [...src.matchAll(/["'`]\.\/([\w.\-]+\.js)["'`]/g)]
      .map((m) => m[1])
      .filter((n): n is string => Boolean(n) && n !== fileName),
  )
  for (const name of siblings) {
    await writeFile(
      path.join(dir, name),
      await getText(`${baseUrl}${name}`),
      'utf8',
    )
  }

  const mod = (await import(
    pathToFileURL(path.join(dir, fileName)).href
  )) as {
    schema?: OpenApiDoc
    slugs?: unknown
  }
  if (!mod.schema || !mod.slugs) {
    throw new Error(
      'spec chunk did not export both `schema` and `slugs` — the WEEEK portal format changed; update scripts/spec-sync/load-spec.ts',
    )
  }
  return {
    schema: mod.schema,
    slugs: mod.slugs,
    chunkUrl,
    chunkHash: chunkHashFromName(chunkUrl),
  }
}
