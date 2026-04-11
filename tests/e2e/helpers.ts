import { type Page } from '@playwright/test';

/**
 * Shared login helper for E2E tests.
 * Navigates to login page and authenticates with the given credentials.
 */
export async function login(
  page: Page,
  email = 'admin@test.tally.dev',
  password = 'TestPassword123!',
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  // Wait for redirect to dashboard after successful login
  await page.waitForURL('**/dashboard', { timeout: 10_000 });
}

/**
 * Logs out the current user.
 */
export async function logout(page: Page): Promise<void> {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout-button').click();
  await page.waitForURL('**/login', { timeout: 10_000 });
}
