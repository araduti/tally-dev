import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard page loads after login', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('dashboard-heading')).toBeVisible();
  });

  test('navigation sidebar links work', async ({ page }) => {
    const navLinks = [
      { testId: 'nav-subscriptions', urlPattern: /\/subscriptions/ },
      { testId: 'nav-settings', urlPattern: /\/settings/ },
      { testId: 'nav-compliance', urlPattern: /\/compliance/ },
    ];

    for (const { testId, urlPattern } of navLinks) {
      await page.getByTestId(testId).click();
      await expect(page).toHaveURL(urlPattern);
      // Navigate back to dashboard for next iteration
      await page.getByTestId('nav-dashboard').click();
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });

  test('breadcrumbs display correctly', async ({ page }) => {
    await expect(page.getByTestId('breadcrumbs')).toBeVisible();
    await expect(page.getByTestId('breadcrumbs')).toContainText('Dashboard');
  });
});
