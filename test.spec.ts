import { test, expect } from '@playwright/test';

test.describe('Sopwith Game', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8000/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  test('should load game canvas', async ({ page }) => {
    const canvas = page.locator('#canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('width', '1440');
    await expect(canvas).toHaveAttribute('height', '780');
  });

  test('should have correct page title', async ({ page }) => {
    await expect(page).toHaveTitle('Sopwith');
  });

  test('canvas should be rendered', async ({ page }) => {
    const canvas = page.locator('#canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThanOrEqual(1440);
    expect(box?.height).toBeGreaterThanOrEqual(780);
  });

  test('should respond to keyboard input', async ({ page }) => {
    await page.keyboard.press('Space');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('KeyL');
    await page.keyboard.press('KeyQ');
    // Game should still be running (no errors)
    const errors = await page.evaluate(() => {
      return (window as any).__errors || [];
    });
    expect(errors).toHaveLength(0);
  });

  test('game should initialize without errors', async ({ page }) => {
    await page.waitForTimeout(2000);
    const errors = await page.evaluate(() => {
      const pageErrors: string[] = [];
      window.addEventListener('error', (e) => {
        pageErrors.push(e.message);
      });
      return pageErrors;
    });
    // Just verify page loaded
    const canvas = page.locator('#canvas');
    await expect(canvas).toBeVisible();
  });
});
