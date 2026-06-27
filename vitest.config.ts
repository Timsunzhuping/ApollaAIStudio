import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'workers/**/*.test.ts',
      'evals/**/*.test.ts',
    ],
    // apps/web is a jsdom React app with its own vitest config — run it via `pnpm --filter
    // @apolla/web test`, not the root node-env runner.
    exclude: [...configDefaults.exclude, 'apps/web/**'],
    environment: 'node',
  },
});
