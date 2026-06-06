import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'config/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
