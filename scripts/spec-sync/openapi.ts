/** OpenAPI operation indexing + concrete-path → templated-operation matching. */

import type {
  HttpMethod,
  IndexedOperation,
  OpenApiDoc,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchemaObject,
} from './types.js'

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
] as const

/** The pathname of the first server URL, e.g. "/public/v1" (no trailing slash). */
export function specBasePath(spec: OpenApiDoc): string {
  const url = spec.servers?.[0]?.url
  if (!url) return ''
  try {
    return new URL(url).pathname.replace(/\/$/, '')
  } catch {
    return url.startsWith('/') ? url.replace(/\/$/, '') : ''
  }
}

function stripBase(path: string, base: string): string {
  if (base && path.startsWith(base)) return path.slice(base.length) || '/'
  return path
}

/** Convert an OpenAPI path template into a full-match regex; {param} → one segment. */
export function pathTemplateToRegex(template: string): RegExp {
  const parts = template.split('/').map((seg) =>
    /^\{.+\}$/.test(seg)
      ? '[^/]+'
      : seg.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&'),
  )
  return new RegExp(`^${parts.join('/')}$`)
}

export function indexOperations(spec: OpenApiDoc): IndexedOperation[] {
  const base = specBasePath(spec)
  const out: IndexedOperation[] = []
  for (const [rawPath, methods] of Object.entries(spec.paths ?? {})) {
    const template = stripBase(rawPath, base)
    const paramCount = (template.match(/\{[^}]+\}/g) ?? []).length
    const regex = pathTemplateToRegex(template)
    for (const [method, op] of Object.entries(methods ?? {})) {
      if ((HTTP_METHODS as readonly string[]).includes(method.toLowerCase())) {
        out.push({
          template,
          method: method.toLowerCase(),
          regex,
          paramCount,
          op,
        })
      }
    }
  }
  return out
}

/** Find the matching operation; prefer the most specific (fewest {param}) template. */
export function matchOperation(
  index: IndexedOperation[],
  method: HttpMethod,
  path: string,
): IndexedOperation | null {
  const m = method.toLowerCase()
  const candidates = index
    .filter((e) => e.method === m && e.regex.test(path))
    .sort((a, b) => a.paramCount - b.paramCount)
  return candidates[0] ?? null
}

export function requestBodySchema(
  op: OpenApiOperation,
): OpenApiSchemaObject | null {
  return op.requestBody?.content?.['application/json']?.schema ?? null
}

export function requestBodyRequired(op: OpenApiOperation): boolean {
  return op.requestBody?.required === true
}

export function queryParams(op: OpenApiOperation): OpenApiParameter[] {
  return (op.parameters ?? []).filter((p) => p.in === 'query')
}
