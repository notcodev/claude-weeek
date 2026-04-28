import { eslint } from '@notcodev/eslint'

export default eslint({
  typescript: true,
  ignores: ['dist/**', 'coverage/**', '**/*.md'],
}).append({
  name: 'claude-weeek/stdio-safety',
  rules: {
    'no-console': ['error', { allow: ['error', 'warn'] }],
  },
})
