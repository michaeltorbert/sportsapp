// Real shared UI with simulated mode/feed/push APIs. Native iPhone/iPad install
// and Home Screen launch acceptance is recorded separately, never inferred here.
import { test, expect } from './fixtures.mjs';

const host = page => page.locator('[data-home-screen-install]');
const trigger = page => host(page).getByRole('button', { name: 'Add to Home Screen', exact: true });
const guide = page => host(page).getByRole('dialog');

async function modeSignals(page, initial = false) {
  await page.addInitScript(initial => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    const listeners = new Set();
    let matches = initial;
    const standalone = {
      get matches() { return matches; }, media: '(display-mode: standalone)',
      addEventListener(type, callback) { if (type === 'change') listeners.add(callback); },
      removeEventListener(type, callback) { if (type === 'change') listeners.delete(callback); },
    };
    window.matchMedia = query => query === standalone.media ? standalone : nativeMatchMedia(query);
    window.__installMode = {
      set(value) { matches = value; for (const callback of listeners) callback({ matches, media: standalone.media }); },
      listeners() { return listeners.size; },
    };
  }, initial);
}

async function verifySilence(page) {
  // Verify the existing automatic fixture's capture listener BEFORE UI actions.
  // No playback or audio API is stubbed and no preference/system volume changes.
  expect(await page.evaluate(() => {
    const probe = document.createElement('audio');
    document.body.append(probe);
    probe.dispatchEvent(new Event('loadstart'));
    const muted = probe.muted;
    probe.remove();
    return muted;
  })).toBe(true);
}

async function openBrowser(page, harness, options = {}) {
  await harness.open({ push: { standalone: false }, clock: 'date-only', ...options });
  await verifySilence(page);
}

async function snapshot(page) {
  return page.evaluate(() => ({
    storage: Object.fromEntries(Object.entries(localStorage).sort()),
    push: { ...window.__pushSimulation },
  }));
}

for (const [name, push, media] of [
  ['navigator standalone', { standalone: true }, false],
  ['display-mode standalone', { standalone: false }, true],
]) test(`${name} hides the action and collapses its footer`, async ({ page, harness }) => {
  await modeSignals(page, media);
  await openBrowser(page, harness, { push });
  await expect(host(page)).toHaveCount(1);
  await expect(host(page)).toBeHidden();
  await expect(page.locator('.home-screen-install-footer')).toBeHidden();
  expect(await page.locator('.home-screen-install-footer').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
});

test('browser with saved settings, icon history, referrer and fullscreen still offers manual guidance', async ({ page, harness }) => {
  await page.addInitScript(() => {
    localStorage.setItem('installed', 'true');
    localStorage.setItem('ss:installed', 'true');
    localStorage.setItem('ss:all-fbs', 'true');
    Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://example.test/installed' });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement });
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: fullscreen)' ? { matches: true, media: query } : nativeMatchMedia(query);
  });
  await openBrowser(page, harness);
  await expect(trigger(page)).toBeVisible();
  // Startup persistence is app behavior; watch all subsequent writes attributable
  // to the guide, rather than confusing those startup writes with install work.
  await page.evaluate(() => {
    window.__installWrites = [];
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(key, value) { window.__installWrites.push(['set', key]); return set.call(this, key, value); };
    Storage.prototype.removeItem = function(key) { window.__installWrites.push(['remove', key]); return remove.call(this, key); };
  });
  const before = await snapshot(page);
  for (const close of ['Close', 'Escape', 'Close']) {
    await trigger(page).click();
    await expect(guide(page)).toBeVisible();
    await expect(guide(page).getByRole('heading')).toHaveText('Add Saturday Signal to your Home Screen');
    await expect(guide(page)).toContainText('Share');
    await expect(guide(page)).toContainText('Add to Home Screen');
    await expect(guide(page)).toContainText('Open as Web App');
    await expect(guide(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await guide(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(guide(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
  }
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__installWrites)).toEqual([]);
});

test('current-mode changes close the guide, pageshow rechecks navigator, and repeated navigation leaves one host', async ({ page, harness }) => {
  await modeSignals(page);
  await openBrowser(page, harness);
  await trigger(page).click();
  await page.evaluate(() => window.__installMode.set(true));
  await expect(host(page)).toBeHidden();
  await expect(guide(page)).toBeHidden();
  await page.evaluate(() => window.__installMode.set(false));
  await expect(trigger(page)).toBeVisible();
  await trigger(page).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect(host(page)).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(trigger(page)).toBeVisible();
  for (const path of ['/guide?date=2026-09-05', '/?date=2026-09-05']) {
    await page.goto(path);
    await verifySilence(page);
    await expect(trigger(page)).toBeVisible();
    await expect(host(page)).toHaveCount(1);
    // Scores also has the existing Alerts usePushEnvironment subscriber.
    expect(await page.evaluate(() => window.__installMode.listeners())).toBe(path.startsWith('/guide') ? 1 : 2);
  }
});

for (const [name, path] of [
  ['Guide', '/guide?date=2026-09-05'],
  ['game', '/?event=401856717'],
  ['team', '/?team=153'],
]) test(`${name} has one usable guide outside hidden views and panels`, async ({ page, harness }) => {
  await openBrowser(page, harness, { path, waitForScores: false });
  await expect(trigger(page)).toBeVisible();
  if (name !== 'Guide') await expect(page.locator('.scores-view')).toBeHidden();
  expect(await host(page).evaluate(el => !!el.closest('.scores-view, [role="dialog"]'))).toBe(false);
  await trigger(page).click();
  await expect(guide(page)).toBeVisible();
  await guide(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(trigger(page)).toBeFocused();
});

test('Help and Settings keep their panels and the footer cannot open through an active panel', async ({ page, harness }) => {
  await openBrowser(page, harness);
  for (const [name, title] of [['Settings', 'Settings'], ['How this scoreboard works', 'How your watchlist works']]) {
    await page.getByRole('button', { name, exact: true }).click();
    const panel = page.getByRole('dialog', { name: title, exact: true });
    await expect(panel).toBeVisible();
    await expect(guide(page)).toBeHidden();
    // Radix correctly removes the footer from the accessible tree while open.
    expect(await host(page).locator('button').first().evaluate(el => {
      const rect = el.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.hasAttribute('data-home-screen-install') || false;
    })).toBe(false);
    if (name.startsWith('How')) await expect(panel).not.toContainText('Keep it on your iPhone');
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toHaveCount(0);
  }
  await trigger(page).click();
  await expect(guide(page)).toBeVisible();
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
  test(`${name} footer and shared guide fit at normal and enlarged text sizes`, async ({ page, harness }, info) => {
    await page.setViewportSize(viewport);
    await openBrowser(page, harness);
    await trigger(page).scrollIntoViewIfNeeded();
    await info.attach(`${name}-footer`, { body: await page.screenshot(), contentType: 'image/png' });
    for (const size of ['100%', '200%']) {
      await page.evaluate(size => { document.documentElement.style.fontSize = size; }, size);
      await trigger(page).click();
      await expect(guide(page)).toBeVisible();
      const bounds = await guide(page).evaluate(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: el.scrollWidth - el.clientWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
      expect(bounds.overflow).toBeLessThanOrEqual(1);
      await info.attach(`${name}-guide-${size}`, { body: await page.screenshot(), contentType: 'image/png' });
      await guide(page).getByRole('button', { name: 'Close', exact: true }).click();
      await expect(trigger(page)).toBeFocused();
    }
  });
}
