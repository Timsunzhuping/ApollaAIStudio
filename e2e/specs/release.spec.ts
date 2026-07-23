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

// S36/B6: the PWA surface is served single-origin — manifest with the right content type, the
// service worker at root scope, and the manifest linked from the SPA shell.
test('serves the PWA manifest + service worker', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect(manifest.headers()['content-type']).toContain('application/manifest+json');
  expect(((await manifest.json()) as { name: string }).name).toBe('Apolla AI Studio');

  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
  expect(sw.headers()['content-type']).toContain('javascript');

  expect(await (await request.get('/')).text()).toContain('manifest.webmanifest');
});
