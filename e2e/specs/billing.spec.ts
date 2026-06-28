import { test, expect } from '@playwright/test';
import { signUp } from './helpers';

// S15-T4: the billing journey — upgrade (stub checkout activates inline) → Pro → cancel → free.
test('upgrades to Pro and cancels back to Free', async ({ page }) => {
  await signUp(page);
  await page.getByRole('link', { name: 'Billing' }).click();

  await expect(page.getByText('Your plan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel subscription' })).toHaveCount(0); // free: no cancel

  await page.getByRole('button', { name: 'Upgrade to Pro' }).click();
  // Active Pro: the cancel control appears and the upgrade-to-pro CTA is gone.
  await expect(page.getByRole('button', { name: 'Cancel subscription' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  // Back to free: the upgrade CTA returns.
  await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
});
