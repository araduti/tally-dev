import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-settings').click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test('settings page loads', async ({ page }) => {
    await expect(page.getByTestId('settings-heading')).toBeVisible();
  });

  test('vendor connection cards display', async ({ page }) => {
    await expect(page.getByTestId('vendor-connections-section')).toBeVisible();
    const cards = page.getByTestId('vendor-connection-card');
    await expect(cards.first()).toBeVisible();
  });

  test('sync button triggers sync', async ({ page }) => {
    const firstCard = page.getByTestId('vendor-connection-card').first();
    const syncButton = firstCard.getByTestId('vendor-sync-button');
    await syncButton.click();
    // Expect a loading/progress indicator after clicking sync
    await expect(
      firstCard.getByTestId('vendor-sync-status'),
    ).toContainText(/syncing|in progress/i);
    // Wait for sync to complete
    await expect(
      firstCard.getByTestId('vendor-sync-status'),
    ).toContainText(/synced|complete|success/i, { timeout: 30_000 });
  });
});
