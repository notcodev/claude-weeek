import { describe, expect, it } from 'vitest'

import type {
  CapturedRequest,
  OpenApiDoc,
} from '../../scripts/spec-sync/types.js'

import {
  checkAll,
  compareRequest,
} from '../../scripts/spec-sync/compare.js'
import { indexOperations } from '../../scripts/spec-sync/openapi.js'

const spec: OpenApiDoc = {
  servers: [{ url: 'https://api.weeek.net/public/v1' }],
  paths: {
    '/tm/tasks': {
      get: {
        parameters: [
          { name: 'projectId', in: 'query' },
          { name: 'limit', in: 'query', required: true },
        ],
      },
      post: {
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['locations', 'title'],
                properties: {
                  title: { type: 'string' },
                  locations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['projectId'],
                      properties: {
                        projectId: { type: 'string' },
                        boardColumnId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/tm/tasks/{id}/board-column': { post: {} },
  },
}
const index = indexOperations(spec)

function req(partial: Partial<CapturedRequest>): CapturedRequest {
  return { tool: 't', method: 'POST', path: '/tm/tasks', ...partial }
}

describe('compareRequest', () => {
  it('flags endpoint-missing for an undefined verb/path', () => {
    const f = compareRequest(
      req({
        method: 'PUT',
        path: '/tm/tasks/TID/board-column',
        body: {},
      }),
      index,
    )
    expect(f).toHaveLength(1)
    expect(f[0]?.code).toBe('endpoint-missing')
  })

  it('flags body-unknown-field', () => {
    const f = compareRequest(
      req({
        body: {
          title: 'x',
          locations: [{ projectId: 'p' }],
          bogus: 1,
        },
      }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('body-unknown-field')
  })

  it('flags body-missing-required when locations is absent', () => {
    const f = compareRequest(req({ body: { title: 'x' } }), index)
    expect(f.map((x) => x.code)).toContain('body-missing-required')
  })

  it('passes a well-formed create body', () => {
    const f = compareRequest(
      req({ body: { title: 'x', locations: [{ projectId: 'p' }] } }),
      index,
    )
    expect(f).toHaveLength(0)
  })

  it('flags nested-mismatch when an array item lacks a required field', () => {
    const f = compareRequest(
      req({
        body: { title: 'x', locations: [{ boardColumnId: 'c' }] },
      }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('nested-mismatch')
  })

  it('flags query-unknown-param', () => {
    const f = compareRequest(
      req({
        method: 'GET',
        query: { projectId: 'p', limit: 50, bad: 1 },
      }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('query-unknown-param')
  })

  it('warns query-missing-required when a required param is absent', () => {
    const f = compareRequest(
      req({ method: 'GET', query: { projectId: 'p' } }),
      index,
    )
    expect(f.map((x) => x.code)).toContain('query-missing-required')
  })

  it('ignores undefined/null query values', () => {
    const f = compareRequest(
      req({
        method: 'GET',
        query: { projectId: 'p', limit: 50, bad: undefined },
      }),
      index,
    )
    expect(f).toHaveLength(0)
  })
})

describe('checkAll', () => {
  it('flattens findings across requests', () => {
    const findings = checkAll(
      [
        req({ method: 'PUT', path: '/nope', body: {} }),
        req({
          body: { title: 'x', locations: [{ projectId: 'p' }] },
        }),
      ],
      index,
    )
    expect(findings).toHaveLength(1)
  })
})
