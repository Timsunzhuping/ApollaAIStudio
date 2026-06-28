import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'workers/**/*.test.ts',
      'evals/**/*.test.ts',
    ],
    // apps/web + apps/extension are jsdom apps with their own vitest configs — run via
    // `pnpm --filter @apolla/<app> test`, not the root node-env runner.
    exclude: [...configDefaults.exclude, 'apps/web/**', 'apps/extension/**'],
    environment: 'node',
    // The BFF integration tests each boot an HTTP server against one shared Postgres; running test
    // files in parallel forks makes that contention flaky. Run files sequentially for determinism
    // (the suite is only a few seconds). Cases within a file still run concurrently.
    fileParallelism: false,
  },
});
