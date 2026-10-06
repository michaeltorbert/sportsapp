// Issue #116: Settings must be dismissible without making a selection, keep one
// reachable Close while its own body scrolls, and leave the page usable after.
// Touch contexts use real taps; synthesized touch *scrolling* is not exercised here.
import { devices } from '@playwright/test';
import { test, expect, event, category } from './fixtures.mjs';

const KEY = 'ss:duke-visibility:v1';
function duke(id, { home = false, neutral = false, date = '2026-09-05T23:30:00Z' } = {}) {
  const game = event(id, { acc: true, date }); game.competitions[0].neutralSite = neutral;
  const team = game.competitions[0].competitors[home ? 1 : 0].team; team.id = '150'; team.shortDisplayName = 'Duke'; team.abbreviation = 'DUKE';
  return game;
}
// Ten started Duke matchups on one Eastern date force the Settings body to overflow.
const manyDuke = () => Array.from({ length: 10 }, (_, i) => duke(`duke-${i}`, { date: `2026-09-05T${14 + i}:00:00Z` }));
const fillers = () => Array.from({ length: 12 }, (_, i) => event(`filler-${i}`, { acc: i % 2 === 0 }));

const routes = {
  Scores: { path: '/?date=2026-09-05', ready: 'Refresh scores' },
  Guide: { path: '/guide?date=2026-09-05', ready: 'Refresh guide' },
};
async function openRoute(page, harness, route) {
  await harness.open({ path: routes[route].path, waitForScores: false });
  await expect(page.getByRole('button', { name: routes[route].ready, exact: true })).toBeEnabled();
}

const settingsButton = page => page.getByRole('button', { name: 'Settings', exact: true });
const settings = page => page.getByRole('dialog', { name: 'Settings', exact: true });
const closeButton = page => settings(page).getByRole('button', { name: 'Close', exact: true });
const body = page => settings(page).getByRole('region', { name: 'Viewing preferences', exact: true });
const storedPrefs = page => page.evaluate(key => localStorage.getItem(key), KEY);

// Startup records already-started Duke games; compare only once that has settled.
async function settledPrefs(page) {
  let previous = Symbol('unread');
  await expect.poll(async () => { const current = await storedPrefs(page); const stable = current === previous; previous = current; return stable; }).toBe(true);
  return previous;
}

async function openSettings(page, how) {
  await settingsButton(page)[how]();
  await expect(settings(page)).toBeVisible();
  // Measure the final position, not the slide-in animation.
  await settings(page).evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  await expect(settings(page).getByRole('radio').first()).toBeEnabled();
}

async function expectClosed(page) {
  await expect(settings(page)).toHaveCount(0);
  await expect(settingsButton(page)).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({ scrollLocked: document.body.hasAttribute('data-scroll-locked'), pointerEvents: getComputedStyle(document.body).pointerEvents })))
    .toEqual({ scrollLocked: false, pointerEvents: 'auto' });
}

// Rendered bounds and hit-testing of the pinned Close.
const closeState = page => closeButton(page).evaluate(el => {
  const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const title = el.closest('[role="dialog"]').querySelector('[data-slot="sheet-title"]').getBoundingClientRect();
  return {
    width: r.width, height: r.height, top: r.top, left: r.left,
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + .5 && r.bottom <= innerHeight + .5,
    hit: !!hit && el.contains(hit),
    clearOfTitle: title.right <= r.left || title.bottom <= r.top || title.top >= r.bottom,
  };
});

const bodyState = page => body(page).evaluate(el => {
  const r = el.getBoundingClientRect(), dialog = el.closest('[role="dialog"]'), d = dialog.getBoundingClientRect();
  const note = el.querySelector('.settings-note').getBoundingClientRect();
  return {
    overflows: el.scrollHeight > el.clientHeight + 1, scrollTop: el.scrollTop, remaining: el.scrollHeight - el.clientHeight - el.scrollTop,
    horizontal: Math.max(el.scrollWidth - el.clientWidth, dialog.scrollWidth - dialog.clientWidth),
    noteVisible: note.top >= r.top - .5 && note.bottom <= r.bottom + .5,
    dialogInViewport: d.top >= -.5 && d.bottom <= innerHeight + .5 && d.right <= innerWidth + .5,
    pageScroll: scrollY,
  };
});

