/**
 * Shared helpers for Phase 2 read tools.
 *
 * - listParamsSchema: Zod schema for limit/offset enforcing DEFAULT_LIST_LIMIT=20
 *   and MAX_LIST_LIMIT=50 (INFRA-07 mitigation against 25k token cap).
 * - extractArray: tolerantly picks an array from a WEEEK API response body.
 * - jsonContent: wraps a value into the MCP text-content response shape.
 *
 * All response shapers are intentionally defensive — WEEEK API response shapes
 * are unverified, so shapers use optional chaining and tolerate missing fields.
 */
import { z } from 'zod'

import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../config.js'

export const listParamsSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(
      `Maximum number of items to return (1-${MAX_LIST_LIMIT}, default: ${DEFAULT_LIST_LIMIT}). Default protects against 25k-token MCP response cap.`,
    )
    .optional(),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of items to skip for pagination (default: 0)')
    .optional(),
}

/**
 * Extract array from a WEEEK list response. WEEEK typically wraps lists as
 * { success: true, projects: [...] } or { tasks: [...], hasMore: bool }.
 * This tolerantly picks the array from the named key, or the first array
 * value on the object as a fallback.
 */
export function extractArray<T>(body: unknown, key: string): T[] {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj[key])) return obj[key] as T[]
    // Fallback: first array value on the object
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v as T[]
    }
  }
  return []
}

/**
 * Wrap an object into the MCP text-content response shape.
 */
export function jsonContent(value: unknown) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(value, null, 2) },
    ],
  }
}

/**
 * Raw task as returned by WEEEK's /tm/tasks endpoints. Only the fields we shape
 * are typed; everything else (customFields, subscribers, workloads, timeEntries,
 * locations, subTasks, ...) is intentionally left in the index signature and
 * DROPPED by the shapers — a single task on a busy workspace carries the entire
 * workspace's custom-field schema (~80k tokens), which must never reach context.
 */
export interface RawTask {
  assignees?: Array<string>
  authorId?: string | null
  boardColumnId?: number | string
  boardId?: number | string
  date?: string | null
  dateEnd?: string | null
  dateStart?: string | null
  id?: number | string
  isCompleted?: boolean
  isDeleted?: boolean
  parentId?: number | string | null
  priority?: number | string
  projectId?: number | string
  tags?: Array<number | string>
  title?: string
  type?: string
  updatedAt?: string | null
  userId?: string | null
  [k: string]: unknown
}

/** Compact task shape used by list-oriented responses. */
export interface ShapedTask {
  /** Primary assignee (WEEEK's userId field). */
  assigneeId: string | null
  /** All assignees (WEEEK's assignees array — tasks can have multiple). */
  assigneeIds: string[]
  authorId: string | null
  boardColumnId: string | null
  boardId: string | null
  dateEnd: string | null
  dateStart: string | null
  id: string
  isCompleted: boolean
  parentId: string | null
  priority: string | null
  projectId: string | null
  tags: string[]
  title: string
  type: string | null
  updatedAt: string | null
}

/**
 * Detailed task shape for single-task responses (get/create/update/move/complete).
 * Everything in ShapedTask PLUS the task body and lifecycle timestamps — but
 * still a fixed whitelist, so the workspace-schema bloat never leaks.
 */
export interface ShapedTaskDetail extends ShapedTask {
  completedAt: string | null
  createdAt: string | null
  description: string | null
}

/** Shape a raw WEEEK task into the compact list shape. */
export function shapeTask(raw: RawTask): ShapedTask {
  const assigneeIds = Array.isArray(raw.assignees)
    ? raw.assignees.map((u) => String(u))
    : []
  const primaryAssignee =
    (raw.userId ?? null) != null
      ? String(raw.userId)
      : (assigneeIds[0] ?? null)
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    type: raw.type ?? null,
    parentId: raw.parentId == null ? null : String(raw.parentId),
    projectId: raw.projectId == null ? null : String(raw.projectId),
    boardId: raw.boardId == null ? null : String(raw.boardId),
    boardColumnId:
      raw.boardColumnId == null ? null : String(raw.boardColumnId),
    assigneeId: primaryAssignee,
    assigneeIds,
    authorId: raw.authorId == null ? null : String(raw.authorId),
    isCompleted: Boolean(raw.isCompleted),
    priority: raw.priority == null ? null : String(raw.priority),
    dateStart: raw.dateStart ?? null,
    dateEnd: raw.dateEnd ?? null,
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t))
      : [],
    updatedAt: raw.updatedAt ?? null,
  }
}

/** Shape a raw WEEEK task into the detailed single-task shape. */
export function shapeTaskDetail(raw: RawTask): ShapedTaskDetail {
  return {
    ...shapeTask(raw),
    description:
      raw.description == null ? null : String(raw.description),
    createdAt: raw.createdAt == null ? null : String(raw.createdAt),
    completedAt:
      raw.completedAt == null ? null : String(raw.completedAt),
  }
}

/**
 * Unwrap WEEEK's { task: {...} } envelope, tolerating a bare task object.
 * Returns a RawTask ready for the shapers.
 */
export function unwrapTask(raw: unknown): RawTask {
  if (raw && typeof raw === 'object' && 'task' in (raw as object)) {
    return (raw as Record<string, unknown>).task as RawTask
  }
  return (raw ?? {}) as RawTask
}
