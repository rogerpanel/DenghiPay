import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      // ids.ts is nothing but compile-time brands over the identity function;
      // there is no behaviour there to cover.
      exclude: ['src/**/*.spec.ts', 'src/index.ts', 'src/ids.ts'],
      // Guardrail: money code carries a 90% floor (BUILD_PLAN §2.4).
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
