#!/usr/bin/env node
// plugin/hooks/detect-task-on-session.mjs
//
// SessionStart hook for claude-weeek. Detects a WEEEK task ID in the current
// git branch and emits an additionalContext suggestion for the agent. NEVER
// makes network calls. Always exits 0 — even on errors — so it cannot block
// or slow session start.

import { execFileSync } from 'node:child_process'
import process from 'node:process'

import {
  detectTaskId,
  emitContext,
  getPatterns,
  loadConfig,
} from '../lib/task-detector.mjs'

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

try {
  const inside = git(['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') process.exit(0)

  const branch = git(['symbolic-ref', '--short', 'HEAD'])
  if (!branch) process.exit(0)

  const config = loadConfig(process.cwd())
  const patterns = getPatterns(config)
  const id = detectTaskId(branch, patterns)
  if (id === null) process.exit(0)

  const message =
    `Repo branch "${branch}" references WEEEK task ${id}. ` +
    `If the user asks about this work, consider calling ` +
    `weeek_get_task({ task_id: "${id}" }) for context. ` +
    `Do not announce this proactively unless asked.`

  emitContext('SessionStart', message)
  process.exit(0)
} catch (err) {
  process.stderr.write(
    `[claude-weeek] session hook error: ${
      err instanceof Error ? err.message : String(err)
    }\n`,
  )
  process.exit(0)
}
