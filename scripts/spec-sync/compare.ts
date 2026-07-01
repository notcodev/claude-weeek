/** Pure comparison rules: a captured request vs the matching OpenAPI operation. */

import type {
  CapturedRequest,
  Finding,
  IndexedOperation,
  OpenApiSchemaObject,
} from './types.js'

import {
  matchOperation,
  queryParams,
  requestBodyRequired,
  requestBodySchema,
} from './openapi.js'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Query keys the client would actually send (it drops undefined/null). */
function definedQueryKeys(
  query: Record<string, unknown> | undefined,
): string[] {
  if (!query) return []
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k]) => k)
}

export function compareRequest(
  req: CapturedRequest,
  index: IndexedOperation[],
): Finding[] {
  const matched = matchOperation(index, req.method, req.path)
  if (!matched) {
    return [
      {
        severity: 'error',
        code: 'endpoint-missing',
        tool: req.tool,
        method: req.method,
        path: req.path,
        detail: `no ${req.method} operation matches path "${req.path}" in the spec`,
      },
    ]
  }

  const findings: Finding[] = []
  const op = matched.op

  const bodySchema = requestBodySchema(op)
  if (bodySchema && bodySchema.type !== 'array') {
    const props = bodySchema.properties ?? {}
    const required = bodySchema.required ?? []
    const addl = bodySchema.additionalProperties
    const body = isPlainObject(req.body) ? req.body : {}

    if (addl !== true) {
      for (const key of Object.keys(body)) {
        if (!(key in props)) {
          findings.push({
            severity: 'error',
            code: 'body-unknown-field',
            tool: req.tool,
            method: req.method,
            path: req.path,
            detail: `body field "${key}" is not declared in the requestBody schema`,
          })
        }
      }
    }

    if (requestBodyRequired(op) || Object.keys(body).length > 0) {
      for (const reqProp of required) {
        if (!(reqProp in body)) {
          findings.push({
            severity: 'error',
            code: 'body-missing-required',
            tool: req.tool,
            method: req.method,
            path: req.path,
            detail: `required body field "${reqProp}" is never sent by this tool`,
          })
        }
      }
    }

    for (const [key, val] of Object.entries(body)) {
      const propSchema = props[key]
      if (
        propSchema?.type === 'array' &&
        propSchema.items &&
        Array.isArray(val)
      ) {
        findings.push(
          ...checkNestedArray(req, key, propSchema.items, val),
        )
      }
    }
  }

  const qParams = queryParams(op)
  const keys = definedQueryKeys(req.query)
  if (qParams.length > 0 || keys.length > 0) {
    const names = new Set(qParams.map((p) => p.name))
    for (const k of keys) {
      if (!names.has(k)) {
        findings.push({
          severity: 'error',
          code: 'query-unknown-param',
          tool: req.tool,
          method: req.method,
          path: req.path,
          detail: `query param "${k}" is not declared on this operation`,
        })
      }
    }
    for (const p of qParams) {
      if (p.required && !keys.includes(p.name)) {
        findings.push({
          severity: 'warn',
          code: 'query-missing-required',
          tool: req.tool,
          method: req.method,
          path: req.path,
          detail: `required query param "${p.name}" is never sent by this tool`,
        })
      }
    }
  }

  return findings
}

function checkNestedArray(
  req: CapturedRequest,
  key: string,
  itemSchema: OpenApiSchemaObject,
  arr: unknown[],
): Finding[] {
  const findings: Finding[] = []
  const props = itemSchema.properties ?? {}
  const required = itemSchema.required ?? []
  const addl = itemSchema.additionalProperties
  for (const el of arr) {
    if (!isPlainObject(el)) continue
    if (addl !== true) {
      for (const k of Object.keys(el)) {
        if (!(k in props)) {
          findings.push({
            severity: 'warn',
            code: 'nested-mismatch',
            tool: req.tool,
            method: req.method,
            path: req.path,
            detail: `"${key}[].${k}" is not declared in the item schema`,
          })
        }
      }
    }
    for (const r of required) {
      if (!(r in el)) {
        findings.push({
          severity: 'warn',
          code: 'nested-mismatch',
          tool: req.tool,
          method: req.method,
          path: req.path,
          detail: `required item field "${key}[].${r}" is missing`,
        })
      }
    }
  }
  return findings
}

export function checkAll(
  captured: CapturedRequest[],
  index: IndexedOperation[],
): Finding[] {
  return captured.flatMap((req) => compareRequest(req, index))
}