for (const route of Object.keys(routes)) test(`${route}: Settings closes without a selection and leaves the page usable`, async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, duke('duke-away')];
  await openRoute(page, harness, route);
  const before = await settledPrefs(page);
  await openSettings(page, 'tap');
  await expect(settings(page).getByRole('button', { name: 'Close', exact: true })).toHaveCount(1);
  await expect(closeButton(page)).toBeFocused();
  const close = await closeState(page);
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(close.height).toBeGreaterThanOrEqual(44);
  await closeButton(page).tap();
  await expectClosed(page);
  expect(await storedPrefs(page)).toBe(before);
  await openSettings(page, 'tap');
  await page.keyboard.press('Escape');
  await expectClosed(page);
  expect(await storedPrefs(page)).toBe(before);
  // Space on the initially focused Close closes; it never reaches a preference.
  await openSettings(page, 'tap');
  await page.keyboard.press('Space');
  await expectClosed(page);
  expect(await storedPrefs(page)).toBe(before);
  if (route === 'Scores') {
    await category(page, 'ACC').tap();
    await expect(category(page, 'ACC')).toHaveAttribute('aria-pressed', 'true');
  } else {
    const requests = () => harness.state.scoreRequests.length + harness.state.cdnRequests.length + harness.state.hostedScoreRequests.length;
    const sent = requests();
    await page.getByRole('button', { name: 'Refresh guide', exact: true }).tap();
    await expect.poll(requests).toBeGreaterThan(sent);
  }
});

