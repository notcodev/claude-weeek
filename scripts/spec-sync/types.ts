/** Shared types for the WEEEK spec-drift detector. */

export type HttpMethod = 'GET' | 'PATCH' | 'POST' | 'PUT'

/** A single HTTP request the code emits, captured at runtime. */
export interface CapturedRequest {
  body?: unknown
  method: HttpMethod
  path: string
  query?: Record<string, unknown>
  tool: string
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
  code: FindingCode
  detail: string
  method: HttpMethod
  path: string
  severity: Severity
  tool: string
}

/** Minimal OpenAPI shapes — only the parts the matcher touches. */
export interface OpenApiSchemaObject {
  additionalProperties?: boolean | OpenApiSchemaObject
  items?: OpenApiSchemaObject
  properties?: Record<string, OpenApiSchemaObject>
  required?: string[]
  type?: string
  [k: string]: unknown
}

export interface OpenApiParameter {
  in: string
  name: string
  required?: boolean
}

export interface OpenApiOperation {
  parameters?: OpenApiParameter[]
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: OpenApiSchemaObject }>
  }
  [k: string]: unknown
}

export interface OpenApiDoc {
  openapi?: string
  paths: Record<string, Record<string, OpenApiOperation>>
  servers?: { url: string }[]
}

export interface IndexedOperation {
  method: string
  op: OpenApiOperation
  paramCount: number
  regex: RegExp
  template: string
}
