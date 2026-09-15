import { test, expect } from '@playwright/test';
test('home uses honest empty states and links to launch', async ({ page }) => {
  await page.route('**/api/state*', (r) =>
    r.fulfill({ json: { state: 'ready', tokens: [], events: [], stats: null } }),
  );
  await page.route('**/api/market/tokens*', (r) =>
    r.fulfill({
      json: { snapshots: {}, metadata: {}, flows: {}, tokens: [], updatedAt: Date.now() },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'YOUR FEES. YOUR RULES.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'NO TOKENS YET.' })).toBeVisible();
  await page
    .getByRole('link', { name: /Launch token/i })
    .first()
    .click();
  await page.waitForURL('**/launch', { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'FORGE SOMETHING.' })).toBeVisible();
});

test('home keeps the indexed token count visible while the snapshot is stale', async ({ page }) => {
  const token = '0x1111111111111111111111111111111111111111';
  await page.route('**/api/state*', (route) =>
    route.fulfill({
      json: {
        state: 'stale',
        tokens: [{ token, router: '0x2222222222222222222222222222222222222222' }],
        events: [],
        stats: { received: '0', processed: '0' },
      },
    }),
  );
  await page.route('**/api/market/tokens*', (route) =>
    route.fulfill({
      json: {
        snapshots: {},
        metadata: {},
        flows: {},
        tokens: [token],
        updatedAt: Date.now(),
      },
    }),
  );

  await page.goto('/');

  const launchedMetric = page.locator('.metric-card').filter({ hasText: 'TOKENS LAUNCHED' });
  await expect(launchedMetric.locator('.metric-value')).toHaveText('1');
  await expect(page.locator(`a[href="/token/${token}"]`)).toBeVisible();
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
test('destinations are selectable and direct configuration is accessible', async ({ page }) => {
  await page.goto('/launch');
  await page.getByLabel('Token name', { exact: true }).fill('Input');
  await page.getByLabel('Ticker', { exact: true }).fill('IN');
  await page.getByRole('button', { name: 'Set your fee flow' }).click();
  await expect(page.getByRole('heading', { name: 'Where should the fees go?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select BUYBACK/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select BUY \+ BURN/i })).toBeVisible();
  await page.getByRole('button', { name: /Select TREASURY/i }).click();
  await page.getByRole('button', { name: '+5%', exact: true }).click();
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

test('V2 strategy settings and recipients remain explicit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/launch');
  await page.getByLabel('Token name', { exact: true }).fill('Strategies');
  await page.getByLabel('Ticker', { exact: true }).fill('RULES');
  await page.getByRole('button', { name: 'Set your fee flow' }).click();
  await expect(page.getByRole('button', { name: /Select LIQUIDITY|Select CUSTOM/ })).toHaveCount(0);
  for (const name of ['GRAD BOOST', 'DCA BUYBACK', 'BUY & DISTRIBUTE'])
    await expect(page.getByRole('button', { name: new RegExp('Select ' + name) })).toBeVisible();
  await page.getByRole('button', { name: /Select GRAD BOOST/ }).click();
  await page.getByRole('button', { name: '+5%', exact: true }).click();
  await expect(page.getByLabel('Trigger at bonding progress (%)')).toBeVisible();
  await page.getByRole('button', { name: /Select DCA BUYBACK/ }).click();
  await page.getByRole('button', { name: '+5%', exact: true }).click();
  await expect(page.getByText('DCA STRATEGY | PREVIOUS CHECK')).toBeVisible();
  await page.locator('.strategy-editor summary').filter({ hasText: 'ADVANCED SETTINGS' }).click();
  await expect(page.getByLabel('Check interval (minutes)')).toHaveValue('5');
  await expect(
    page.getByText(/Only the deepest matching level buys once per interval/),
  ).toBeVisible();
  await page.getByRole('button', { name: /Select BUY & DISTRIBUTE/ }).click();
  await page.getByRole('button', { name: '+5%', exact: true }).click();
  await page.getByRole('button', { name: '+ ADD RECIPIENT' }).click();
  await page
    .getByLabel('Wallet address', { exact: true })
    .fill('0x1111111111111111111111111111111111111111');
  await expect(page.getByText('Enter a valid non-zero EVM wallet.')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tools/strategies-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page
    .locator('.unified-fee-configurator')
    .screenshot({ path: '.tools/strategies-desktop.png' });
  expect(errors).toEqual([]);
});
