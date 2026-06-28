import { test, expect } from '@playwright/test';

// S15-T6: production-mode serving — the BFF serves the built SPA single-origin, runs in password
// auth mode (no zero-config email-only login), and exposes health/metrics.
test('serves the built SPA single-origin in password auth mode', async ({ request }) => {
  const root = await request.get('/');
  expect(root.ok()).toBeTruthy();
  expect(await root.text()).toContain('id="root"'); // the Vite SPA mount, not the inline dev UI

  // Password mode: email-only demo login is rejected.
  const demo = await request.post('/api/auth/login', { data: { email: 'nobody@apolla.test' } });
  expect(demo.status()).toBe(401);

  expect((await request.get('/api/health')).ok()).toBeTruthy();
  expect((await request.get('/metrics')).ok()).toBeTruthy();
});
