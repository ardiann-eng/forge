import { test, expect } from '@playwright/test';
test('home uses honest empty states and links to launch', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'YOUR FEES. YOUR RULES.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'WAITING FOR THE FIRST FLOW.' })).toBeVisible();
  await page.getByRole('link', { name: 'Launch token' }).first().click();
  await page.waitForURL('**/launch', { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'FORGE SOMETHING.' })).toBeVisible();
});
test('token details flow and wallet modal keyboard close', async ({ page }) => {
  await page.goto('/launch');
  await page.getByLabel('Token name', { exact: true }).fill('Browser test input');
  await page.getByLabel('Ticker', { exact: true }).fill('INPUT');
  await page.getByRole('button', { name: 'Set your fee flow' }).click();
  await expect(page.getByRole('heading', { name: 'Where should the fees go?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review flow' })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('destinations are selectable and direct configuration is accessible', async ({
  page,
}) => {
  await page.goto('/launch');
  await page.getByLabel('Token name', { exact: true }).fill('Input');
  await page.getByLabel('Ticker', { exact: true }).fill('IN');
  await page.getByRole('button', { name: 'Set your fee flow' }).click();
  await expect(page.getByRole('heading', { name: 'Where should the fees go?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select BUYBACK/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select BUY \+ BURN/i })).toBeVisible();
  await page.getByRole('button', { name: /Select TREASURY/i }).click();
  await page.getByRole('button', { name: 'Increase by 5%' }).click();
  await expect(page.getByLabel(/Treasury Wallet Address/i)).toBeVisible();
});
for (const width of [320, 375, 414, 768, 1280])
  test(`responsive layouts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/launch', '/flows', '/activity', '/status']) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
