const { test, expect } = require('@playwright/test');

// Federano "Night City" theme: Settings › Display › Theme = nightcity turns on the look and its moving parts
// (rain, skyline, scanlines, the glitch cut and panels powering on when the page changes).
test.use({ viewport: { width: 1280, height: 800 } });

async function withTheme(page, theme) {
  await page.goto('/panel/');
  await page.waitForTimeout(1500);
  await page.evaluate((theme) => {
    const c = JSON.parse(localStorage.getItem('pb-demo-config') || '{}');
    c.display = { ...(c.display || {}), theme };
    localStorage.setItem('pb-demo-config', JSON.stringify(c));
  }, theme);
  await page.reload();
  await page.waitForTimeout(2500);
}

test('night city theme draws its effects and the page-change cut', async ({ page }) => {
  await withTheme(page, 'nightcity');
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'nightcity');
  await expect(page.locator('canvas.nc-rain')).toHaveCount(1);
  await expect(page.locator('canvas.nc-sky')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('nightcity-0.png') });
  await page.evaluate(() => window.onAndroidKey('next'));
  await expect(page.locator('.nc-cut.on')).toHaveCount(1);
  await expect(page.locator('.page.nc-boot')).toHaveCount(1);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: test.info().outputPath('nightcity-1.png') });
  for (let i = 2; i < 6; i++) {
    await page.evaluate(() => window.onAndroidKey('next'));
    await page.waitForTimeout(2200);
    await page.screenshot({ path: test.info().outputPath(`nightcity-${i}.png`) });
  }
});

test('other themes leave no night city effects behind', async ({ page }) => {
  await withTheme(page, 'midnight');
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'midnight');
  await expect(page.locator('.nc-fx')).toHaveCount(0);
});
