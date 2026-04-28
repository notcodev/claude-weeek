import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
      const override = getPatterns({
        taskIdPatterns: ['CUSTOM-(\\d+)'],
      })
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
