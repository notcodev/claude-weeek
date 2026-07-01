import { describe, expect, it } from 'vitest'

import {
  chunkHashFromName,
  parseEntryUrl,
  parseYamlChunkRef,
} from '../../scripts/spec-sync/discover.js'

describe('parseEntryUrl', () => {
  it('extracts the entry.client module src', () => {
    const html =
      '<script type="module" crossorigin src="/assets/entry.client-Dm62IRDB.js"></script>'
    expect(parseEntryUrl(html)).toBe(
      '/assets/entry.client-Dm62IRDB.js',
    )
  })
  it('throws when no entry chunk is present', () => {
    expect(() => parseEntryUrl('<html></html>')).toThrow(
      /entry chunk/i,
    )
  })
})

describe('parseYamlChunkRef', () => {
  it('extracts the weeek.yaml chunk reference', () => {
    const js = 'await import("./weeek.yaml-zrWBOv8I.js");'
    expect(parseYamlChunkRef(js)).toBe('./weeek.yaml-zrWBOv8I.js')
  })
  it('throws when the chunk reference is missing', () => {
    expect(() => parseYamlChunkRef('const x = 1')).toThrow(
      /weeek\.yaml/i,
    )
  })
})

describe('chunkHashFromName', () => {
  it('pulls the hash out of the filename', () => {
    expect(chunkHashFromName('/assets/weeek.yaml-zrWBOv8I.js')).toBe(
      'zrWBOv8I',
    )
  })
})
