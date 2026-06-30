/** Shared types for the WEEEK spec-drift detector. */

export type HttpMethod = 'GET' | 'PATCH' | 'POST' | 'PUT'

/** A single HTTP request the code emits, captured at runtime. */
export interface CapturedRequest {
  tool: string
  method: HttpMethod
  path: string
  query?: Record<string, unknown>
  body?: unknown
}

export type Severity = 'error' | 'warn'

export type FindingCode =
  | 'body-missing-required'
  | 'body-unknown-field'
  | 'endpoint-missing'
  | 'nested-mismatch'
  | 'query-missing-required'
  | 'query-unknown-param'

export interface Finding {
  severity: Severity
  code: FindingCode
  tool: string
  method: HttpMethod
  path: string
  detail: string
}

/** Minimal OpenAPI shapes — only the parts the matcher touches. */
export interface OpenApiSchemaObject {
  type?: string
  properties?: Record<string, OpenApiSchemaObject>
  required?: string[]
  items?: OpenApiSchemaObject
  additionalProperties?: boolean | OpenApiSchemaObject
  [k: string]: unknown
}

export interface OpenApiParameter {
  name: string
  in: string
  required?: boolean
}

export interface OpenApiOperation {
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: OpenApiSchemaObject }>
  }
  parameters?: OpenApiParameter[]
  [k: string]: unknown
}

export interface OpenApiDoc {
  openapi?: string
  servers?: { url: string }[]
  paths: Record<string, Record<string, OpenApiOperation>>
}

export interface IndexedOperation {
  template: string
  method: string
  regex: RegExp
  paramCount: number
  op: OpenApiOperation
}
