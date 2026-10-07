// Issue #116: Settings must be dismissible without making a selection, keep one
// reachable Close while its own body scrolls, and leave the page usable after.
// Since 1.13.4 Alerts and Help share the same panel, and the page keeps its top safe-area spacing.
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

// 1.13.4: Settings, Alerts and Help share one full-height trailing panel.
const panels = {
  Settings: { trigger: 'Settings', title: 'Settings', region: 'Viewing preferences' },
  Alerts: { trigger: 'Alerts off', title: 'Catch the game-changing moments.', region: 'Alert choices' },
  Help: { trigger: 'How this scoreboard works', title: 'How your watchlist works', region: 'How it works' },
};
const panelTrigger = (page, name) => page.getByRole('button', { name: panels[name].trigger, exact: true });
const panel = (page, name) => page.getByRole('dialog', { name: panels[name].title, exact: true });
const panelBody = (page, name) => panel(page, name).getByRole('region', { name: panels[name].region, exact: true });
const panelClose = (page, name) => panel(page, name).getByRole('button', { name: 'Close', exact: true });
const nonGetAlertRequests = harness => harness.state.alertRequests.filter(r => r.method !== 'GET');

async function openPanel(page, name) {
  await panelTrigger(page, name).tap();
  await expect(panel(page, name)).toBeVisible();
  await panel(page, name).evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
}
async function expectPanelClosed(page, name) {
  await expect(panel(page, name)).toHaveCount(0);
  await expect(panelTrigger(page, name)).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({ scrollLocked: document.body.hasAttribute('data-scroll-locked'), pointerEvents: getComputedStyle(document.body).pointerEvents })))
    .toEqual({ scrollLocked: false, pointerEvents: 'auto' });
}
const panelGeometry = (page, name) => panel(page, name).evaluate(dialog => {
  const d = dialog.getBoundingClientRect(), close = dialog.querySelector('.app-panel-close'), c = close.getBoundingClientRect();
  const body = dialog.querySelector('.app-panel-body'), b = body.getBoundingClientRect();
  const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
  return {
    top: d.top, right: d.right, bottom: d.bottom, width: d.width, viewport: { width: innerWidth, height: innerHeight },
    panelScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
    close: { top: c.top, left: c.left, width: c.width, height: c.height, hit: !!hit && close.contains(hit), inViewport: c.top >= 0 && c.left >= 0 && c.bottom <= innerHeight + .5 && c.right <= innerWidth + .5 },
    body: { height: b.height, overflows: body.scrollHeight > body.clientHeight + 1, overflowY: getComputedStyle(body).overflowY, horizontal: Math.max(body.scrollWidth - body.clientWidth, dialog.scrollWidth - dialog.clientWidth) },
  };
});

