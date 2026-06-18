import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceRegistry } from '../../src/workspace-registry.js'

import {
  resolveClient,
  workspaceParamSchema,
} from '../../src/tools/workspace-param.js'

describe('workspace param helper', () => {
  it('exposes an optional workspace string with a description', () => {
    const parsed = workspaceParamSchema.workspace.safeParse(undefined)
    expect(parsed.success).toBe(true)
    expect(workspaceParamSchema.workspace.description).toMatch(
      /weeek_list_workspaces/,
    )
  })

  it('resolveClient delegates to registry.resolve', () => {
    const resolve = vi.fn(() => 'CLIENT')
    const reg = { resolve } as unknown as WorkspaceRegistry
    expect(resolveClient(reg, 'main')).toBe('CLIENT')
    expect(resolve).toHaveBeenCalledWith('main')
  })
})
