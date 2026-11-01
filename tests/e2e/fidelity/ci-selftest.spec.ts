// TEMPORARY (M0-02 acceptance): proves a failing fidelity test turns CI red. Reverted in the next commit.
import { expect, test } from '@playwright/test';

test('deliberately failing fidelity check', async ({ page }) => {
  await page.setContent('<canvas width="10" height="10"></canvas>');
  expect(await page.locator('canvas').count()).toBe(2);
});
