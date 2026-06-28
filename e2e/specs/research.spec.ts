import { test, expect } from '@playwright/test';
import { signUp } from './helpers';

// S15-T3: the research journey over REAL SSE (not mocked fetch) — submit a question, watch the
// report stream to completion, see sources, and the export links appear.
test('runs a research task end-to-end over real SSE', async ({ page }) => {
  await signUp(page);
  await page.getByRole('link', { name: 'Research' }).click();

  await page.getByPlaceholder(/Ask a research question/).fill('State of the EV market in 2026');
  await page.getByRole('button', { name: 'Research' }).click();

  // Export links only render once the task has streamed to completion (taskId && !running).
  await expect(page.getByRole('link', { name: 'Export .md' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Export .html' })).toBeVisible();

  // The report streamed real content (the empty-state placeholder is gone).
  await expect(page.getByText('Enter a question to begin.')).toHaveCount(0);

  // The export endpoint actually serves the artifact.
  const href = await page.getByRole('link', { name: 'Export .md' }).getAttribute('href');
  const dl = await page.request.get(href!);
  expect(dl.ok()).toBeTruthy();
});
