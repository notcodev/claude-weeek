import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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
      tool_input: {
        command: 'git commit --dry-run -m "WEEEK-1 test"',
      },
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
    expect(r.stderr).toBe('')
    const parsed = JSON.parse(r.stdout)
    expect(parsed.hookSpecificOutput.hookEventName).toBe(
      'PostToolUse',
    )
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      '42',
    )
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      '/weeek-advance',
    )
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
