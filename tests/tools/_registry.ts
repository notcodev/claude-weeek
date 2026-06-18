import type { WorkspaceRegistry } from '../../src/workspace-registry.js'

/**
 * Wrap a fake client object as a WorkspaceRegistry for tool tests.
 * resolve() always returns the given client regardless of name.
 */
export function fakeRegistry(client: unknown): WorkspaceRegistry {
  return {
    resolve: () => client,
    has: () => true,
    list: () => [],
  } as unknown as WorkspaceRegistry
}
