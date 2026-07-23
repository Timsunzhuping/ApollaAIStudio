import { test, expect, type Page } from '@playwright/test';

const uniqEmail = () => `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}@apolla.test`;
const PASSWORD = 'hunter2hunter2';

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('at least 8 characters').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

// S15-T2: real register → workbench → logout → login, all on the real built-web → real-BFF stack.
test('register, sign out, and sign back in', async ({ page }) => {
  const email = uniqEmail();
  await register(page, email);
  await expect(page.getByRole('link', { name: 'Research' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign in to Apolla AI')).toBeVisible();

  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('at least 8 characters').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); // exact: '🔑 Sign in with a passkey' also matches otherwise (S33)
  await expect(page.getByRole('link', { name: 'Research' })).toBeVisible();
});

// S15-T2: OAuth/SSO via the offline Stub provider — start → callback → session, end to end.
test('signs in with the Stub SSO provider', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with Demo SSO' }).click();
  await expect(page.getByRole('link', { name: 'Research' })).toBeVisible();
  // The linked identity shows up in Settings.
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Linked accounts')).toBeVisible();
  await expect(page.getByText('stub', { exact: true })).toBeVisible();
});

// S15-T2: the auth gate — a deep link to a protected route while logged out renders the login screen.
test('auth gate redirects an unauthenticated deep link to login', async ({ page }) => {
  await page.goto('/billing');
  await expect(page.getByText('Sign in to Apolla AI')).toBeVisible();
});
