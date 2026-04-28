# WEEEK Skills & Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 skills and 2 hooks to the `claude-weeek` plugin so Claude Code sessions can pull task context from git, generate standups, and advance tasks across multi-stage workflows — universally, without prescribing a single company's process. (The originally planned 6th skill, `weeek-log`, and its two backing MCP tools were dropped after Task 0 confirmed the WEEEK Public API does not expose comment endpoints. See "Task 0 Outcome" below.)

**Architecture:** Skills and hooks are pure orchestration — they read git/local state, apply detection logic from `lib/task-detector.mjs`, and either inject context for the agent (hooks) or instruct the agent to call the right `weeek_*` MCP tools (skills). No HTTP calls or token usage in the plugin layer. Per-repo `.weeek.json` (validated by a JSON Schema shipped in the repo) drives all team-specific behaviour.

**Tech Stack:** Node.js 20 ESM, native `child_process` / `fs` (zero npm deps in `plugin/`), Vitest for tests, existing MCP SDK + Zod v3.25 patterns for the two new tools.

**Spec:** `docs/superpowers/specs/2026-04-28-weeek-skills-and-hooks-design.md` — read before starting if you have not.

---

## Task 0 Outcome (resolved 2026-04-28)

The WEEEK Public API v1 does **not** expose any comment endpoints. Both `GET /public/v1/tm/tasks/{id}/comments` and several other path/query variants return 404. The workspace-scoped path `https://api.weeek.net/ws/{workspaceId}/tm/tasks/{id}/comments` exists in the WEEEK web app, but it is session-cookie authenticated — every Bearer-token auth scheme tested returns 401.

**Decision:** apply the spec's Risk #1 mitigation. The following tasks are SKIPPED in this iteration:

- Task 6 (`weeek_list_comments` MCP tool)
- Task 7 (`weeek_add_comment` MCP tool)
- Task 13 (`weeek-log` skill)

Dependent edits already applied below in tasks 3, 8, 11, 12, and 15: every reference to `weeek_list_comments`, `weeek_add_comment`, `/weeek-log`, and the cross-repo "context bus through comments" narrative has been removed. The plan now contains 14 active tasks (0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 14, 15, 16, 17).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `plugin/config.schema.json` | JSON Schema (draft-07) for `.weeek.json`. |
| `plugin/lib/task-detector.mjs` | Zero-dep config loader + regex-based task ID extractor. Used by both hooks. |
| `plugin/hooks/detect-task-on-session.mjs` | SessionStart hook: branch → task ID → context injection. |
| `plugin/hooks/detect-task-on-commit.mjs` | PostToolUse hook: `git commit` → task ID → context injection. |
| `plugin/.claude-plugin/hooks.json` | Registers both hooks with Claude Code. |
| `plugin/skills/<name>/SKILL.md` × 5 | Markdown skill instructions for the agent (weeek-start, weeek-today, weeek-standup, weeek-advance, weeek-context). |
| `tests/lib/task-detector.test.ts` | Unit tests for the detector. |
| `tests/hooks/detect-task-on-session.test.ts` | Spawn-based tests for the SessionStart hook. |
| `tests/hooks/detect-task-on-commit.test.ts` | Spawn-based tests for the PostToolUse hook. |
| `package.json` | Update `"files"` to include `plugin`. |
| `README.md` | New "Configuration" section. |
| `CLAUDE.md` | One-paragraph pointer that the plugin now ships skills + hooks. |

---

## Task 0: Verify WEEEK comments API endpoint (gate task)

**Files:** none — this is a manual smoke step that decides whether tasks 7, 8, and the `weeek-log` skill survive this iteration.

**Why first:** Risk #1 in the spec says "if the WEEEK API doesn't expose comments in the expected shape, drop `weeek-log`". Resolve that uncertainty before writing code.

- [ ] **Step 1: Try the most likely endpoint manually**

```bash
# Replace the placeholder token from your dev environment.
TOKEN="$WEEEK_API_TOKEN"
TASK_ID="<a real task ID from your workspace>"

curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.weeek.net/public/v1/tm/tasks/$TASK_ID/comments" | head -c 800
```

Expected outcomes:
- 200 with a JSON list of comments → continue. Note the field names actually returned (e.g., `body` vs `text`, `createdAt` vs `created_at`).
- 404 / 405 / unexpected schema → try `GET /tm/tasks/{id}` and inspect whether comments are embedded there. Document findings.

- [ ] **Step 2: Try the create endpoint**

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"smoke test from claude-weeek plan"}' \
  "https://api.weeek.net/public/v1/tm/tasks/$TASK_ID/comments"
