/**
 * A stand-in for WeeekApiClient that records outgoing requests instead of
 * making them. Returns an empty object — safe for the tools' post-processing
 * (unwrapTask({}) → {}, extractArray({}, key) → []), which never throws.
 */

import type { CapturedRequest, HttpMethod } from './types.js'

export type RecordEntry = Omit<CapturedRequest, 'tool'>

export class RecordingClient {
  readonly records: RecordEntry[] = []

  private record<T>(
    method: HttpMethod,
    path: string,
    extra: { query?: Record<string, unknown>; body?: unknown },
  ): Promise<T> {
    this.records.push({ method, path, ...extra })
    return Promise.resolve({} as T)
  }

  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.record<T>('GET', path, { query })
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.record<T>('POST', path, { body })
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.record<T>('PUT', path, { body })
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.record<T>('PATCH', path, { body })
  }
}
