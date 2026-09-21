import { test, expect, ALERT_ORIGIN } from './fixtures.mjs';
import { mkdir } from 'node:fs/promises';

// Keep state cues, focus and touch targets usable across narrow mobile layouts.
for (const width of [320, 390]) for (const scale of [100, 150]) {
  test(`SIMULATED alert appearance: ${width}px ${scale}%`, async ({ page, harness }, info) => {
    await mkdir('output/alerts-final', { recursive: true });
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    harness.state.upsetFinal = false;
    await harness.open({ push: { permission: 'granted', existing: true, credentials: true } });
    await page.getByRole('button', { name: 'Alerts on', exact: true }).tap();
    const sheet = page.getByRole('dialog');
    await expect(sheet.locator('.alert-choice-group, .alert-switch-word, .alert-switch-on, .alert-switch-off')).toHaveCount(0);
    if (scale === 150) await page.addStyleTag({ content: '.alerts-sheet [data-slot="sheet-title"] { font-size: 34.5px; } .alerts-sheet [data-slot="sheet-description"] { font-size: 21px; } .alerts-sheet .help-body { font-size: 24px; } .alerts-sheet .alert-setting strong { font-size: 24px; } .alerts-sheet .alert-setting small, .alerts-sheet .alert-footnote { font-size: 19.5px; } .alerts-sheet .alert-setting > .alert-switch { font-size: 24px; } .alerts-sheet .alert-details { font-size: 21px; }' });
    const capture = async state => page.screenshot({ path: `output/alerts-final/after-${info.project.name}-${width}-${scale}-${state}.png` });
    const on = sheet.getByRole('switch', { name: 'Upset watch', exact: true });
    const off = sheet.getByRole('switch', { name: 'Upset final results', exact: true });
    const check = on.locator('..').locator('.alert-switch-check');
    await expect(on).toBeChecked(); await expect(off).not.toBeChecked();
    for (const control of await sheet.getByRole('switch').all()) {
      const box = await control.boundingBox();
      expect(Math.round(box.width)).toBeGreaterThanOrEqual(44); expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    }
    await expect(check).toBeVisible();
    expect(await on.evaluate(el => getComputedStyle(el.nextElementSibling).boxShadow)).not.toBe('none');
    expect(await off.evaluate(el => getComputedStyle(el.nextElementSibling).boxShadow)).toBe('none');
    await capture('overview');
    await on.scrollIntoViewIfNeeded(); await capture('on');
    await off.scrollIntoViewIfNeeded(); await capture('off');
    await on.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.keyboard.press('Tab'); await on.focus(); await on.press('ArrowRight');
    expect(await on.evaluate(el => getComputedStyle(el).outlineWidth)).toBe('2px');
    expect(await on.evaluate(el => getComputedStyle(el).outlineColor)).toBe('rgb(255, 255, 255)');
    expect(await on.evaluate(el => getComputedStyle(el).outlineOffset)).toBe('3px');
    await capture('focus');
    let release; const held = new Promise(resolve => { release = resolve; });
    const handler = async route => { if (route.request().method() === 'PATCH') await held; await route.fallback(); };
    await page.route(`${ALERT_ORIGIN}/subscriptions/*`, handler);
    try {
      await on.press('Space'); await expect(on).toHaveAttribute('aria-busy', 'true');
      await expect(on).toBeChecked(); await expect(check).toBeVisible();
      expect(await on.evaluate(el => getComputedStyle(el.nextElementSibling).boxShadow)).toBe('none');
      await capture('busy-on');
    } finally { release(); await expect(on).toHaveAttribute('aria-busy', 'false'); await page.unroute(`${ALERT_ORIGIN}/subscriptions/*`, handler); }
    await on.press('Space'); await expect(on).toBeChecked();
    const master = sheet.getByRole('switch', { name: 'Notifications', exact: true });
    await master.focus(); await master.press('Space'); await expect(master).not.toBeChecked();
    await expect(on).toBeDisabled(); await expect(on).toBeChecked(); await expect(check).toBeVisible();
    expect(await on.evaluate(el => getComputedStyle(el.nextElementSibling).boxShadow)).toBe('none');
    await on.scrollIntoViewIfNeeded(); await capture('disabled-on');
    expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
