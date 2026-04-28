#!/usr/bin/env node
// plugin/hooks/detect-task-on-commit.mjs
//
// PostToolUse hook for claude-weeek. Fires after every Bash tool call;
// filters to `git commit` invocations, extracts the task ID from the commit
// message, and emits an additionalContext suggestion. Never blocks; never
// calls the network; always exits 0.

import process from 'node:process'

import {
  detectTaskId,
  emitContext,
  getPatterns,
  loadConfig,
} from '../lib/task-detector.mjs'

function readStdin() {
  return new Promise((resolveFn) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (buf += chunk))
    process.stdin.on('end', () => resolveFn(buf))
    setTimeout(() => resolveFn(buf), 1000).unref()
  })
}

function isCommitCommand(cmd) {
  if (typeof cmd !== 'string') return false
  if (!/\bgit\s+commit\b/.test(cmd)) return false
  if (/--dry-run\b/.test(cmd)) return false
  if (/--amend\b/.test(cmd) && /--no-edit\b/.test(cmd)) return false
  return true
}

function extractCommitMessage(payload) {
  const cmd = payload?.tool_input?.command
  if (typeof cmd !== 'string') return ''
  const dq = cmd.match(/-m[ \t]+"((?:\\.|[^"\\])*)"/)
  if (dq) return dq[1]
  const sq = cmd.match(/-m[ \t]+'((?:\\.|[^'\\])*)'/)
  if (sq) return sq[1]
  const out = payload?.tool_response?.stdout
  if (typeof out === 'string') {
    const m = out.match(/^\[\S+ [a-f0-9]+\] (.*)$/m)
    if (m) return m[1]
  }
  return ''
}

;(async () => {
  try {
    const stdin = await readStdin()
    if (!stdin.trim()) process.exit(0)

    let payload
    try {
      payload = JSON.parse(stdin)
    } catch {
      process.exit(0)
    }

    if (payload?.tool_name !== 'Bash') process.exit(0)
    if (!isCommitCommand(payload?.tool_input?.command))
      process.exit(0)

    const message = extractCommitMessage(payload)
    if (!message) process.exit(0)

    const config = loadConfig(process.cwd())
    const patterns = getPatterns(config)
    const id = detectTaskId(message, patterns)
    if (id === null) process.exit(0)

    emitContext(
      'PostToolUse',
      `Commit message references WEEEK task ${id}. Suggested follow-ups: ` +
        `(a) verify status via weeek_get_task({ task_id: "${id}" }), ` +
        `(b) ask the user if they want to advance the task via /weeek-advance. ` +
        `Do NOT move the task without confirmation.`,
    )
    process.exit(0)
  } catch (err) {
    process.stderr.write(
      `[claude-weeek] commit hook error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    )
    process.exit(0)
  }
})()
