/** Pure parsing of the WEEEK dev-portal HTML/JS to locate the spec chunk. */

export function parseEntryUrl(html: string): string {
  const m = html.match(/src="(\/assets\/entry\.client-[^"]+\.js)"/)
  if (!m?.[1]) throw new Error('entry chunk not found in portal HTML')
  return m[1]
}

export function parseYamlChunkRef(entryJs: string): string {
  const m = entryJs.match(
    /["'`](\.?\/?(?:assets\/)?weeek\.yaml-[A-Za-z0-9_-]+\.js)["'`]/,
  )
  if (!m?.[1]) throw new Error('weeek.yaml chunk reference not found in entry bundle')
  return m[1]
}

export function chunkHashFromName(name: string): string {
  const m = name.match(/weeek\.yaml-([A-Za-z0-9_-]+)\.js/)
  return m?.[1] ?? ''
}