const panelLayouts = [
  { name: '320px phone', width: 320, height: 568 },
  { name: 'notched portrait phone', width: 393, height: 852 },
  { name: 'short landscape phone', width: 844, height: 390 },
  { name: 'short landscape phone with doubled text', width: 844, height: 390, textScale: 2 },
];
for (const layout of panelLayouts) for (const name of Object.keys(panels)) test(`${layout.name}: ${name} is a full-height trailing panel with one pinned Close`, async ({ page, harness }, testInfo) => {
  harness.state.events = [...harness.state.events, ...manyDuke()];
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openPanel(page, name);
  if (layout.textScale) await panel(page, name).evaluate((root, scale) => {
    const nodes = [root, ...root.querySelectorAll('*')], sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, i) => { node.style.fontSize = `${sizes[i] * scale}px`; });
  }, layout.textScale);
  await expect(panelClose(page, name)).toHaveCount(1);
  await expect(panelClose(page, name)).toBeFocused();
  const start = await panelGeometry(page, name);
  expect(start.top).toBeCloseTo(0, 0);
  expect(start.bottom).toBeCloseTo(start.viewport.height, 0);
  expect(start.right).toBeCloseTo(start.viewport.width, 0);
  expect(start.width).toBeCloseTo(layout.width <= 600 ? layout.width : 430, 0);
  expect(start.panelScrolls).toBe(false);
  expect(start.close).toMatchObject({ hit: true, inViewport: true });
  expect(start.close.width).toBeGreaterThanOrEqual(44);
  expect(start.close.height).toBeGreaterThanOrEqual(44);
  expect(start.body.overflowY).toBe('auto');
  expect(start.body.horizontal).toBeLessThanOrEqual(0);
  // Even a heading enlarged this much leaves the body most of a short landscape screen.
  if (layout.textScale) expect(start.body.height).toBeGreaterThanOrEqual(layout.height * .4);
  await testInfo.attach(`${name} ${layout.name} top`, { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Tab');
  await expect(panelBody(page, name)).toBeFocused();
  if (start.body.overflows) {
    await page.keyboard.press('End');
    await expect.poll(() => panelBody(page, name).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
    const end = await panelGeometry(page, name);
    expect(end.close).toEqual(start.close);
    expect(end.panelScrolls).toBe(false);
    await testInfo.attach(`${name} ${layout.name} bottom`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  await panelClose(page, name).tap();
  await expectPanelClosed(page, name);
  expect(nonGetAlertRequests(harness)).toEqual([]);
  expect(await storedPrefs(page)).toBe(before);
});

for (const name of ['Alerts', 'Help']) test(`${name}: Escape and the backdrop dismiss repeatedly without changing anything`, async ({ page, harness }) => {
  // Wide enough that the backdrop shows beside the 430px panel.
  await page.setViewportSize({ width: 844, height: 600 });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  for (const dismiss of ['Escape', 'backdrop', 'Escape']) {
    await openPanel(page, name);
    await expect(panelClose(page, name)).toBeFocused();
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else await page.mouse.click(5, 300);
    await expectPanelClosed(page, name);
  }
  expect(nonGetAlertRequests(harness)).toEqual([]);
  expect(await storedPrefs(page)).toBe(before);
  await category(page, 'ACC').tap();
  await expect(category(page, 'ACC')).toHaveAttribute('aria-pressed', 'true');
});

test('panels open over 300ms and close over 200ms; reduced motion removes the slide', async ({ page, harness }) => {
  await openRoute(page, harness, 'Scores');
  for (const name of Object.keys(panels)) {
    await panelTrigger(page, name).tap();
    await expect(panel(page, name)).toBeVisible();
    expect(await panel(page, name).evaluate(el => getComputedStyle(el).animationDuration)).toBe('0.3s');
    await panel(page, name).evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
    // Read the closing state the moment Radix marks it, before the exit animation ends.
    const closing = await panel(page, name).evaluate(dialog => new Promise(resolve => {
      new MutationObserver((_, observer) => {
        if (dialog.dataset.state === 'closed') { observer.disconnect(); resolve(getComputedStyle(dialog).animationDuration); }
      }).observe(dialog, { attributes: true, attributeFilter: ['data-state'] });
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }));
    expect(closing, name).toBe('0.2s');
    await expectPanelClosed(page, name);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const name of Object.keys(panels)) {
    await panelTrigger(page, name).tap();
    await expect(panel(page, name)).toBeVisible();
    expect(await panel(page, name).evaluate(el => ({ name: getComputedStyle(el).animationName, running: el.getAnimations().length }))).toEqual({ name: 'none', running: 0 });
    await page.keyboard.press('Escape');
    await expectPanelClosed(page, name);
  }
});

// Overriding --safe-top checks layout arithmetic only; it is not evidence of native iOS insets.
for (const inset of [0, 59]) test(`SIMULATED ${inset}px top inset: page spacing, status-bar band, sticky row and panel header`, async ({ page, harness }, testInfo) => {
  harness.state.events = [...harness.state.events, ...fillers()];
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, 'Scores');
  await page.addStyleTag({ content: `:root { --safe-top: ${inset}px; }` });
  const gap = Math.max(inset + 8, 12);
  expect((await page.locator('.app-header').boundingBox()).y).toBeCloseTo(gap, 0);
  // The band's bounds and stacking: fixed at the top, as tall as the inset, under dialogs (z-50).
  expect(await page.evaluate(() => {
    const s = getComputedStyle(document.body, '::before');
    return { position: s.position, top: s.top, height: s.height, zIndex: s.zIndex, pointerEvents: s.pointerEvents, background: s.backgroundColor };
  })).toEqual({ position: 'fixed', top: '0px', height: `${inset}px`, zIndex: '20', pointerEvents: 'none', background: 'rgb(10, 14, 22)' });
  await page.evaluate(() => scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
  expect((await page.locator('.filter-tabs').boundingBox()).y).toBeCloseTo(inset, 0);
  await testInfo.attach(`scrolled top, ${inset}px inset`, { body: await page.screenshot({ clip: { x: 0, y: 0, width: 393, height: 160 } }), contentType: 'image/png' });
  if (inset) {
    // Pointer input inside the band still reaches the scrolled page beneath it.
    await page.evaluate(() => { window.__bandTarget = null; addEventListener('mousemove', event => { window.__bandTarget ??= event.target.closest('main') ? 'main' : event.target.nodeName; }); });
    await page.mouse.move(196, inset / 2);
    await expect.poll(() => page.evaluate(() => window.__bandTarget)).toBe('main');
  }
  await openPanel(page, 'Settings');
  const settingsPanel = await panelGeometry(page, 'Settings');
  expect(settingsPanel.close.top).toBeGreaterThanOrEqual(inset + 16);
  expect(settingsPanel.close).toMatchObject({ hit: true, inViewport: true });
  expect(await panel(page, 'Settings').evaluate(el => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(20);
  await testInfo.attach(`Settings, ${inset}px inset`, { body: await page.screenshot({ clip: { x: 0, y: 0, width: 393, height: 160 } }), contentType: 'image/png' });
  await panelClose(page, 'Settings').tap();
  await expectPanelClosed(page, 'Settings');
});

test('Help Display details stays collapsed until opened, reads the raw insets, and remeasures after rotation', async ({ page, harness }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openRoute(page, harness, 'Scores');
  // The app's spacing variable must not leak into the reported device inset.
  await page.addStyleTag({ content: ':root { --safe-top: 59px; }' });
  await openPanel(page, 'Help');
  const details = panel(page, 'Help').locator('details.display-details');
  await expect(details).not.toHaveAttribute('open');
  await details.locator('summary').tap();
  const value = label => details.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd');
  await expect(value('Window size')).toHaveText('320 × 568');
  await expect(value('Safe-area insets')).toHaveText('Top 0px, right 0px, bottom 0px, left 0px');
  await expect(value('Display mode')).toHaveText(/^browser/);
  await expect(value('Visible area')).toHaveText(/^320 × 568/);
  expect(await details.locator('dd').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1))).toBe(true);
  await page.setViewportSize({ width: 568, height: 320 });
  await expect(value('Window size')).toHaveText('568 × 320');
  expect((await panelGeometry(page, 'Help')).body.horizontal).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expectPanelClosed(page, 'Help');
});