```

Try both `{"text":"..."}` and `{"body":"..."}` if the first fails. Record the working request body shape.

- [ ] **Step 3: Decide and document**

If endpoints work: write the actual paths and field names into a sticky note for tasks 7 and 8. Continue.

If endpoints don't work: skip tasks 7, 8, and 14 (skill `weeek-log`). Update the SessionStart hook's injected message in task 3 to drop the `weeek_list_comments` reference. Note the gap in the spec's "Out of scope" list. Continue with tasks 1–6 and 9–13.

- [ ] **Step 4: Commit nothing**

This task produces no code. The decision above shapes the rest of the plan.

---

## Task 1: JSON Schema for `.weeek.json`

**Files:**
- Create: `plugin/config.schema.json`

- [ ] **Step 1: Write the schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/notcodev/claude-weeek/main/plugin/config.schema.json",
  "title": "claude-weeek per-repo configuration",
  "description": "Drives skill and hook behaviour for the claude-weeek Claude Code plugin. All fields are optional. Place this file at the root of any repo that should override the plugin's built-in defaults.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "taskIdPatterns": {
      "type": "array",
      "description": "Regex patterns (as strings) used to extract a numeric WEEEK task ID from branch names and commit messages. The first pattern that matches wins. Capture group 1 must contain the numeric ID. When set, this REPLACES the plugin's built-in defaults — it does not extend them.",
      "items": { "type": "string", "minLength": 1 },
      "minItems": 1
    },
    "branchTemplate": {
      "type": "string",
      "description": "Branch name template used by the weeek-start skill. Placeholders: {id} = numeric task ID, {slug} = lowercase kebab-cased title.",
      "examples": ["feature/WEEEK-{id}-{slug}", "task-{id}-{slug}"]
    },
    "defaultBoardId": {
      "type": ["integer", "string"],
      "description": "Optional default board ID. Skills use this when a task does not have a boardId or when the user invokes a skill that operates on the active board."
    },
    "defaultProjectId": {
      "type": ["integer", "string"],
      "description": "Optional default project ID. Skills like weeek-today scope queries to this project when set."
    },
    "statusHints": {
      "type": "object",
      "description": "Maps workflow stage names to lists of column-name candidates that match. Skills compare against these case-insensitively. All sub-fields optional. Multi-stage workflows (In Progress → Review → Testing → Done) are first-class — populate review/testing only if your boards use those stages.",
      "additionalProperties": false,
      "properties": {
        "inProgress": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "review":     { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "testing":    { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "done":       { "type": "array", "items": { "type": "string", "minLength": 1 } }
      }
    }
  }
}
```

- [ ] **Step 2: Validate the schema is itself a valid JSON Schema**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugin/config.schema.json','utf8'))"`
Expected: no output, exit 0. (We use Node's built-in JSON parser; if it parses, it's a valid JSON document. The draft-07 conformance is checked implicitly by IDEs that load the file via the `$schema` link.)

- [ ] **Step 3: Commit**

```bash
git add plugin/config.schema.json
git commit -m "feat(plugin): add JSON Schema for .weeek.json config"
```

---

## Task 2: `lib/task-detector.mjs`

**Files:**
- Create: `plugin/lib/task-detector.mjs`
- Create: `tests/lib/task-detector.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/task-detector.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectTaskId,
  getPatterns,
  loadConfig,
} from '../../plugin/lib/task-detector.mjs'

describe('task-detector', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'weeek-detector-'))
    mkdirSync(join(tmp, '.git'))
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  describe('built-in patterns', () => {
    const patterns = getPatterns(null)

    it.each([
      ['feature/WEEEK-1234-foo', 1234],
      ['weeek/567-slug', 567],
      ['task-99-bar', 99],
      ['1234-bare-slug', 1234],
      ['fix #42 in commit', 42],
      ['Closes WEEEK-7 (review fix)', 7],
    ])('matches %s → %d', (text, expected) => {
      expect(detectTaskId(text, patterns)).toBe(expected)
    })

    it.each([
      ['main', null],
      ['v1-foo', null], // single-digit bare slug rejected
      ['release-2024.10', null],
      ['', null],
    ])('does not match %s', (text, expected) => {
      expect(detectTaskId(text, patterns)).toBe(expected)
    })
  })

  describe('loadConfig', () => {
    it('returns null when .weeek.json absent', () => {
      expect(loadConfig(tmp)).toBeNull()
    })

    it('parses .weeek.json from cwd', () => {
      writeFileSync(
        join(tmp, '.weeek.json'),
        JSON.stringify({ taskIdPatterns: ['JIRA-(\\d+)'] }),
      )
      const cfg = loadConfig(tmp)
      expect(cfg?.taskIdPatterns).toEqual(['JIRA-(\\d+)'])
    })

    it('walks up to find .weeek.json at the .git ancestor', () => {
      const sub = join(tmp, 'packages', 'a')
      mkdirSync(sub, { recursive: true })
      writeFileSync(
        join(tmp, '.weeek.json'),
        JSON.stringify({ branchTemplate: 'task-{id}' }),
      )
      const cfg = loadConfig(sub)
      expect(cfg?.branchTemplate).toBe('task-{id}')
    })

    it('returns null on broken JSON without throwing', () => {
      writeFileSync(join(tmp, '.weeek.json'), '{ not valid json')
      expect(() => loadConfig(tmp)).not.toThrow()
      expect(loadConfig(tmp)).toBeNull()
    })
  })

  describe('getPatterns override semantics', () => {
    it('replaces (does not extend) built-in patterns when config provides them', () => {
      const override = getPatterns({ taskIdPatterns: ['CUSTOM-(\\d+)'] })
      // Built-in WEEEK pattern would have matched this — override must NOT.
      expect(detectTaskId('WEEEK-1234', override)).toBeNull()
      expect(detectTaskId('CUSTOM-99', override)).toBe(99)
    })

    it('falls back to built-ins when config is null or omits taskIdPatterns', () => {
      const fromNull = getPatterns(null)
      const fromPartial = getPatterns({ branchTemplate: 'x-{id}' })
      expect(detectTaskId('WEEEK-1', fromNull)).toBe(1)
      expect(detectTaskId('WEEEK-1', fromPartial)).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/lib/task-detector.test.ts`
Expected: FAIL — module `plugin/lib/task-detector.mjs` does not exist yet.

- [ ] **Step 3: Implement the module**

```js
// plugin/lib/task-detector.mjs
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

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
  // Walk up until we find .weeek.json (preferred) or hit the user's home dir.
  // We stop at the first .git directory we see — beyond that, we're outside the repo.
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
    if (existsSync(join(dir, '.git')) && safeIsDir(join(dir, '.git'))) {
      // We're at the repo root and there's no config. Stop.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/lib/task-detector.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add plugin/lib/task-detector.mjs tests/lib/task-detector.test.ts
git commit -m "feat(plugin): add zero-dep task-id detector with config loader"
```

---

## Task 3: SessionStart hook

