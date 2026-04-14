import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/analysis/**'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 90,
        statements: 98,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
