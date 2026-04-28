import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
  execFileSync('git', ['init', '-b', branch], {
    cwd,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.email', 'a@b'], {
    cwd,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'a'], {
    cwd,
    stdio: 'ignore',
  })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd,
    stdio: 'ignore',
  })
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
    expect(parsed.hookSpecificOutput.hookEventName).toBe(
      'SessionStart',
    )
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      '1234',
    )
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      'weeek_get_task',
    )
  })
})
