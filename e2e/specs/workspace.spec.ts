import { test, expect } from '@playwright/test';
import { signUp } from './helpers';

// S15-T5: run a Surface and confirm the artifact lands in the versioned Workspace.
test('runs a surface and the artifact appears in the workspace', async ({ page }) => {
  await signUp(page);
  await page.getByRole('link', { name: 'Surfaces' }).click();

  await page.getByLabel('Surface').selectOption({ label: 'Summarize text' });
  await page.getByLabel('Params (JSON)').fill('{}');
  await page.getByLabel('Text input').fill('Apolla is a harness-architecture AI workbench spanning research, surfaces, billing, and OAuth sign-in.');
  await page.getByRole('button', { name: 'Run surface' }).click();

  const badge = page.getByText(/✓ wrote/);
  await expect(badge).toBeVisible({ timeout: 20_000 });
  const wrote = (await badge.textContent()) ?? '';
  const path = wrote.match(/wrote\s+(\S+)\s+v/)?.[1];
  expect(path).toBeTruthy();

  await page.getByRole('link', { name: 'Workspace' }).click();
  await expect(page.getByText(path!, { exact: false })).toBeVisible();
});
