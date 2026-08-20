import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/globalSetup.js'],
    // Gemini calls can legitimately retry through a ~20s free-tier quota window.
    testTimeout: 60000,
  },
});
