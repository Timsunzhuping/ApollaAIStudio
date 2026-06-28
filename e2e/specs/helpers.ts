import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'hunter2hunter2';
export const uniqEmail = () => `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}@apolla.test`;

/** Register a fresh account and land in the authenticated workbench. */
export async function signUp(page: Page): Promise<string> {
  const email = uniqEmail();
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('at least 8 characters').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('link', { name: 'Research' })).toBeVisible();
  return email;
}
