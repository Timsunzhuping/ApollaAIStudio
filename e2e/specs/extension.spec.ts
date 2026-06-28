import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// S15-T5 (extension smoke): build the MV3 package and validate a loadable, least-privilege manifest.
// NOTE: full MV3 browser e2e (side panel / service worker automation) is a documented gap — it is
// flaky offline; this asserts the build produces a valid, least-privilege package.
test('extension builds into a valid least-privilege MV3 package', () => {
  const dist = path.resolve(__dirname, '../../apps/extension/dist');
  if (!existsSync(path.join(dist, 'manifest.json'))) {
    execSync('pnpm --filter @apolla/extension build', { stdio: 'ignore', cwd: path.resolve(__dirname, '../..') });
  }
  const m = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8')) as {
    manifest_version: number; name?: string; permissions?: string[]; host_permissions?: string[]; content_scripts?: unknown[];
  };
  expect(m.manifest_version).toBe(3);
  expect(m.name).toBeTruthy();
  // Least-privilege: no broad host access, no static content script injected everywhere.
  expect(m.host_permissions ?? []).not.toContain('<all_urls>');
  expect(m.permissions ?? []).not.toContain('<all_urls>');
  expect(m.content_scripts ?? []).toHaveLength(0);
});