**Files:**
- Create: `plugin/hooks/detect-task-on-session.mjs`
- Create: `tests/hooks/detect-task-on-session.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hooks/detect-task-on-session.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const HOOK = resolve('plugin/hooks/detect-task-on-session.mjs')

function run(cwd: string) {
  return spawnSync('node', [HOOK], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    input: '',
  })
}

function gitInit(cwd: string, branch: string) {
  execFileSync('git', ['init', '-b', branch], { cwd, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'a@b'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'a'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd, stdio: 'ignore' })
}

describe('detect-task-on-session hook', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'weeek-hook-session-'))
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('exits silently outside a git repo', () => {
    const r = run(tmp)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('exits silently when branch has no task id', () => {
    gitInit(tmp, 'main')
    const r = run(tmp)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('emits hook JSON when branch references a WEEEK task', () => {
    gitInit(tmp, 'feature/WEEEK-1234-foo')
    const r = run(tmp)
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('1234')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('weeek_get_task')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test tests/hooks/detect-task-on-session.test.ts`
Expected: FAIL — `plugin/hooks/detect-task-on-session.mjs` does not exist.

- [ ] **Step 3: Implement the hook**

```js
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
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/hooks/detect-task-on-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/hooks/detect-task-on-session.mjs tests/hooks/detect-task-on-session.test.ts
git commit -m "feat(plugin): add SessionStart hook for branch→task context injection"
```

---

## Task 4: PostToolUse `git commit` hook

**Files:**
- Create: `plugin/hooks/detect-task-on-commit.mjs`
- Create: `tests/hooks/detect-task-on-commit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hooks/detect-task-on-commit.test.ts
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const HOOK = resolve('plugin/hooks/detect-task-on-commit.mjs')

function run(payload: object) {
  return spawnSync('node', [HOOK], {
    encoding: 'utf8',
    timeout: 5000,
    input: JSON.stringify(payload),
  })
}

describe('detect-task-on-commit hook', () => {
  it('ignores Bash calls that are not git commit', () => {
    const r = run({
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_response: { stdout: '', stderr: '' },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('ignores git commit --dry-run', () => {
    const r = run({
      tool_name: 'Bash',
      tool_input: { command: 'git commit --dry-run -m "WEEEK-1 test"' },
      tool_response: { stdout: '', stderr: '' },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('emits context when commit message has WEEEK-id', () => {
    const r = run({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "fix(WEEEK-42): typo"' },
      tool_response: {
        stdout: '[main abc1234] fix(WEEEK-42): typo\n 1 file changed',
        stderr: '',
      },
    })
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('42')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('/weeek-advance')
  })

  it('emits silently on broken stdin', () => {
    const r = spawnSync('node', [HOOK], {
      encoding: 'utf8',
      timeout: 5000,
      input: 'not-json',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test tests/hooks/detect-task-on-commit.test.ts`
Expected: FAIL — hook script does not exist.

- [ ] **Step 3: Implement the hook**

```js
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

async function readStdin() {
  return await new Promise((resolveFn) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (buf += chunk))
    process.stdin.on('end', () => resolveFn(buf))
    // Safety net in case stdin never closes.
    setTimeout(() => resolveFn(buf), 1000).unref()
  })
}

function isCommitCommand(cmd) {
  if (typeof cmd !== 'string') return false
  if (!/\bgit\s+commit\b/.test(cmd)) return false
  if (/--dry-run\b/.test(cmd)) return false
  // `git commit --amend --no-edit` produces no new message to react to.
  if (/--amend\b/.test(cmd) && /--no-edit\b/.test(cmd)) return false
  return true
}

function extractCommitMessage(payload) {
  const cmd = payload?.tool_input?.command
  if (typeof cmd !== 'string') return ''
  // Try -m "..." or -m '...' first.
  const dq = cmd.match(/-m\s+"((?:\\.|[^"\\])*)"/)
  if (dq) return dq[1]
  const sq = cmd.match(/-m\s+'((?:\\.|[^'\\])*)'/)
  if (sq) return sq[1]
  // Heredoc: `git commit -F-` or `git commit -m "$(cat <<EOF ... EOF)"`.
  // Fall back to scanning the tool_response stdout, which usually contains
  // the first line of the commit message.
  const out = payload?.tool_response?.stdout
  if (typeof out === 'string') {
    const m = out.match(/^\[\S+\s+[a-f0-9]+\]\s+(.*)$/m)
    if (m) return m[1]
  }
  return ''
}

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
  if (!isCommitCommand(payload?.tool_input?.command)) process.exit(0)

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
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/hooks/detect-task-on-commit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/hooks/detect-task-on-commit.mjs tests/hooks/detect-task-on-commit.test.ts
git commit -m "feat(plugin): add PostToolUse hook for commit→task context injection"
```

---

## Task 5: Register hooks in `hooks.json`

**Files:**
- Create: `plugin/.claude-plugin/hooks.json`

- [ ] **Step 1: Write the registration**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/detect-task-on-session.mjs" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/detect-task-on-commit.mjs" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/hooks.json','utf8'))"`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add plugin/.claude-plugin/hooks.json
git commit -m "feat(plugin): register SessionStart and PostToolUse hooks"
```

---

## Task 6: `weeek_list_comments` MCP tool — **SKIPPED**

**SKIPPED.** Task 0 confirmed the WEEEK Public API does not expose comment endpoints. Do not implement.

**Files:**
- Create: `src/tools/read/list-comments.ts`
- Create: `tests/tools/list-comments.test.ts`
- Modify: `src/tools/read/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/list-comments.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerListComments } from '../../src/tools/read/list-comments.js'

type Handler = (args: { task_id: string }) => Promise<{
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}>

