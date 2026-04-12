import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Compliance', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-compliance').click();
    await expect(page).toHaveURL(/\/compliance/);
  });

  test('compliance page loads', async ({ page }) => {
    await expect(page.getByTestId('compliance-heading')).toBeVisible();
  });

  test('DPA acceptance flow works', async ({ page }) => {
    await page.getByTestId('dpa-section').click();
    await expect(page.getByTestId('dpa-content')).toBeVisible();
    await page.getByTestId('dpa-accept-checkbox').check();
    await page.getByTestId('dpa-accept-submit').click();
    await expect(page.getByTestId('dpa-accepted-badge')).toBeVisible();
  });

  test('contract signing flow works', async ({ page }) => {
    await page.getByTestId('contract-section').click();
    await expect(page.getByTestId('contract-content')).toBeVisible();
    await page.getByTestId('contract-sign-button').click();
    await expect(page.getByTestId('contract-signature-modal')).toBeVisible();
    await page.getByTestId('contract-signature-input').fill('Test User');
    await page.getByTestId('contract-signature-submit').click();
    await expect(page.getByTestId('contract-signed-badge')).toBeVisible();
  });
});
