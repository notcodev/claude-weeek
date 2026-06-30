import { describe, expect, it } from 'vitest'

import {
  loadSpec,
  resolveChunkUrl,
} from '../../scripts/spec-sync/load-spec.js'

describe('live WEEEK spec loading (network)', () => {
  it('resolves a weeek.yaml chunk URL', async () => {
    const url = await resolveChunkUrl()
    expect(url).toMatch(/weeek\.yaml-.+\.js$/)
  })

  it('imports a dereferenced OpenAPI document', async () => {
    const { schema } = await loadSpec()
    expect(schema.paths['/tm/tasks']).toBeDefined()
  })
})
