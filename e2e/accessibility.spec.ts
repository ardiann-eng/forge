import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('primary pages have no critical or serious accessibility violations', async ({ page }) => {
  for (const route of ['/', '/launch', '/flows', '/activity', '/status']) {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);
  }
});
