import { defineConfig } from 'vitest/config'

// Convex backend tests only (convex-test runs functions against an in-memory backend).
// The rest of the app is tested with Jest.
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
