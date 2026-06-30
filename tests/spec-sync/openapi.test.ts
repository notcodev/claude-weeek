import { describe, expect, it } from 'vitest'

import type { OpenApiDoc } from '../../scripts/spec-sync/types.js'

import {
  indexOperations,
  matchOperation,
  pathTemplateToRegex,
  specBasePath,
} from '../../scripts/spec-sync/openapi.js'

const spec: OpenApiDoc = {
  servers: [{ url: 'https://api.weeek.net/public/v1' }],
  paths: {
    '/tm/tasks': { get: {}, post: {} },
    '/tm/tasks/{id}': { get: {} },
    '/tm/tasks/{id}/board-column': { post: {} },
  },
}

describe('specBasePath', () => {
  it('extracts the server pathname', () => {
    expect(specBasePath(spec)).toBe('/public/v1')
  })
})

describe('pathTemplateToRegex', () => {
  it('matches a concrete path against a {param} template', () => {
    expect(
      pathTemplateToRegex('/tm/tasks/{id}/board-column').test(
        '/tm/tasks/TID/board-column',
      ),
    ).toBe(true)
  })

  it('rejects a different segment count', () => {
    expect(
      pathTemplateToRegex('/tm/tasks/{id}').test('/tm/tasks/TID/board'),
    ).toBe(false)
  })
})

describe('indexOperations + matchOperation', () => {
  const idx = indexOperations(spec)

  it('matches POST /tm/tasks/{id}/board-column', () => {
    expect(
      matchOperation(idx, 'POST', '/tm/tasks/TID/board-column')?.template,
    ).toBe('/tm/tasks/{id}/board-column')
  })

  it('returns null for PUT /tm/tasks/{id} (only GET defined)', () => {
    expect(matchOperation(idx, 'PUT', '/tm/tasks/TID')).toBeNull()
  })

  it('prefers the literal /tm/tasks over a templated match', () => {
    expect(matchOperation(idx, 'GET', '/tm/tasks')?.template).toBe('/tm/tasks')
  })

  it('strips the server base path from spec path keys', () => {
    const withBase: OpenApiDoc = {
      servers: [{ url: 'https://api.weeek.net/public/v1' }],
      paths: { '/public/v1/tm/tasks': { get: {} } },
    }
    expect(
      matchOperation(indexOperations(withBase), 'GET', '/tm/tasks')?.template,
    ).toBe('/tm/tasks')
  })
})
