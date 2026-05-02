# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: test.spec.ts >> Sopwith Game >> should load game canvas
- Location: test.spec.ts:8:7

# Error details

```
TimeoutError: page.goto: Timeout 10000ms exceeded.
Call log:
  - navigating to "http://localhost:8000/index.html", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Sopwith Game', () => {
  4  |   test.beforeEach(async ({ page }) => {
> 5  |     await page.goto('http://localhost:8000/index.html', { timeout: 10000 });
     |                ^ TimeoutError: page.goto: Timeout 10000ms exceeded.
  6  |   });
  7  | 
  8  |   test('should load game canvas', async ({ page }) => {
  9  |     const canvas = page.locator('#canvas');
  10 |     await expect(canvas).toBeVisible();
  11 |     await expect(canvas).toHaveAttribute('width', '1200');
  12 |     await expect(canvas).toHaveAttribute('height', '650');
  13 |   });
  14 | 
  15 |   test('should display HUD elements', async ({ page }) => {
  16 |     await expect(page.locator('#hud-speed')).toContainText('SPD: 0');
  17 |     await expect(page.locator('#hud-alt')).toContainText('ALT: 0');
  18 |     await expect(page.locator('#hud-ammo')).toContainText('AMMO: 40');
  19 |     await expect(page.locator('#hud-bombs')).toContainText('BOMBS: 6');
  20 |     await expect(page.locator('#hud-score')).toContainText('SCORE: 0');
  21 |   });
  22 | 
  23 |   test('should have sound control button', async ({ page }) => {
  24 |     const soundBtn = page.locator('#btn-sound');
  25 |     await expect(soundBtn).toBeVisible();
  26 |     await expect(soundBtn).toContainText('SFX');
  27 |   });
  28 | 
  29 |   test('sound button should toggle muted class', async ({ page }) => {
  30 |     const soundBtn = page.locator('#btn-sound');
  31 |     await soundBtn.click();
  32 |     await expect(soundBtn).toHaveClass(/muted/);
  33 |     await soundBtn.click();
  34 |     await expect(soundBtn).not.toHaveClass(/muted/);
  35 |   });
  36 | 
  37 |   test('should render game content', async ({ page }) => {
  38 |     const canvas = page.locator('#canvas');
  39 |     const box = await canvas.boundingBox();
  40 |     expect(box).not.toBeNull();
  41 |     expect(box?.width).toBe(1200);
  42 |     expect(box?.height).toBe(650);
  43 |   });
  44 | 
  45 |   test('page title should be Sopwith', async ({ page }) => {
  46 |     await expect(page).toHaveTitle('Sopwith');
  47 |   });
  48 | });
  49 | 
```