test('without a Duke game, Close takes initial focus and keyboard scrolling changes nothing', async ({ page, harness }) => {
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openSettings(page, 'tap');
  await expect(settings(page)).toContainText('No Duke game in this date range.');
  await expect(closeButton(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(body(page)).toBeFocused();
  await page.keyboard.press('PageDown');
  await page.keyboard.press('ArrowDown');
  await expect(settings(page).getByRole('radio', { name: 'Hide away and neutral-site games', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expectClosed(page);
  expect(await storedPrefs(page)).toBe(before);
});

test('with a visible Duke game, opening Settings never hides it; a deliberate Space on its toggle does', async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, duke('duke-home', { home: true })];
  await openRoute(page, harness, 'Scores');
  await expect(page.locator('#game-duke-home')).toBeVisible();
  const before = await settledPrefs(page);
  await openSettings(page, 'tap');
  await expect(closeButton(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expectClosed(page);
  await expect(page.locator('#game-duke-home')).toBeVisible();
  expect(await storedPrefs(page)).toBe(before);
  await openSettings(page, 'tap');
  await page.keyboard.press('Tab');
  await expect(body(page)).toBeFocused();
  // Engines differ on whether plain Tab reaches buttons, so focus the toggle directly;
  // this checks deliberate keyboard activation, not full Tab traversal.
  const hide = settings(page).getByRole('button', { name: 'Hide Duke game on Sep 5', exact: true });
  await hide.focus();
  await expect(hide).toBeFocused();
  await page.keyboard.press('Space');
  await expect(settings(page).getByRole('button', { name: 'Show Duke game on Sep 5', exact: true })).toBeFocused();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expectClosed(page);
  await expect(page.locator('#game-duke-home')).toHaveCount(0);
  expect(JSON.parse(await storedPrefs(page)).overrides['duke-home']).toBe(true);
});

test('deliberate default choices save immediately and survive close, reopen and reload', async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, duke('duke-away')];
  await openRoute(page, harness, 'Scores');
  await settledPrefs(page);
  const radio = name => settings(page).getByRole('radio', { name, exact: true });
  const savedMode = async () => JSON.parse(await storedPrefs(page)).rules.at(-1).mode;
  await openSettings(page, 'tap');
  await radio('Always show').tap();
  await expect(radio('Always show')).toBeChecked();
  await expect.poll(savedMode).toBe('show');
  await closeButton(page).tap();
  await expectClosed(page);
  // The already-started game keeps the setting recorded when it was first seen.
  await expect(page.locator('#game-duke-away')).toHaveCount(0);
  await openSettings(page, 'tap');
  await expect(radio('Always show')).toBeChecked();
  // Native radio arrow keys still work once a radio is deliberately focused.
  await radio('Always show').focus();
  await page.keyboard.press('ArrowUp');
  await expect(radio('Always hide')).toBeChecked();
  await expect.poll(savedMode).toBe('hide');
  await page.keyboard.press('Escape');
  await expectClosed(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Refresh scores', exact: true })).toBeEnabled();
  await openSettings(page, 'tap');
  await expect(radio('Always hide')).toBeChecked();
});

test('revealing from Settings uses a nested confirmation that Cancel and Escape dismiss on its own', async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, duke('duke-away')];
  await openRoute(page, harness, 'Scores');
  const before = JSON.parse(await settledPrefs(page));
  await openSettings(page, 'tap');
  const reveal = settings(page).getByRole('button', { name: 'Show Duke game on Sep 5', exact: true });
  const confirm = page.getByRole('alertdialog', { name: 'Show this game only?', exact: true });
  // Act only on a settled confirmation: Cancel focused and its fade/zoom finished, so the
  // nested layer is fully mounted before any key or tap reaches it.
  async function openConfirm() {
    await reveal.tap();
    await expect(confirm).toContainText('Your default stays “Hide away and neutral-site games.” Duke notifications stay off.');
    await expect(confirm.getByRole('button', { name: 'Keep hidden', exact: true })).toBeFocused();
    await page.evaluate(() => Promise.all([...document.querySelectorAll('[data-slot="alert-dialog-overlay"], [data-slot="alert-dialog-content"]')]
      .flatMap(el => el.getAnimations({ subtree: true })).map(animation => animation.finished.catch(() => {}))));
  }
  for (const dismiss of ['Keep hidden', 'Escape']) {
    await openConfirm();
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else await confirm.getByRole('button', { name: dismiss, exact: true }).tap();
    await expect(confirm).toHaveCount(0);
    await expect(settings(page)).toBeVisible();
    await expect(reveal).toBeFocused();
    await expect(page.locator('#game-duke-away')).toHaveCount(0);
    expect(JSON.parse(await storedPrefs(page))).toEqual(before);
  }
  await openConfirm();
  await confirm.getByRole('button', { name: 'Show this game only', exact: true }).tap();
  await expect(confirm).toHaveCount(0);
  await expect(settings(page).getByRole('button', { name: 'Hide Duke game on Sep 5', exact: true })).toBeFocused();
  await expect(settings(page).getByText('Shown for this game only', { exact: true })).toBeVisible();
  await expect(settings(page).getByRole('radio', { name: 'Hide away and neutral-site games', exact: true })).toBeChecked();
  await expect(settings(page)).toContainText('Always off, even when you show a game.');
  expect(JSON.parse(await storedPrefs(page))).toEqual({ ...before, overrides: { ...before.overrides, 'duke-away': false } });
  await closeButton(page).tap();
  await expectClosed(page);
  await expect(page.locator('#game-duke-away')).toBeVisible();
});

const layouts = [
  { name: '320px phone', width: 320, height: 568 },
  { name: 'short landscape phone', width: 844, height: 390 },
  { name: '320px phone with doubled Settings text', width: 320, height: 640, textScale: 2 },
];
for (const layout of layouts) test(`${layout.name}: Close stays pinned while the keyboard scrolls every setting into view`, async ({ page, harness }, testInfo) => {
  harness.state.events = [...harness.state.events, ...manyDuke()];
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openSettings(page, 'tap');
  if (layout.textScale) {
    // A larger root font does not enlarge this pixel-sized text, so scale each computed size.
    await settings(page).evaluate((root, scale) => {
      const nodes = [root, ...root.querySelectorAll('*')], sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
      nodes.forEach((node, i) => { node.style.fontSize = `${sizes[i] * scale}px`; });
    }, layout.textScale);
    expect(await settings(page).locator('.settings-note').evaluate(el => getComputedStyle(el).fontSize)).toBe('26px');
  }
  const top = await closeState(page);
  expect(top).toMatchObject({ inViewport: true, hit: true, clearOfTitle: true });
  expect(top.width).toBeGreaterThanOrEqual(44);
  expect(top.height).toBeGreaterThanOrEqual(44);
  const start = await bodyState(page);
  expect(start).toMatchObject({ overflows: true, scrollTop: 0, dialogInViewport: true });
  expect(start.horizontal).toBeLessThanOrEqual(0);
  await testInfo.attach(`${layout.name} top`, { body: await page.screenshot(), contentType: 'image/png' });
  await expect(closeButton(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(body(page)).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await bodyState(page)).scrollTop).toBeGreaterThan(0);
  await page.keyboard.press('End');
  await expect.poll(async () => (await bodyState(page)).remaining).toBeLessThanOrEqual(1);
  expect(await bodyState(page)).toMatchObject({ noteVisible: true, dialogInViewport: true });
  expect(await closeState(page)).toEqual(top);
  await testInfo.attach(`${layout.name} bottom`, { body: await page.screenshot(), contentType: 'image/png' });
  expect(await storedPrefs(page)).toBe(before);
  await closeButton(page).tap();
  await expectClosed(page);
  expect(await storedPrefs(page)).toBe(before);
});

test.describe('desktop keyboard and mouse', () => {
  // A true desktop context, not a resized phone: no touch, no mobile viewport, desktop agent.
  test.use({
    viewport: { width: 1280, height: 560 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1,
    userAgent: async ({ browserName }, provideUserAgent) => provideUserAgent(devices[browserName === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'].userAgent),
  });
  for (const route of Object.keys(routes)) test(`${route}: on a short desktop the wheel scrolls only Settings, then backdrop and page recover`, async ({ page, harness, hasTouch, isMobile, deviceScaleFactor, userAgent, viewport }, testInfo) => {
    harness.state.events = [...harness.state.events, ...fillers(), ...manyDuke()];
    await openRoute(page, harness, route);
    // The shared browser-evidence hasTouch is the project default; for these tests this
    // attachment records the resolved fixtures and what the page actually observes.
    const observed = await page.evaluate(() => ({
      maxTouchPoints: navigator.maxTouchPoints, devicePixelRatio, userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight }, screen: { width: screen.width, height: screen.height },
    }));
    const context = { resolved: { hasTouch, isMobile, deviceScaleFactor, userAgent, viewport }, observed };
    await testInfo.attach('desktop-context', { body: JSON.stringify(context, null, 2), contentType: 'application/json' });
    expect(context.resolved).toMatchObject({ hasTouch: false, isMobile: false, deviceScaleFactor: 1, viewport: { width: 1280, height: 560 } });
    expect(userAgent).not.toMatch(/iPhone|Mobile/);
    expect(observed).toMatchObject({ maxTouchPoints: 0, devicePixelRatio: 1, userAgent });
    const before = await settledPrefs(page);
    if (route === 'Scores') expect(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 1)).toBe(true);
    await openSettings(page, 'click');
    await expect(closeButton(page)).toBeFocused();
    const top = await closeState(page);
    expect(top).toMatchObject({ inViewport: true, hit: true, clearOfTitle: true });
    expect(await bodyState(page)).toMatchObject({ overflows: true, dialogInViewport: true });
    const box = await body(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 5000);
    await expect.poll(async () => (await bodyState(page)).remaining).toBeLessThanOrEqual(1);
    expect(await bodyState(page)).toMatchObject({ noteVisible: true, dialogInViewport: true, pageScroll: 0 });
    expect(await closeState(page)).toEqual(top);
    await testInfo.attach(`${route} desktop bottom`, { body: await page.screenshot(), contentType: 'image/png' });
    await closeButton(page).click();
    await expectClosed(page);
    expect(await storedPrefs(page)).toBe(before);
    // The backdrop beside the desktop panel also dismisses.
    await openSettings(page, 'click');
    await page.mouse.click(40, 280);
    await expectClosed(page);
    expect(await storedPrefs(page)).toBe(before);
    if (route === 'Scores') {
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, 600);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    }
  });
});
