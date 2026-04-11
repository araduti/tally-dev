import { test, expect } from '@playwright/test';

test.describe('Auth — Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('login page renders correctly', async ({ page }) => {
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('can fill in and submit the login form', async ({ page }) => {
    await page.getByTestId('login-email').fill('admin@test.tally.dev');
    await page.getByTestId('login-password').fill('TestPassword123!');
    await page.getByTestId('login-submit').click();
    // Expect navigation away from login on success
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test('invalid credentials show error message', async ({ page }) => {
    await page.getByTestId('login-email').fill('wrong@example.com');
    await page.getByTestId('login-password').fill('WrongPassword!');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText(/invalid|incorrect|unauthorized/i);
  });
});

test.describe('Auth — Forgot Password', () => {
  test('forgot password page renders', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByTestId('forgot-password-email')).toBeVisible();
    await expect(page.getByTestId('forgot-password-submit')).toBeVisible();
  });
});

test.describe('Auth — Register', () => {
  test('register page renders', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByTestId('register-email')).toBeVisible();
    await expect(page.getByTestId('register-password')).toBeVisible();
    await expect(page.getByTestId('register-submit')).toBeVisible();
  });
});
