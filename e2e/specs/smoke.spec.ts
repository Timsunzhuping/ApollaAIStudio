import { test, expect } from '@playwright/test';

// S15-T1: the built SPA is served single-origin by the in-memory BFF and the health endpoint is up.
test('app loads the login screen (single-origin SPA)', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByText('Sign in to Apolla AI')).toBeVisible();
});
