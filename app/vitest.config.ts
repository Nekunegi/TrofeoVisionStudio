import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // localStorage / DOM APIs are exercised by src/layoutStore.test.ts.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
