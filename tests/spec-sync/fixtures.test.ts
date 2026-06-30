import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { listRegisteredTools } from '../../scripts/spec-sync/capture-contract.js'
import { toolFixtures } from '../../scripts/spec-sync/fixtures.js'

const tools = listRegisteredTools()

describe('fixture coverage', () => {
  it('every registered tool has a fixture (and vice versa)', () => {
    const registered = tools.map((t) => t.name).sort()
    expect(Object.keys(toolFixtures).sort()).toEqual(registered)
  })

  it('every fixture validates against its tool zod input schema', () => {
    for (const t of tools) {
      const schema = z.object(t.inputSchema as z.ZodRawShape)
      for (const args of toolFixtures[t.name] ?? []) {
        expect(() => schema.parse(args)).not.toThrow()
      }
    }
  })
})
