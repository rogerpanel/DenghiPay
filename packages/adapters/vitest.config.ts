import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      // The probe is a command-line tool run by hand against the real API.
      exclude: ['src/**/*.spec.ts', 'src/index.ts', 'src/paycrest/probe.ts'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 65 },
    },
  },
});
