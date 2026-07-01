/** Human-readable rendering of drift findings + the CI error gate. */

import type { Finding } from './types.js'

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'error')
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return '✓ No spec drift detected — every tool request matches the WEEEK OpenAPI snapshot.\n'
  }
  const errors = findings.filter((f) => f.severity === 'error')
  const warns = findings.filter((f) => f.severity === 'warn')
  const lines: string[] = [
    `Spec drift: ${errors.length} error(s), ${warns.length} warning(s)`,
    '',
  ]
  for (const f of [...errors, ...warns]) {
    const tag = f.severity === 'error' ? 'ERROR' : 'warn '
    lines.push(`  [${tag}] ${f.tool} ${f.method} ${f.path}`)
    lines.push(`          ${f.code}: ${f.detail}`)
  }
  lines.push('')
  return lines.join('\n')
}
