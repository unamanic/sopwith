import { test, expect } from '@playwright/test';

test.describe('Sopwith Game', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8000/index.html', { timeout: 10000 });
  });

  test('should load game canvas', async ({ page }) => {
    const canvas = page.locator('#canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('width', '1200');
    await expect(canvas).toHaveAttribute('height', '650');
  });

  test('should display HUD elements', async ({ page }) => {
    await expect(page.locator('#hud-speed')).toContainText('SPD: 0');
    await expect(page.locator('#hud-alt')).toContainText('ALT: 0');
    await expect(page.locator('#hud-ammo')).toContainText('AMMO: 40');
    await expect(page.locator('#hud-bombs')).toContainText('BOMBS: 6');
    await expect(page.locator('#hud-score')).toContainText('SCORE: 0');
  });

  test('should have sound control button', async ({ page }) => {
    const soundBtn = page.locator('#btn-sound');
    await expect(soundBtn).toBeVisible();
    await expect(soundBtn).toContainText('SFX');
  });

  test('sound button should toggle muted class', async ({ page }) => {
    const soundBtn = page.locator('#btn-sound');
    await soundBtn.click();
    await expect(soundBtn).toHaveClass(/muted/);
    await soundBtn.click();
    await expect(soundBtn).not.toHaveClass(/muted/);
  });

  test('should render game content', async ({ page }) => {
    const canvas = page.locator('#canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBe(1200);
    expect(box?.height).toBe(650);
  });

  test('page title should be Sopwith', async ({ page }) => {
    await expect(page).toHaveTitle('Sopwith');
  });
});