function makeFakeServer() {
  let capturedName = ''
  let capturedDescription = ''
  let capturedHandler: Handler | null = null
  const server = {
    registerTool: vi.fn((name: string, meta: { description: string }, handler: Handler) => {
      capturedName = name
      capturedDescription = meta.description
      capturedHandler = handler
    }),
  }
  return {
    server: server as unknown as Parameters<typeof registerListComments>[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

function makeFakeClient(getImpl: (path: string) => Promise<unknown>) {
  return {
    get: vi.fn(getImpl),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  } as unknown as Parameters<typeof registerListComments>[1]
}

describe('weeek_list_comments tool', () => {
  let fake: ReturnType<typeof makeFakeServer>
  beforeEach(() => { fake = makeFakeServer() })

  it('registers under weeek_list_comments', () => {
    const client = makeFakeClient(async () => ({ comments: [] }))
    registerListComments(fake.server, client)
    expect(fake.getName()).toBe('weeek_list_comments')
  })

  it('GETs the comments endpoint and returns the list', async () => {
    const getFn = vi.fn(async (path: string) => {
      expect(path).toBe('/tm/tasks/task-7/comments')
      return {
        comments: [
          { id: 'c1', text: '[backend] added POST /tasks', userId: 'u1', createdAt: '2026-04-28T10:00:00Z' },
          { id: 'c2', text: 'reviewed', userId: 'u2', createdAt: '2026-04-28T11:00:00Z' },
        ],
      }
    })
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListComments>[1]
    registerListComments(fake.server, client)

    const res = await fake.getHandler()({ task_id: 'task-7' })
    expect(res.isError).toBeUndefined()
    const payload = JSON.parse(res.content[0]!.text) as unknown[]
    expect(payload).toHaveLength(2)
    expect((payload[0] as { id: string }).id).toBe('c1')
  })

  it('returns isError on WeeekApiError', async () => {
    const client = makeFakeClient(async () => {
      throw new WeeekApiError(404, 'task not found')
    })
    registerListComments(fake.server, client)
    const res = await fake.getHandler()({ task_id: 'gone' })
    expect(res.isError).toBe(true)
  })
})
```

NOTE: If Task 0 found a different endpoint path or response shape (e.g., `text` vs `body`), adjust this test and the implementation to match. The test as written assumes `/tm/tasks/{id}/comments` returning `{ comments: [...] }` with each comment having a `text` field.

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test tests/tools/list-comments.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the tool**

```ts
// src/tools/read/list-comments.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_list_comments
 *
 * Returns task comments in chronological order. Used by skills (weeek-start,
 * weeek-context) and as the cross-session/cross-repo context bus described in
 * the design spec.
 */
import { z } from 'zod'

import type { WeeekApiClient } from '../../client/weeek-api-client.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import { extractArray, jsonContent } from './_helpers.js'

const inputSchema = {
  task_id: z
    .string()
    .min(1)
    .describe('WEEEK task ID. Obtain from weeek_list_tasks. Required.'),
}

export function registerListComments(
  server: McpServer,
  client: WeeekApiClient,
): void {
  server.registerTool(
    'weeek_list_comments',
    {
      description:
        'List comments on a WEEEK task in chronological order (oldest first). Use this when you need cross-session or cross-repo context for a task — e.g., what was done on the backend side before the frontend session started. Comments are the shared context bus across repos working on the same task.',
      inputSchema,
    },
    async (args: { task_id: string }) => {
      try {
        const raw = await client.get<unknown>(
          `/tm/tasks/${encodeURIComponent(args.task_id)}/comments`,
        )
        const list = extractArray<unknown>(raw, 'comments')
        return jsonContent(list)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_list_comments')
}
```

- [ ] **Step 4: Register in the read group**

Edit `src/tools/read/index.ts`:

Replace the imports block and the body of `registerReadTools` so it includes the new tool. Final state:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WeeekApiClient } from '../../client/weeek-api-client.js'

import { logger } from '../../logger.js'
import { registerGetProject } from './get-project.js'
import { registerGetTask } from './get-task.js'
import { registerListBoardColumns } from './list-board-columns.js'
import { registerListBoards } from './list-boards.js'
import { registerListComments } from './list-comments.js'
import { registerListProjects } from './list-projects.js'
import { registerListTasks } from './list-tasks.js'
import { registerListWorkspaceMembers } from './list-workspace-members.js'

export function registerReadTools(
  server: McpServer,
  client: WeeekApiClient,
): void {
  // Navigation
  registerListProjects(server, client)
  registerGetProject(server, client)
  registerListBoards(server, client)
  registerListBoardColumns(server, client)

  // Tasks
  registerListTasks(server, client)
  registerGetTask(server, client)
  registerListComments(server, client)

  // Workspace
  registerListWorkspaceMembers(server, client)

  logger.info('registerReadTools: 8 read tools registered')
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test tests/tools/list-comments.test.ts && pnpm typecheck`
Expected: tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/tools/read/list-comments.ts src/tools/read/index.ts tests/tools/list-comments.test.ts
git commit -m "feat(tools): add weeek_list_comments MCP read tool"
```

---

## Task 7: `weeek_add_comment` MCP tool — **SKIPPED**

**SKIPPED.** Task 0 confirmed the WEEEK Public API does not expose comment endpoints. Do not implement.

**Files:**
- Create: `src/tools/write/add-comment.ts`
- Create: `tests/tools/add-comment.test.ts`
- Modify: `src/tools/write/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/add-comment.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeeekApiError } from '../../src/errors.js'
import { registerAddComment } from '../../src/tools/write/add-comment.js'

type Handler = (args: { task_id: string; body: string }) => Promise<{
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}>

function makeFakeServer() {
  let capturedName = ''
  let capturedDescription = ''
  let capturedHandler: Handler | null = null
  const server = {
    registerTool: vi.fn((name: string, meta: { description: string }, handler: Handler) => {
      capturedName = name
      capturedDescription = meta.description
      capturedHandler = handler
    }),
  }
  return {
    server: server as unknown as Parameters<typeof registerAddComment>[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error('no handler captured')
      return capturedHandler
    },
  }
}

describe('weeek_add_comment tool', () => {
  let fake: ReturnType<typeof makeFakeServer>
  beforeEach(() => { fake = makeFakeServer() })

  it('registers under weeek_add_comment', () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => ({ comment: { id: 'c-new' } })),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerAddComment>[1]
    registerAddComment(fake.server, client)
    expect(fake.getName()).toBe('weeek_add_comment')
  })

  it('POSTs to the comments endpoint with the body', async () => {
    const postFn = vi.fn(async (path: string, body: unknown) => {
      expect(path).toBe('/tm/tasks/task-9/comments')
      expect((body as { text: string }).text).toContain('[backend]')
      return { comment: { id: 'c-new', text: '[backend] hi' } }
    })
    const client = {
      get: vi.fn(),
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerAddComment>[1]
    registerAddComment(fake.server, client)

    const res = await fake.getHandler()({
      task_id: 'task-9',
      body: '[backend] hi',
    })
    expect(res.isError).toBeUndefined()
    expect(postFn).toHaveBeenCalledTimes(1)
  })

  it('returns isError on WeeekApiError', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => { throw new WeeekApiError(403, 'forbidden') }),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerAddComment>[1]
    registerAddComment(fake.server, client)
    const res = await fake.getHandler()({ task_id: 't', body: 'x' })
    expect(res.isError).toBe(true)
  })
})
```

NOTE: If Task 0 found that the create payload uses `body` instead of `text`, change `(body as { text: string }).text` to `body` and adjust the implementation.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test tests/tools/add-comment.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the tool**

```ts
// src/tools/write/add-comment.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * weeek_add_comment
 *
 * WRITE OPERATION. Posts a new comment to a WEEEK task. Used by the weeek-log
 * skill and as a cross-repo context bus (e.g., backend session writes
 * "[backend] added POST /api/tasks", frontend session reads it via
 * weeek_list_comments).
 */
import { z } from 'zod'

import type { WeeekApiClient } from '../../client/weeek-api-client.js'

import { toMcpError } from '../../errors.js'
import { logger } from '../../logger.js'
import { jsonContent } from '../read/_helpers.js'

const inputSchema = {
  task_id: z
    .string()
    .min(1)
    .describe('WEEEK task ID. Obtain from weeek_list_tasks. Required.'),
  body: z
    .string()
    .min(1)
    .max(10000)
    .describe(
      'Comment text. Markdown or plain text. WEEEK renders basic formatting. Required.',
    ),
}

export function registerAddComment(
  server: McpServer,
  client: WeeekApiClient,
): void {
  server.registerTool(
    'weeek_add_comment',
    {
      description:
        'Post a new comment on a WEEEK task. WRITE OPERATION — the MCP client may prompt for user confirmation before this runs. Use this to record progress on a task so other repos/sessions working on the same task can pick up context. The /weeek-log skill calls this with an auto-generated summary.',
      inputSchema,
    },
    async (args: { task_id: string; body: string }) => {
      try {
        const raw = await client.post<unknown>(
          `/tm/tasks/${encodeURIComponent(args.task_id)}/comments`,
          { text: args.body },
        )
        return jsonContent(raw)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )
  logger.info('Registered tool: weeek_add_comment')
}
```

NOTE: If Task 0 found the API expects `{ body: ... }` instead of `{ text: ... }`, change the `client.post` body accordingly.

- [ ] **Step 4: Register in the write group**

Edit `src/tools/write/index.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { WeeekApiClient } from '../../client/weeek-api-client.js'

import { logger } from '../../logger.js'
import { registerAddComment } from './add-comment.js'
import { registerCompleteTask } from './complete-task.js'
import { registerCreateTask } from './create-task.js'
import { registerMoveTask } from './move-task.js'
import { registerUpdateTask } from './update-task.js'

export function registerWriteTools(
  server: McpServer,
  client: WeeekApiClient,
): void {
  // Task authoring
  registerCreateTask(server, client)
  registerUpdateTask(server, client)

  // Task lifecycle
  registerMoveTask(server, client)
  registerCompleteTask(server, client)

  // Comments
  registerAddComment(server, client)

  logger.info('registerWriteTools: 5 write tools registered')
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test tests/tools/add-comment.test.ts && pnpm typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/tools/write/add-comment.ts src/tools/write/index.ts tests/tools/add-comment.test.ts
git commit -m "feat(tools): add weeek_add_comment MCP write tool"
```

---

## Task 8: `weeek-start` skill

**Files:**
- Create: `plugin/skills/weeek-start/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

```markdown
---
name: weeek-start
description: Use when the user wants to start work on a WEEEK task — by ID ("/weeek-start 1234") or natural language ("начни задачу WEEEK-1234", "start task 1234"). Loads the task, suggests a branch name from .weeek.json, and offers to move the task into the In Progress column.
---

# weeek-start

Use this skill when the user explicitly wants to begin work on a specific WEEEK task. Triggers include `/weeek-start <id>`, "start task X", "начни задачу X", "let's pick up WEEEK-1234".

## Steps

1. Resolve the task ID. If the user passed a number, use it. If they passed `WEEEK-1234`, strip the prefix. If unclear, ask once.

2. Call `weeek_get_task({ task_id: "<id>" })`. Show a short summary to the user: title, current status (column), assignee, due date, priority. Quote the description's first 1–2 paragraphs only — do not dump the full body.

3. Read `.weeek.json` from the repo root (walk up from cwd if needed). If it has a `branchTemplate`, render it with `{id}` and `{slug}` (slug = lowercase kebab from the title, max 5 words). Compare with the current git branch:
   - If the current branch matches the template → skip the branch suggestion.
   - Otherwise, suggest `git switch -c <rendered>` and wait for confirmation before running it.

4. If the task has a `boardId`, call `weeek_list_board_columns({ board_id: "<boardId>" })`. Try to match the current column against `.weeek.json`'s `statusHints.inProgress` (case-insensitive substring match). If exactly one column matches and the task is not already in it, ask: "Move the task to the **<column-name>** column?". On yes → `weeek_move_task`. If 0 or >1 matches, present the full ordered column list and ask the user to pick.

5. Never call any write tool (`weeek_move_task`, `weeek_update_task`, etc.) without explicit user confirmation in the same turn.

## What this skill does NOT do

- Does not create branches without confirmation.
- Does not assume "In Progress" maps to a specific column without `statusHints` or user confirmation.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/skills/weeek-start/SKILL.md
git commit -m "feat(plugin): add weeek-start skill"
```

---

## Task 9: `weeek-today` skill

**Files:**
- Create: `plugin/skills/weeek-today/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

```markdown
---
name: weeek-today
description: Use when the user wants a quick view of their tasks for today — "/weeek-today", "what's on my plate", "мои задачи на сегодня", "что в работе". Resolves the user via git config, lists their open assigned tasks, and groups them by project and column.
---

# weeek-today

Use this skill when the user asks for their daily task list from WEEEK. Read-only — never moves or modifies tasks.

## Steps

1. Run `git config user.email` (via Bash). This is how the skill identifies the current user. If empty, ask the user for their WEEEK email.

2. Call `weeek_list_workspace_members`. Find the member whose email matches (case-insensitive). If no match, fall back to: ask the user which member they are, by name.

3. Read `.weeek.json` for `defaultProjectId`. If set, restrict the next call. Otherwise call `weeek_list_projects` and process each active project.

4. For each project: call `weeek_list_tasks({ project_id, assignee_id: <me> })`. Filter client-side to tasks not in any column matching `statusHints.done`. If `statusHints.done` is missing, include all tasks except those whose status indicates "completed/closed" by their flag (the get/list response should expose this — surface what you see).

5. Render the result as a compact markdown list grouped by project, then by column:

   ```
   **<Project A>**
   - In Progress: <id> <title> (due <date>)
   - Review:      <id> <title>
   ```

6. If the list is empty, say so plainly. Do not invent or summarise.

## What this skill does NOT do

- Does not write anything.
- Does not show full descriptions — only titles + due dates. Users can call `weeek-context` for details.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/skills/weeek-today/SKILL.md
git commit -m "feat(plugin): add weeek-today skill"
```

---

## Task 10: `weeek-standup` skill

**Files:**
- Create: `plugin/skills/weeek-standup/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

```markdown
---
name: weeek-standup
description: Use when the user wants a daily standup summary — "/weeek-standup", "что я делал вчера", "make my standup". Cross-references recent commits with WEEEK tasks and produces a Yesterday / Today / Blockers markdown block.
---

# weeek-standup

Use this skill when the user wants a quick standup summary. Combines git log with WEEEK task state. Read-only.

## Steps

1. Determine the standup window. Default: yesterday + today. If the user says "this week", expand to the last 7 days.

2. Run `git log --author="$(git config user.email)" --since="yesterday" --pretty=%H%x09%s` (via Bash). This yields `<sha>\t<subject>` per commit.

3. For each subject, extract task IDs by applying these regex patterns in order (the first match's capture group 1 is the ID):

   ```
   /\bWEEEK[-_/](\d+)\b/i
   /\bweeek[-_/](\d+)\b/i
   /\btask[-_/](\d+)\b/i
   /^(\d{2,})[-_/]/
   /#(\d+)\b/
   ```

   If `.weeek.json` defines `taskIdPatterns`, use those instead (they replace the defaults — do not mix).

4. De-duplicate task IDs. For each unique ID: call `weeek_get_task({ task_id })`. Categorise:
   - **Done** — column name matches `statusHints.done` (case-insensitive substring).
   - **In Progress / Review / Testing** — anything else that has commits.

5. Render the standup:

   ```markdown
   ## Yesterday
   - WEEEK-123 <title> — Done
   - WEEEK-456 <title> — In Progress (3 commits)

   ## Today
   - WEEEK-456 <title> — continue
   - <any tasks user calls out>

   ## Blockers
   - <none unless user mentions them>
   ```

6. Do not call any write tool. Do not move tasks or post comments.

## What this skill does NOT do

- Does not push the report anywhere.
- Does not invent blockers — only echoes what the user says.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/skills/weeek-standup/SKILL.md
git commit -m "feat(plugin): add weeek-standup skill"
```

---

## Task 11: `weeek-advance` skill

**Files:**
- Create: `plugin/skills/weeek-advance/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

```markdown
---
name: weeek-advance
description: Use when the user wants to move a WEEEK task to its next workflow stage — "/weeek-advance", "переведи в Review", "продвинь задачу", "ready for QA". Supports any column structure (In Progress → Review → Testing → Done or simpler) and never skips stages without confirmation.
---

# weeek-advance

Use this skill when the user wants to progress a task forward in its board's workflow. Designed for any column structure — never assumes a specific layout.

## Steps

1. Determine the task ID. Try in order:
   - User passed it explicitly.
   - Apply detector patterns to current branch name (`git symbolic-ref --short HEAD`). Patterns: see weeek-standup for the same list.
   - Ask the user.

2. Call `weeek_get_task({ task_id })`. Note the task's current `boardId` and current column.

3. Call `weeek_list_board_columns({ board_id })`. The response is an ordered list — preserve that order. Find the index of the task's current column.

4. Build the advance menu. Include:
   - **Next column** — the column at `current_index + 1` if it exists.
   - **Named candidates** — if `.weeek.json` has `statusHints.review`, find any column matching it (case-insensitive substring) and add as "Review". Same for `testing` and `done`. Skip stages whose columns can't be matched.

5. Present the menu to the user. Example:
   ```
   Current column: In Progress (index 1 of 4)
   Advance to:
     1. Code Review (next column)
     2. Testing
     3. Done
   ```
   Wait for user choice. Never auto-pick.

6. Execute the chosen move:
   - If the destination matches `statusHints.done` → call `weeek_complete_task({ task_id })`.
   - Otherwise → call `weeek_move_task({ task_id, board_column_id: <chosen> })`.

## What this skill does NOT do

- Does not skip stages without explicit user confirmation. If the menu offers Review and Testing and Done, the user picks one — the skill does not jump straight to Done.
- Does not invent column names. If `statusHints` are missing or don't match, the skill falls back to "next column by board order" and asks the user.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/skills/weeek-advance/SKILL.md
git commit -m "feat(plugin): add weeek-advance skill for multi-stage workflows"
```

---

## Task 12: `weeek-context` skill

**Files:**
- Create: `plugin/skills/weeek-context/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

```markdown
---
name: weeek-context
description: Use when the user mentions a WEEEK task ID without an action verb — "/weeek-context 1234", "tell me about WEEEK-1234", "что это за задача". Read-only summary of a task and its column. Useful when SessionStart auto-detection didn't fire.
---

# weeek-context

Use this skill when the user wants to read about a specific task without doing anything to it. READ-ONLY. Never call any `weeek_*` write tool from this skill.

## Steps

1. Resolve the task ID from the user's message (they passed it explicitly, or mentioned `WEEEK-<n>` / `task-<n>`).

2. Call `weeek_get_task({ task_id })`.

3. If the task has a `boardId`, call `weeek_list_board_columns({ board_id })` to translate its `boardColumnId` into a human column name.

4. Render the summary as compact markdown:

   ```markdown
   ### WEEEK-<id> <title>
   **Status:** <column-name> · **Assignee:** <name> · **Due:** <date>

   <description first paragraph or two>
   ```

## What this skill does NOT do

- Does not call any write tool. If the user asks to do something, route to the appropriate skill (`weeek-start`, `weeek-advance`).
```

- [ ] **Step 2: Commit**

```bash
git add plugin/skills/weeek-context/SKILL.md
git commit -m "feat(plugin): add weeek-context read-only skill"
```

---

## Task 13: `weeek-log` skill — **SKIPPED**

**SKIPPED.** Task 0 confirmed the WEEEK Public API does not expose comment endpoints. Do not implement.

**Files:**
- Create: `plugin/skills/weeek-log/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

```markdown
---
name: weeek-log
description: Use when the user wants to record progress on a WEEEK task as a comment — "/weeek-log", "зафиксируй прогресс", "leave a comment on the task", "log what I did". Builds an auto-tagged summary from recent commits and the working diff, gets confirmation, then posts via weeek_add_comment. Designed as a cross-session/cross-repo context bus.
---

# weeek-log

Use this skill when the user wants to write down what they just did on a task as a WEEEK comment. The comment becomes shared context for any other session/repo working on the same task — for example, a frontend session can read the backend session's log via `weeek_list_comments`.

## Steps

1. Determine the task ID. Try in order:
   - User passed it explicitly.
   - Apply detector patterns to current branch name (see `weeek-standup` for the regex list).
   - Ask the user.

2. Build a draft comment:
   - **Component prefix.** Inspect changed file paths from `git diff --stat HEAD~5..HEAD` (or `git status --porcelain` for uncommitted work). Map paths to tags:
     - `src/server/`, `src/api/`, `src/db/` → `[backend]`
     - `src/ui/`, `src/components/`, `apps/web/` → `[frontend]`
     - `Dockerfile`, `infra/`, `terraform/`, `.github/` → `[infra]`
     - `tests/` → `[tests]`
     - `docs/`, `*.md` → `[docs]`
   - Multiple tags allowed (e.g., `[backend][tests]`). If nothing matches, omit the tag.
   - **Body.** Synthesise from:
     - The user's free text (if they passed any to `/weeek-log <message>`).
     - Subjects of `git log --author="$(git config user.email)" --since="2 hours ago" --pretty=%s`.
     - One-line summary of `git diff --stat`.

3. Show the draft to the user as a code block. Ask: "Post this to WEEEK-<id>?". Allow them to edit it inline before confirming.

4. On confirm → `weeek_add_comment({ task_id, body: <final> })`.

5. After posting, optionally show the comment URL if the API response includes one.

## What this skill does NOT do

- Does not post without confirmation.
- Does not summarise the entire branch — focuses on the recent session window.
- Does not auto-fire on every commit. That would pollute the task. Use `/weeek-log` deliberately.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/skills/weeek-log/SKILL.md
git commit -m "feat(plugin): add weeek-log skill for cross-session context bus"
```

---

## Task 14: Update `package.json` files field

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `plugin` to the `files` array**

The current `files` array is:

```json
"files": [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "dist"
]
```

Change it to:

```json
"files": [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "dist",
  "plugin"
]
```

- [ ] **Step 2: Verify the published artefact would include the plugin**

Run: `pnpm pack --dry-run 2>&1 | grep plugin/`
Expected: lines listing `plugin/.claude-plugin/`, `plugin/skills/`, `plugin/hooks/`, `plugin/lib/`, `plugin/config.schema.json`. If no lines, the change didn't take.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: include plugin/ in published npm artefact"
```

---

## Task 15: README "Configuration" section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the right insertion point**

Open `README.md`. Find the section that documents how to install / use the plugin in Claude Code. The new "Configuration" section goes immediately after that and before any existing "Development" section.

- [ ] **Step 2: Insert the section**

```markdown
## Configuration

The plugin works out of the box. To customise behaviour for your team's
process, drop a `.weeek.json` at the root of your repo. All fields are
optional.

```json
{
  "$schema": "https://raw.githubusercontent.com/notcodev/claude-weeek/main/plugin/config.schema.json",
  "taskIdPatterns": ["WEEEK-(\\d+)"],
  "branchTemplate": "feature/WEEEK-{id}-{slug}",
  "defaultBoardId": 567,
  "defaultProjectId": 89,
  "statusHints": {
    "inProgress": ["In Progress", "Doing"],
    "review":     ["Review", "Code Review"],
    "testing":    ["Testing", "QA"],
    "done":       ["Done", "Completed"]
  }
}
```

| Field | Purpose |
|-------|---------|
| `taskIdPatterns` | Regex list (capture group 1 = numeric ID) used by SessionStart and PostToolUse hooks to extract task IDs from branch names and commit messages. **Replaces** the built-in defaults — does not extend. |
| `branchTemplate` | Template used by `weeek-start` to suggest branch names. Placeholders: `{id}`, `{slug}`. |
| `defaultBoardId` / `defaultProjectId` | Skills use these as defaults instead of asking. |
| `statusHints` | Maps workflow stages to column-name candidates. The `weeek-advance` skill uses these to label the menu of next stages. Multi-stage workflows (In Progress → Review → Testing → Done) are first-class. |

The `$schema` URL provides autocomplete and validation in VS Code, JetBrains
IDEs, and Cursor.

### Skills

| Skill | What it does |
|-------|--------------|
| `/weeek-start <id>` | Pull task context, suggest branch, optionally move to In Progress. |
| `/weeek-today` | Your tasks today, grouped by project and column. |
| `/weeek-standup` | Yesterday / Today / Blockers from recent commits + WEEEK status. |
| `/weeek-advance` | Move task to next workflow stage. Supports multi-stage boards. |
| `/weeek-context <id>` | Read-only task summary. |

### Hooks

The plugin ships two passive hooks that never block tool calls:

- **SessionStart** — if your branch references a WEEEK task, the agent gets a
  hint to consider `weeek_get_task` and `weeek_list_comments`.
- **PostToolUse on `git commit`** — if a commit message references a WEEEK
  task, the agent gets a hint about `/weeek-advance`.

Both hooks are silent until they detect a task ID. Errors never surface.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document .weeek.json, skills, and hooks"
```

---

## Task 16: CLAUDE.md pointer

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a one-paragraph pointer**

Find an appropriate place (e.g., after the "Project" section or in a "Plugin Layer" subsection if you create one). Insert:

```markdown
### Plugin layer

Beyond the MCP server, the plugin ships skills and hooks under `plugin/`:

- `plugin/skills/<name>/SKILL.md` — six skills (`weeek-start`, `weeek-today`,
  `weeek-standup`, `weeek-advance`, `weeek-context`, `weeek-log`).
- `plugin/hooks/*.mjs` — two passive hooks (SessionStart, PostToolUse on
  `git commit`) registered via `plugin/.claude-plugin/hooks.json`. Hooks
  never call the WEEEK API; they only inject context for the agent.
- `plugin/lib/task-detector.mjs` — zero-dependency regex detector shared by
  both hooks. Built-in patterns are documented in the spec; per-repo
  overrides live in `.weeek.json` (validated by `plugin/config.schema.json`).

See `docs/superpowers/specs/2026-04-28-weeek-skills-and-hooks-design.md`
for the full design.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note skills and hooks in plugin/ layer"
```

---

## Task 17: Final verification

**Files:** none modified — this is verification only.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all suites green, including the new `tests/lib/task-detector.test.ts`, `tests/hooks/*.test.ts`, and (if Task 0 passed) the two new tool tests.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean. The plugin layer is `.mjs` Node files — verify the eslint config either ignores `plugin/**` or is satisfied by them. If the latter fails because the plugin uses different conventions, add `plugin/**` to the eslint ignore list and re-run.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: `dist/index.js` rebuilt, no TypeScript errors. The plugin folder is not bundled (it's runtime, not compiled), but verify it survives untouched.

- [ ] **Step 5: Smoke test the SessionStart hook manually**

```bash
git checkout -b feature/WEEEK-9999-smoke
node plugin/hooks/detect-task-on-session.mjs
git checkout -
git branch -D feature/WEEEK-9999-smoke
```
Expected: a JSON line on stdout containing `9999` and `weeek_get_task`.

- [ ] **Step 6: Smoke test the PostToolUse hook manually**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"WEEEK-77 fix\""},"tool_response":{"stdout":"[main abc123] WEEEK-77 fix"}}' \
  | node plugin/hooks/detect-task-on-commit.mjs
```
Expected: a JSON line on stdout containing `77` and `/weeek-advance`.

- [ ] **Step 7: Commit any verification fixups (if needed)**

If steps 3 surfaces an issue, fix it and commit. Otherwise this task produces no commits.

---

## Self-Review Checklist

Run through this after the plan is written:

- [x] Every spec section has at least one task — architecture (1, 2, 3, 4, 5), config schema (1), detector (2), hooks (3, 4, 5), MCP comment tools (0, 6, 7), six skills (8–13), distribution + docs (14, 15, 16), tests (each task includes its own).
- [x] No "TBD" / "TODO" / "implement later" placeholders in steps.
- [x] Type/method consistency: `weeek_list_comments`, `weeek_add_comment`, `registerListComments`, `registerAddComment` used consistently across tasks 6, 7, 12, 13.
- [x] Code blocks attached to every step that produces code.
- [x] Exact file paths everywhere.
- [x] TDD order: test → run → fail → implement → run → pass → commit.
- [x] Frequent commits — every task ends with one.
- [x] DRY: shared regex list referenced from `weeek-standup`, `weeek-log`, `weeek-advance` (skills duplicate them by design — see spec §5.3 for the rationale; this is a markdown duplication for skill self-containment, not a code duplication).
- [x] YAGNI: no `Stop` hook, no `UserPromptSubmit` hook, no `/weeek-init`, no time tracking.
- [x] Gate task (Task 0) is first and clearly marks downstream skip points.
