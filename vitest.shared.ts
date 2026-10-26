import { defineConfig } from 'vitest/config'

// Workspace packages export their TypeScript sources under this condition,
// so tests run against src/ without a prior build.
const conditions = ['@decivo/accord-source', 'import', 'module', 'node', 'default']

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
