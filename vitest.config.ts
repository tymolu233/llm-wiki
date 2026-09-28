import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'references'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['dist', 'node_modules', 'references/**', 'test/**', '**/*.config.*'],
    },
  },
});
