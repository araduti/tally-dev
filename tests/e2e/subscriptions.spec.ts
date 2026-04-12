import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Subscriptions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-subscriptions').click();
    await expect(page).toHaveURL(/\/subscriptions/);
  });

  test('subscriptions list page loads', async ({ page }) => {
    await expect(page.getByTestId('subscriptions-heading')).toBeVisible();
    await expect(page.getByTestId('subscriptions-list')).toBeVisible();
  });

  test('can navigate to subscription detail', async ({ page }) => {
    const firstRow = page.getByTestId('subscription-row').first();
    await firstRow.click();
    await expect(page).toHaveURL(/\/subscriptions\/[a-zA-Z0-9-]+/);
    await expect(page.getByTestId('subscription-detail-heading')).toBeVisible();
  });

  test('cancel subscription modal appears', async ({ page }) => {
    const firstRow = page.getByTestId('subscription-row').first();
    await firstRow.click();
    await page.getByTestId('cancel-subscription-button').click();
    await expect(page.getByTestId('cancel-subscription-modal')).toBeVisible();
    await expect(page.getByTestId('cancel-subscription-confirm')).toBeVisible();
    // Dismiss modal
    await page.getByTestId('cancel-subscription-dismiss').click();
    await expect(page.getByTestId('cancel-subscription-modal')).not.toBeVisible();
  });
});
