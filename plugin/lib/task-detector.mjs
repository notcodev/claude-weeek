// plugin/lib/task-detector.mjs
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const DEFAULT_PATTERNS = [
  /\bWEEEK[-_/](\d+)\b/i,
  /\bweeek[-_/](\d+)\b/i,
  /\btask[-_/](\d+)\b/i,
  /^(\d{2,})[-_/]/,
  /#(\d+)\b/,
]

export function loadConfig(cwd) {
  const start = resolve(cwd)
  const home = resolve(homedir())
  let dir = start
  while (true) {
    const candidate = join(dir, '.weeek.json')
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf8')
        return JSON.parse(raw)
      } catch (err) {
        process.stderr.write(
          `[claude-weeek] failed to parse ${candidate}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        )
        return null
      }
    }
    if (
      existsSync(join(dir, '.git')) &&
      safeIsDir(join(dir, '.git'))
    ) {
      return null
    }
    const parent = dirname(dir)
    if (parent === dir || parent === home) return null
    dir = parent
  }
}

export function getPatterns(config) {
  const raw = config?.taskIdPatterns
  if (Array.isArray(raw) && raw.length > 0) {
    const compiled = []
    for (const pat of raw) {
      try {
        compiled.push(new RegExp(pat))
      } catch {
        // Skip invalid regex silently — the schema validates these in IDEs.
      }
    }
    if (compiled.length > 0) return compiled
  }
  return DEFAULT_PATTERNS
}

export function detectTaskId(text, patterns) {
  if (typeof text !== 'string' || text.length === 0) return null
  for (const re of patterns) {
    const m = text.match(re)
    if (m && m[1]) {
      const n = Number.parseInt(m[1], 10)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

export function emitContext(eventName, message) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: message,
      },
    }),
  )
}

function safeIsDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
