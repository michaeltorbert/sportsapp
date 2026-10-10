// Issue #116: Settings must be dismissible without making a selection, keep one
// reachable Close while its own body scrolls, and leave the page usable after.
// Alerts and Help share the same panel, now a fixed-height bottom sheet, and the page keeps its
// top safe-area spacing.
// Touch contexts use real taps; Chromium CDP input exercises heading/body scrolling.
// Synthetic touch events check listener routing in both engines; these desktop tests
// do not establish native iPhone scrolling, bounce or scroll-indicator behavior.
import { devices } from '@playwright/test';
import { test, expect, event, category } from './fixtures.mjs';

const KEY = 'ss:duke-visibility:v2';
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

// Measure the final position, not the slide-in: the sheet's own animations have ended and it rests on
// the bottom edge. A bounded poll replaces an open-ended wait on animation.finished, so a stall fails
// within the expect timeout and reports the animations still running and the sheet's offset.
async function expectSheetOpen(dialog) {
  await expect.poll(() => dialog.evaluate(el => ({
    running: el.getAnimations().filter(a => a.playState !== 'finished').map(a => `${a.animationName ?? a.constructor.name} ${a.playState} at ${Math.round(a.currentTime ?? -1)}ms`),
    bottomOffset: Math.round(el.getBoundingClientRect().bottom - innerHeight),
  })), { message: 'sheet slide-in ends at its open position' }).toEqual({ running: [], bottomOffset: 0 });
}

async function openSettings(page, how) {
  await settingsButton(page)[how]();
  await expect(settings(page)).toBeVisible();
  await expectSheetOpen(settings(page));
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

// The heading's region role, tab stop, header flag and taller grip all follow its overflow through a
// ResizeObserver, some time after a text-size change. Take a baseline only once every one of them
// agrees with the heading's actual overflow; otherwise a later grip change moves the pinned Close.
async function expectHeadingSettled(dialog) {
  await expect.poll(() => dialog.evaluate(root => {
    const heading = root.querySelector('.app-panel-heading'), overflows = heading.scrollHeight > heading.clientHeight + 1;
    const expected = { role: overflows ? 'region' : null, tabindex: overflows ? '0' : null, headerFlag: overflows, grip: overflows ? '44px' : '12px' };
    const actual = {
      role: heading.getAttribute('role'), tabindex: heading.getAttribute('tabindex'),
      headerFlag: root.querySelector('.app-panel-header').hasAttribute('data-heading-scrolls'),
      grip: getComputedStyle(root.querySelector('.app-panel-grip')).height,
    };
    return Object.keys(expected).filter(key => actual[key] !== expected[key]).map(key => `${key} is ${actual[key]} with overflow ${overflows}`);
  }), { message: 'heading role, tab stop, header flag and grip agree with its actual overflow' }).toEqual([]);
}

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
  // Icon-only: the name comes from aria-label, and the icon itself is hidden.
  await expect(closeButton(page)).toHaveAttribute('aria-label', 'Close');
  await expect(closeButton(page)).toHaveText('');
  await expect(closeButton(page).locator('svg')).toHaveAttribute('aria-hidden', 'true');
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
  await expect(settings(page).getByRole('radio', { name: 'Hide away games once they start', exact: true })).toBeChecked();
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
  expect(JSON.parse(await storedPrefs(page)).manual['duke-home']).toBe(true);
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
    await expect(confirm).toContainText('Your default stays “Hide away games once they start.” Duke notifications stay off.');
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
  await expect(settings(page).getByRole('radio', { name: 'Hide away games once they start', exact: true })).toBeChecked();
  await expect(settings(page)).toContainText('Always off, even when you show a game.');
  expect(JSON.parse(await storedPrefs(page))).toEqual({ ...before, manual: { ...before.manual, 'duke-away': false } });
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
  await expectHeadingSettled(settings(page));
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
  // screen: undefined keeps the 1.63 behavior; Playwright 1.64 forwards descriptor screen sizes.
  test.use({
    viewport: { width: 1280, height: 560 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, screen: undefined,
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
    // The backdrop above the desktop sheet also dismisses.
    await openSettings(page, 'click');
    const sheet = await panelGeometry(page, 'Settings');
    expectBottomSheet(sheet);
    expect(sheet.top).toBeGreaterThan(20);
    await page.mouse.click(640, sheet.top / 2);
    await expectClosed(page);
    expect(await storedPrefs(page)).toBe(before);
    if (route === 'Scores') {
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, 600);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    }
  });
});

// Settings, Alerts and Help share one fixed-height bottom sheet.
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
  await expectSheetOpen(panel(page, name));
}
async function expectPanelClosed(page, name) {
  await expect(panel(page, name)).toHaveCount(0);
  await expect(panelTrigger(page, name)).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({ scrollLocked: document.body.hasAttribute('data-scroll-locked'), pointerEvents: getComputedStyle(document.body).pointerEvents })))
    .toEqual({ scrollLocked: false, pointerEvents: 'auto' });
}
// safeTop is the simulated --safe-top in px; the sheet's height cap keeps 12px clear of it.
const panelGeometry = (page, name, safeTop = 0) => panel(page, name).evaluate((dialog, safeTop) => {
  const d = dialog.getBoundingClientRect(), close = dialog.querySelector('.app-panel-close'), c = close.getBoundingClientRect();
  const body = dialog.querySelector('.app-panel-body'), b = body.getBoundingClientRect(), s = getComputedStyle(dialog);
  const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
  return {
    top: d.top, left: d.left, right: d.right, bottom: d.bottom, width: d.width, height: d.height, viewport: { width: innerWidth, height: innerHeight },
    cap: innerHeight - Math.max(safeTop + 12, 24),
    style: { background: s.backgroundColor, border: s.borderTopColor, borderTop: s.borderTopWidth, borderBottom: s.borderBottomWidth, radius: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius] },
    panelScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
    close: { top: c.top, left: c.left, width: c.width, height: c.height, hit: !!hit && close.contains(hit), inViewport: c.top >= 0 && c.left >= 0 && c.bottom <= innerHeight + .5 && c.right <= innerWidth + .5 },
    body: { height: b.height, overflows: body.scrollHeight > body.clientHeight + 1, overflowY: getComputedStyle(body).overflowY, horizontal: Math.max(body.scrollWidth - body.clientWidth, dialog.scrollWidth - dialog.clientWidth) },
  };
}, safeTop);
// Bottom-sheet placement shared by every layout: centered, at most 640px wide, resting on the bottom
// edge, and the same fixed safe-area height regardless of content.
function expectBottomSheet(geometry) {
  const { viewport } = geometry;
  expect(geometry.bottom).toBeCloseTo(viewport.height, 0);
  expect(geometry.width).toBeCloseTo(Math.min(viewport.width, 640), 0);
  expect((geometry.left + geometry.right) / 2).toBeCloseTo(viewport.width / 2, 0);
  expect(geometry.height).toBeLessThanOrEqual(geometry.cap + .5);
  expect(Math.abs(geometry.height - geometry.cap)).toBeLessThanOrEqual(1);
  expect(geometry.top).toBeGreaterThanOrEqual(viewport.height - geometry.cap - .5);
  expect(geometry.style).toEqual({ background: 'rgb(18, 28, 42)', border: 'rgb(52, 66, 87)', borderTop: '1px', borderBottom: '0px', radius: ['24px', '24px', '0px', '0px'] });
}

const panelLayouts = [
  { name: '320px phone', width: 320, height: 568 },
  { name: 'notched portrait phone', width: 393, height: 852 },
  { name: 'short landscape phone', width: 844, height: 390 },
  { name: 'short landscape phone with doubled text', width: 844, height: 390, textScale: 2 },
];
for (const layout of panelLayouts) for (const name of Object.keys(panels)) test(`${layout.name}: ${name} is a fixed-height bottom sheet with one pinned Close`, async ({ page, harness }, testInfo) => {
  harness.state.events = [...harness.state.events, ...manyDuke()];
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openPanel(page, name);
  if (layout.textScale) await panel(page, name).evaluate((root, scale) => {
    const nodes = [root, ...root.querySelectorAll('*')], sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, i) => { node.style.fontSize = `${sizes[i] * scale}px`; });
  }, layout.textScale);
  await expectHeadingSettled(panel(page, name));
  await expect(panelClose(page, name)).toHaveCount(1);
  await expect(panelClose(page, name)).toBeFocused();
  const start = await panelGeometry(page, name);
  expectBottomSheet(start);
  expect(start.panelScrolls).toBe(false);
  if (!layout.textScale) expect(await panel(page, name).locator('[data-slot="sheet-title"]').evaluate(el => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight])).toEqual(['23px', '720']);
  expect(start.close).toMatchObject({ hit: true, inViewport: true });
  expect(start.close.width).toBeGreaterThanOrEqual(44);
  expect(start.close.height).toBeGreaterThanOrEqual(44);
  expect(start.body.overflowY).toBe('auto');
  expect(start.body.horizontal).toBeLessThanOrEqual(0);
  // Even a heading enlarged this much leaves the body most of a short landscape screen.
  if (layout.textScale) expect(start.body.height).toBeGreaterThanOrEqual(layout.height * .4);
  await testInfo.attach(`${name} ${layout.name} top`, { body: await page.screenshot(), contentType: 'image/png' });
  const heading = panel(page, name).getByRole('region', { name: 'Title and description', exact: true });
  // Branch on whether the heading actually overflows its cap, not on the text scale: a short
  // enlarged title beside the icon-only Close can still fit.
  const headingOverflows = await panel(page, name).locator('.app-panel-heading').evaluate(el => el.scrollHeight > el.clientHeight + 1);
  // Keep genuine overflow covered: the longer Alerts and Help headings overflow at doubled text.
  if (layout.textScale && name !== 'Settings') expect(headingOverflows).toBe(true);
  if (headingOverflows) {
    // Enlarged text overflows the capped heading after the sheet opened: it becomes a named region
    // the keyboard can enter and scroll, while Close stays put and the body keeps its own scrolling.
    expect(start.body.overflows).toBe(true);
    await expect(heading).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Shift+Tab');
    await expect(heading).toBeFocused();
    expect(await heading.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('End');
    // Read both end conditions together: scrolling may still be moving when one is first met.
    await expect.poll(() => heading.evaluate(el => ({
      atEnd: el.scrollHeight - el.clientHeight - el.scrollTop <= 1,
      lastLineInView: el.lastElementChild.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + .5,
    })), { message: 'heading reaches its end with its last line in view' }).toEqual({ atEnd: true, lastLineInView: true });
    expect((await panelGeometry(page, name)).close).toEqual(start.close);
    expect(await panelBody(page, name).evaluate(el => el.scrollTop)).toBe(0);
    await testInfo.attach(`${name} ${layout.name} heading end`, { body: await page.screenshot(), contentType: 'image/png' });
    // Close has an explicit tabindex, so plain Tab reaches it even where engines skip native buttons.
    await page.keyboard.press('Tab');
    await expect(panelClose(page, name)).toBeFocused();
  } else {
    // A heading that fits, even enlarged, adds no region or tab stop: Close leads straight to the body.
    await expect(heading).toHaveCount(0);
    expect(await panel(page, name).locator('.app-panel-heading').getAttribute('tabindex')).toBeNull();
  }
  await page.keyboard.press('Tab');
  await expect(panelBody(page, name)).toBeFocused();
  if (start.body.overflows) {
    await page.keyboard.press('End');
    await expect.poll(() => panelBody(page, name).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
    const end = await panelGeometry(page, name);
    expect(end.close).toEqual(start.close);
    expect(end.top).toBeCloseTo(start.top, 0);
    expect(end.panelScrolls).toBe(false);
    await testInfo.attach(`${name} ${layout.name} bottom`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  if (headingOverflows && layout.textScale) {
    // Back to normal text, the heading fits again: its region and tab stop go away,
    // Close is the stop before the body again, and the body keeps its own scrolling.
    await panel(page, name).evaluate(root => { for (const node of [root, ...root.querySelectorAll('*')]) node.style.fontSize = ''; });
    expect(await panel(page, name).locator('.app-panel-heading').evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBe(false);
    await expect(heading).toHaveCount(0);
    expect(await panel(page, name).locator('.app-panel-heading').getAttribute('tabindex')).toBeNull();
    await expect(panelBody(page, name)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(panelClose(page, name)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(panelBody(page, name)).toBeFocused();
    const restored = await panelGeometry(page, name);
    expectBottomSheet(restored);
    expect(restored.panelScrolls).toBe(false);
    expect(restored.body.overflowY).toBe('auto');
    expect(restored.close).toMatchObject({ hit: true, inViewport: true });
  }
  await panelClose(page, name).tap();
  await expectPanelClosed(page, name);
  expect(nonGetAlertRequests(harness)).toEqual([]);
  expect(await storedPrefs(page)).toBe(before);
});

for (const name of ['Alerts', 'Help']) test(`${name}: Escape and the backdrop dismiss repeatedly without changing anything`, async ({ page, harness }) => {
  await page.setViewportSize({ width: 844, height: 600 });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  for (const dismiss of ['Escape', 'backdrop', 'Escape']) {
    await openPanel(page, name);
    await expect(panelClose(page, name)).toBeFocused();
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else {
      // The backdrop shows above the sheet, which is never full height.
      const { top } = await panelGeometry(page, name);
      expect(top).toBeGreaterThan(20);
      await page.mouse.click(422, top / 2);
    }
    await expectPanelClosed(page, name);
  }
  expect(nonGetAlertRequests(harness)).toEqual([]);
  expect(await storedPrefs(page)).toBe(before);
  await category(page, 'ACC').tap();
  await expect(category(page, 'ACC')).toHaveAttribute('aria-pressed', 'true');
});

test('panels keep the sheet\'s 500ms open and 300ms close; reduced motion removes the slide', async ({ page, harness }) => {
  await openRoute(page, harness, 'Scores');
  for (const name of Object.keys(panels)) {
    await panelTrigger(page, name).tap();
    await expect(panel(page, name)).toBeVisible();
    expect(await panel(page, name).evaluate(el => getComputedStyle(el).animationDuration)).toBe('0.5s');
    await panel(page, name).evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
    // Read the closing state the moment Radix marks it, before the exit animation ends.
    const closing = await panel(page, name).evaluate(dialog => new Promise(resolve => {
      new MutationObserver((_, observer) => {
        if (dialog.dataset.state === 'closed') { observer.disconnect(); resolve(getComputedStyle(dialog).animationDuration); }
      }).observe(dialog, { attributes: true, attributeFilter: ['data-state'] });
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }));
    expect(closing, name).toBe('0.3s');
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

// SIMULATED side insets: overriding --safe-left/--safe-right checks layout arithmetic only, not native
// insets. The centered sheet pads only the part of each inset it does not already clear, and never
// less than its normal 24px body and header-left, 16px header-right.
const sideInsets = [
  { width: 956, height: 440, left: 62, right: 62, header: [24, 16], body: [24, 24] },
  { width: 700, height: 440, left: 62, right: 62, header: [32, 32], body: [32, 32] },
  { width: 700, height: 440, left: 62, right: 0, header: [32, 16], body: [32, 24] },
  { width: 640, height: 440, left: 44, right: 44, header: [44, 44], body: [44, 44] },
  { width: 393, height: 852, left: 0, right: 47, header: [24, 47], body: [24, 47] },
];
for (const c of sideInsets) test(`SIMULATED ${c.left}/${c.right}px side insets at ${c.width}px: sheet padding clears only the uncovered inset`, async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, ...manyDuke()];
  await page.setViewportSize({ width: c.width, height: c.height });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await page.addStyleTag({ content: `:root { --safe-left: ${c.left}px; --safe-right: ${c.right}px; }` });
  for (const name of ['Settings', 'Help']) {
    await openPanel(page, name);
    const geometry = await panelGeometry(page, name);
    expectBottomSheet(geometry);
    expect(geometry.close).toMatchObject({ hit: true, inViewport: true });
    const m = await panel(page, name).evaluate(dialog => {
      const pad = (el, side) => parseFloat(getComputedStyle(el)[`padding${side}`]), rect = selector => dialog.querySelector(selector).getBoundingClientRect();
      const header = dialog.querySelector('.app-panel-header'), body = dialog.querySelector('.app-panel-body'), d = dialog.getBoundingClientRect();
      const title = rect('[data-slot="sheet-title"]'), close = rect('.app-panel-close'), first = body.firstElementChild.getBoundingClientRect();
      return {
        offset: { left: d.left, right: innerWidth - d.right },
        header: [pad(header, 'Left'), pad(header, 'Right')], body: [pad(body, 'Left'), pad(body, 'Right')],
        clear: { title: title.left, close: innerWidth - close.right, contentLeft: first.left, contentRight: innerWidth - first.right },
      };
    });
    expect(m.header, name).toEqual(c.header);
    expect(m.body, name).toEqual(c.body);
    // The same values follow from the sheet's actual position, so max-width and the offset stay coupled.
    expect(m.header[0]).toBeCloseTo(Math.max(24, c.left - m.offset.left), 0);
    expect(m.header[1]).toBeCloseTo(Math.max(16, c.right - m.offset.right), 0);
    expect(m.body[0]).toBeCloseTo(Math.max(24, c.left - m.offset.left), 0);
    expect(m.body[1]).toBeCloseTo(Math.max(24, c.right - m.offset.right), 0);
    // Title, Close and body content all stay outside the simulated insets.
    expect(m.clear.title).toBeGreaterThanOrEqual(c.left - .5);
    expect(m.clear.close).toBeGreaterThanOrEqual(c.right - .5);
    expect(m.clear.contentLeft).toBeGreaterThanOrEqual(c.left - .5);
    expect(m.clear.contentRight).toBeGreaterThanOrEqual(c.right - .5);
    expect(geometry.body.horizontal).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expectPanelClosed(page, name);
  }
  expect(nonGetAlertRequests(harness)).toEqual([]);
  expect(await storedPrefs(page)).toBe(before);
});

// The body is at least the viewport height. That adds no scrolling beyond the content, no sideways
// overflow, and leaves the Guide timeline sizing (100dvh-based) as it was, in portrait and short landscape.
for (const route of Object.keys(routes)) test(`${route}: the page fills the viewport height without adding scroll`, async ({ page, harness }) => {
  if (route === 'Guide') harness.state.events = [...harness.state.events, ...fillers()];
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, route);
  for (const size of [{ width: 393, height: 852 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(size.height);
    const extent = await page.evaluate(() => {
      const body = document.body.getBoundingClientRect(), main = document.querySelector('main').getBoundingClientRect(), root = document.scrollingElement;
      return { standalone: matchMedia('(display-mode: standalone)').matches, minHeight: getComputedStyle(document.body).minHeight, body: body.height, content: main.bottom + scrollY, scrollHeight: root.scrollHeight, horizontal: root.scrollWidth - innerWidth };
    });
    // Playwright runs in browser display mode, so this covers the browser (dvh) rule only. It cannot model
    // Safari's toolbar or the Home Screen rule; native captures cover those.
    expect(extent.standalone).toBe(false);
    expect(extent.minHeight).toBe(`${size.height}px`);
    expect(extent.body).toBeGreaterThanOrEqual(size.height - .5);
    expect(extent.scrollHeight).toBeLessThanOrEqual(Math.max(size.height, extent.content) + 1);
    expect(extent.horizontal).toBeLessThanOrEqual(0);
    if (route === 'Guide') {
      const timeline = size.height <= 450 ? Math.max(150, size.height - 196) : Math.min(Math.max(176, size.height - 305), 700);
      expect((await page.locator('.guide-viewport').boundingBox()).height).toBeCloseTo(timeline, 0);
    }
  }
});

// Opening and closing each sheet, and the nested Duke confirmation, leave a scrolled page where it was.
test('closing each sheet from a scrolled page keeps the scroll position and returns focus', async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, ...fillers(), duke('duke-away')];
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await page.evaluate(() => scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
  const scrolled = await page.evaluate(() => scrollY);
  for (const name of Object.keys(panels)) for (const dismiss of ['Close', 'Escape', 'backdrop']) {
    // Keyboard-open the off-screen trigger without scrolling to it.
    await panelTrigger(page, name).evaluate(el => el.focus({ preventScroll: true }));
    await page.keyboard.press('Enter');
    await expect(panel(page, name)).toBeVisible();
    await expectSheetOpen(panel(page, name));
    await expect(panelClose(page, name)).toBeFocused();
    if (name === 'Settings' && dismiss === 'Close') {
      const confirm = page.getByRole('alertdialog', { name: 'Show this game only?', exact: true });
      await panel(page, name).getByRole('button', { name: 'Show Duke game on Sep 5', exact: true }).tap();
      await confirm.getByRole('button', { name: 'Keep hidden', exact: true }).tap();
      await expect(confirm).toHaveCount(0);
      await expect(panel(page, name)).toBeVisible();
    }
    // The page has not moved before the sheet closes, so any jump below comes from closing it.
    expect(await page.evaluate(() => scrollY), `${name} ${dismiss} before close`).toBeCloseTo(scrolled, 0);
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else if (dismiss === 'backdrop') {
      const { top } = await panelGeometry(page, name);
      expect(top).toBeGreaterThan(20);
      await page.mouse.click(196, top / 2);
    } else await panelClose(page, name).tap();
    await expectPanelClosed(page, name);
    expect(await page.evaluate(() => scrollY), `${name} ${dismiss}`).toBeCloseTo(scrolled, 0);
  }
  expect(nonGetAlertRequests(harness)).toEqual([]);
  expect(await storedPrefs(page)).toBe(before);
});

// A tap may not move focus off a previously focused control (as with Safari and a link). Closing still
// returns focus to the sheet's own trigger, never to that earlier control, and leaves the page in place.
test('after a tap open from another focused control, closing returns focus to the sheet trigger', async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  const home = page.getByRole('link', { name: 'Saturday Signal home', exact: true });
  for (const name of Object.keys(panels)) for (const dismiss of ['Close', 'Escape', 'backdrop']) {
    await home.focus();
    await expect(home).toBeFocused();
    const start = await page.evaluate(() => scrollY);
    await openPanel(page, name);
    await expect(panelClose(page, name)).toBeFocused();
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else if (dismiss === 'backdrop') await page.mouse.click(196, (await panelGeometry(page, name)).top / 2);
    else await panelClose(page, name).tap();
    await expectPanelClosed(page, name);
    await expect(home).not.toBeFocused();
    expect(await page.evaluate(() => scrollY), `${name} ${dismiss}`).toBeCloseTo(start, 0);
  }
  expect(nonGetAlertRequests(harness)).toEqual([]);
  expect(await storedPrefs(page)).toBe(before);
});

// When the recorded trigger cannot take focus, the sheet leaves focus to Radix's own return instead of
// claiming it. The next opening records its trigger afresh, so normal focus return resumes.
test('a trigger that cannot take focus at close falls back without stranding the page', async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, 'Scores');
  await openPanel(page, 'Help');
  // While the modal is open the page behind it is aria-hidden, so the role query must include hidden
  // elements. Confirm it is this dialog's own trigger before changing it.
  const helpTrigger = page.getByRole('button', { name: panels.Help.trigger, exact: true, includeHidden: true });
  await expect(helpTrigger).toHaveCount(1);
  await expect(helpTrigger).toHaveAttribute('aria-controls', await panel(page, 'Help').getAttribute('id'));
  await helpTrigger.evaluate(el => { el.disabled = true; });
  await page.keyboard.press('Escape');
  await expect(panel(page, 'Help')).toHaveCount(0);
  await expect(helpTrigger).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => ({ scrollLocked: document.body.hasAttribute('data-scroll-locked'), pointerEvents: getComputedStyle(document.body).pointerEvents, inDialog: !!document.activeElement?.closest('[role="dialog"]') })))
    .toEqual({ scrollLocked: false, pointerEvents: 'auto', inDialog: false });
  await helpTrigger.evaluate(el => { el.disabled = false; });
  await openPanel(page, 'Help');
  await panelClose(page, 'Help').tap();
  await expectPanelClosed(page, 'Help');
  expect(nonGetAlertRequests(harness)).toEqual([]);
});

// Overriding --safe-top checks layout arithmetic only; it is not evidence of native iOS insets.
// Scores and portrait Guide add up to 18px below an inset and keep 12px without one.
const topGap = { 0: 12, 59: 77 };
for (const inset of [0, 59]) test(`SIMULATED ${inset}px top inset: page spacing, status-bar band, sticky row and panel header`, async ({ page, harness }, testInfo) => {
  harness.state.events = [...harness.state.events, ...fillers()];
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, 'Scores');
  await page.addStyleTag({ content: `:root { --safe-top: ${inset}px; }` });
  expect((await page.locator('.app-header').boundingBox()).y).toBeCloseTo(topGap[inset], 0);
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
  const settingsPanel = await panelGeometry(page, 'Settings', inset);
  expectBottomSheet(settingsPanel);
  // The sheet stays 12px clear of the inset, and its header adds no inset of its own.
  expect(settingsPanel.top).toBeGreaterThanOrEqual(inset + 12 - .5);
  expect(settingsPanel.close.top).toBeCloseTo(settingsPanel.top + 1 + 16 + 12 + 8, 0);
  expect(settingsPanel.close).toMatchObject({ hit: true, inViewport: true });
  expect(await panel(page, 'Settings').evaluate(el => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(20);
  await testInfo.attach(`Settings, ${inset}px inset`, { body: await page.screenshot({ clip: { x: 0, y: 0, width: 393, height: 160 } }), contentType: 'image/png' });
  if (inset) {
    // On a short screen the inset, not 90% of the height, sets the cap.
    await page.setViewportSize({ width: 393, height: 400 });
    await expect.poll(async () => Math.round((await panelGeometry(page, 'Settings', inset)).top)).toBe(inset + 12);
    expectBottomSheet(await panelGeometry(page, 'Settings', inset));
    expect((await panelGeometry(page, 'Settings', inset)).close).toMatchObject({ hit: true, inViewport: true });
  }
  await panelClose(page, 'Settings').tap();
  await expectPanelClosed(page, 'Settings');
});

// Simulated, like the test above. Short landscape keeps Guide's own tighter rule so its timeline keeps room.
for (const inset of [0, 59]) test(`SIMULATED ${inset}px top inset: Guide top spacing in portrait and short landscape`, async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, 'Guide');
  await page.addStyleTag({ content: `:root { --safe-top: ${inset}px; }` });
  const shell = page.locator('main.guide-shell');
  expect(await shell.evaluate(el => getComputedStyle(el).paddingTop)).toBe(`${topGap[inset]}px`);
  expect((await page.locator('.app-header').boundingBox()).y).toBeCloseTo(topGap[inset], 0);
  await page.setViewportSize({ width: 844, height: 390 });
  const landscape = Math.max(inset, 4);
  await expect.poll(() => shell.evaluate(el => getComputedStyle(el).paddingTop)).toBe(`${landscape}px`);
  expect((await page.locator('.app-header').boundingBox()).y).toBeCloseTo(landscape, 0);
});

test('Settings Display details is the visible first row, stays collapsed until opened, reads the raw insets, and remeasures after rotation', async ({ page, harness }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openRoute(page, harness, 'Scores');
  // The app's spacing variable must not leak into the reported device inset.
  await page.addStyleTag({ content: ':root { --safe-top: 59px; }' });
  await openPanel(page, 'Settings');
  const details = panel(page, 'Settings').locator('details.display-details');
  await expect(page.locator('details.display-details')).toHaveCount(1);
  await expect(details).not.toHaveAttribute('open');
  // Opening Settings shows it without scrolling, ahead of the spoiler controls.
  expect(await panelBody(page, 'Settings').evaluate(body => {
    const b = body.getBoundingClientRect(), s = body.querySelector('details.display-details > summary').getBoundingClientRect();
    const spoiler = [...body.querySelectorAll('h3')].find(h => h.textContent === 'Spoiler protection');
    return { scrollTop: body.scrollTop, visible: s.top >= b.top - .5 && s.bottom <= b.bottom + .5, first: !!(spoiler.compareDocumentPosition(body.querySelector('details.display-details')) & Node.DOCUMENT_POSITION_PRECEDING) };
  })).toEqual({ scrollTop: 0, visible: true, first: true });
  await details.locator('summary').tap();
  const value = label => details.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd');
  await expect(value('Window size')).toHaveText('320 × 568');
  await expect(value('Safe-area insets')).toHaveText('Top 0px, right 0px, bottom 0px, left 0px');
  // The harness simulates navigator.standalone === true (a Home Screen app).
  await expect(value('Display mode')).toHaveText(/^\S+ \(Home Screen app\)$/);
  await expect(value('Visible area')).toHaveText(/^320 × 568/);
  // false names no particular browser; an unreported value adds nothing. Reopening remeasures.
  for (const [standalone, expected] of [[false, /^\S+ \(browser tab, not a Home Screen app\)$/], [undefined, /^\S+$/]]) {
    await page.evaluate(reported => Object.defineProperty(navigator, 'standalone', { configurable: true, value: reported }), standalone);
    await details.locator('summary').tap();
    await expect(details).not.toHaveAttribute('open');
    await details.locator('summary').tap();
    await expect(value('Display mode')).toHaveText(expected);
  }
  expect(await details.locator('dd').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1))).toBe(true);
  await page.setViewportSize({ width: 568, height: 320 });
  await expect(value('Window size')).toHaveText('568 × 320');
  expect((await panelGeometry(page, 'Settings', 59)).body.horizontal).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expectPanelClosed(page, 'Settings');
  // Help no longer carries it.

  await openPanel(page, 'Help');
  await expect(page.locator('details.display-details')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expectPanelClosed(page, 'Help');
});

// Real browser pointer routing; these are desktop-engine gestures, not native iPhone proof.
for (const name of Object.keys(panels)) test(`${name}: header pull snaps back or dismisses; body and Close stay independent`, async ({ page, harness }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openPanel(page, name);
  const root = panel(page, name), grip = root.locator('.app-panel-grip');
  const initial = await root.boundingBox();
  expect(initial.y).toBeCloseTo(24, 0);
  const start = await grip.boundingBox(), x = start.x + start.width / 2, y = start.y + start.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + 24, { steps: 5 });
  expect((await root.boundingBox()).y).toBeCloseTo(initial.y + 24, 0);
  await page.mouse.up();
  await expect.poll(async () => Math.round((await root.boundingBox()).y)).toBe(24);
  await expect(root).toBeVisible();
  // Even a quick short pull is not a dismissal: speed cannot turn it into a flick close.
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 40); await page.mouse.up();
  await expect.poll(async () => Math.round((await root.boundingBox()).y)).toBe(24);
  // Upward pulls do not move or close the panel.
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 16); await page.mouse.up();
  await expect.poll(async () => Math.round((await root.boundingBox()).y)).toBe(24);
  // Text remains a scroll region; a pull starting there never drives the panel.
  const bodyBox = await panelBody(page, name).boundingBox();
  await page.mouse.move(bodyBox.x + 20, bodyBox.y + 40); await page.mouse.down();
  await page.mouse.move(bodyBox.x + 20, bodyBox.y + 160, { steps: 5 }); await page.mouse.up();
  expect((await root.boundingBox()).y).toBeCloseTo(24, 0);
  await testInfoCapture(page, info, `${name}-higher-open`);
  // A deliberate header pull closes and returns focus without changing preferences/alerts.
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + 145, { steps: 12 }); await page.mouse.up();
  await expectPanelClosed(page, name);
  expect(await storedPrefs(page)).toBe(before);
  expect(nonGetAlertRequests(harness)).toEqual([]);
  await openPanel(page, name);
  expect(await panelBody(page, name).evaluate(el => el.scrollTop)).toBe(0);
  await panelClose(page, name).tap(); await expectPanelClosed(page, name);
});
async function testInfoCapture(page, info, name) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

for (const size of [{ width: 393, height: 852 }, { width: 852, height: 393 }]) test(`equal height with short and changing content at ${size.width}px`, async ({ page, harness }) => {
  await page.setViewportSize(size); await openRoute(page, harness, 'Scores');
  const tops = [];
  for (const name of Object.keys(panels)) {
    await openPanel(page, name);
    const root = panel(page, name); tops.push((await root.boundingBox()).y);
    // Empty content exercises the previous shrink-to-content defect without changing app state.
    await panelBody(page, name).evaluate(el => el.replaceChildren());
    expect((await root.boundingBox()).y).toBeCloseTo(24, 0);
    await panelBody(page, name).evaluate(el => { const p = document.createElement('p'); p.style.height = '2000px'; p.textContent = 'Layout test content'; el.append(p); });
    expect((await root.boundingBox()).y).toBeCloseTo(24, 0);
    await panelClose(page, name).tap(); await expectPanelClosed(page, name);
  }
  expect(tops.map(Math.round)).toEqual([24, 24, 24]);
});

test('header drag cancels on viewport resize and preserves body reading position', async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 600 }); await openRoute(page, harness, 'Scores');
  await openPanel(page, 'Help'); const root = panel(page, 'Help'), region = panelBody(page, 'Help');
  await region.evaluate(el => { el.scrollTop = 100; });
  const grip = await root.locator('.app-panel-grip').boundingBox();
  await page.mouse.move(grip.x + 40, grip.y + 4); await page.mouse.down(); await page.mouse.move(grip.x + 40, grip.y + 44);
  await page.setViewportSize({ width: 600, height: 393 }); await page.mouse.up();
  await expect(root).toBeVisible(); await expect.poll(async () => Math.round((await root.boundingBox()).y)).toBe(24);
  expect(await region.evaluate(el => el.scrollTop)).toBe(100);
  await page.keyboard.press('Escape'); await expectPanelClosed(page, 'Help');
  await openPanel(page, 'Help'); expect(await panelBody(page, 'Help').evaluate(el => el.scrollTop)).toBe(0);
  await panelClose(page, 'Help').tap(); await expectPanelClosed(page, 'Help');
});

// Chromium's native input dispatch exercises actual touch-action/capture routing in that engine.
// WebKit has no equivalent dispatch API here; neither lane establishes physical iPhone behavior.
for (const name of Object.keys(panels)) test(`${name}: Chromium touch heading drag, cancellation and body scrolling`, async ({ page, harness, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Touch dispatch requires Chromium CDP; native iPhone remains unverified');
  await page.setViewportSize({ width: 393, height: 600 }); await openRoute(page, harness, 'Scores');
  await openPanel(page, name); const root = page.getByRole('dialog');
  const region = root.locator('.app-panel-body');
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, radiusX: 2, radiusY: 2 }] });
  const title = await root.locator('[data-slot="sheet-title"]').boundingBox();
  const x = title.x + 30, y = title.y + 8;
  await send('touchStart', x, y);
  for (let d = 6; d <= 24; d += 6) { await page.waitForTimeout(20); await send('touchMove', x, y + d); }
  await expect.poll(async () => Math.round((await root.boundingBox()).y)).toBe(48);
  await send('touchEnd'); await expect.poll(async () => Math.round((await root.boundingBox()).y)).toBe(24);
  // Cancellation after crossing the distance threshold must still snap back, never close.
  await send('touchStart', x, y); await send('touchMove', x, y + 145); await send('touchCancel');
  await expect(root).toBeVisible(); await expect.poll(async () => Math.round((await root.boundingBox()).y)).toBe(24);
  // Force a long heading: text scrolls independently; the grip still owns panel dragging.
  await root.locator('[data-slot="sheet-title"]').evaluate(el => { el.textContent = 'Long accessible heading '.repeat(30); });
  await expect(root.locator('.app-panel-header')).toHaveAttribute('data-heading-scrolls', 'true');
  expect((await root.locator('.app-panel-grip').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await testInfoCapture(page, info, `${name}-overflowing-heading-grip`);
  const heading = root.locator('.app-panel-heading'), h = await heading.boundingBox();
  await send('touchStart', h.x + 20, h.y + h.height - 20);
  for (let d = 15; d <= 75; d += 15) { await page.waitForTimeout(20); await send('touchMove', h.x + 20, h.y + h.height - 20 - d); }
  await send('touchEnd'); await expect.poll(() => heading.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await root.boundingBox()).y).toBeCloseTo(24, 0);
  const b = await region.boundingBox();
  // Inject scroll extent only in this layout fixture, then use real touch routing to scroll it.
  await region.evaluate(el => { const p = document.createElement('p'); p.style.height = '1500px'; el.append(p); });
  await send('touchStart', b.x + 30, b.y + b.height - 30);
  for (let d = 15; d <= 90; d += 15) { await page.waitForTimeout(20); await send('touchMove', b.x + 30, b.y + b.height - 30 - d); }
  await send('touchEnd'); await expect.poll(() => region.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await root.boundingBox()).y).toBeCloseTo(24, 0);
  const grip = await root.locator('.app-panel-grip').boundingBox();
  await send('touchStart', grip.x + 40, grip.y + 4);
  for (let d = 15; d <= 150; d += 15) { await page.waitForTimeout(20); await send('touchMove', grip.x + 40, grip.y + 4 + d); }
  await send('touchEnd'); await expect(root).toHaveCount(0); await expectPanelClosed(page, name); await cdp.detach();
  await info.attach('touch-scope', { body: 'Chromium CDP native input; desktop engine mobile emulation, not iPhone', contentType: 'text/plain' });
});

test('resize during the closing slide does not reset its committed drag position', async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 852 }); await openRoute(page, harness, 'Scores');
  await openPanel(page, 'Help'); const root = panel(page, 'Help');
  await root.evaluate(el => {
    window.__closingPosition = null;
    new MutationObserver((_, observer) => {
      if (el.dataset.state !== 'closed') return;
      observer.disconnect();
      const before = el.style.translate;
      // Synthetic resize notification verifies the closing-offset lifecycle, not native rotation.
      dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__closingPosition = { before, after: el.style.translate }; }));
    }).observe(el, { attributes: true, attributeFilter: ['data-state'] });
  });
  const grip = await root.locator('.app-panel-grip').boundingBox();
  await page.mouse.move(grip.x + 40, grip.y + 4); await page.mouse.down(); await page.mouse.move(grip.x + 40, grip.y + 149); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__closingPosition)).toEqual({ before: '0px 145px', after: '0px 145px' });
  await expectPanelClosed(page, 'Help');
});

// A script click() on the dialog's own trigger while the closing slide still runs, not a physical tap:
// the closing backdrop still covers the trigger then. Radix keeps the same dialog node for that
// reopening; this checks the component's lifecycle in a desktop engine, not native iPhone behavior.
for (const name of Object.keys(panels)) test(`${name}: reopening before the closing slide ends reuses the sheet and starts it fresh`, async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 852 }); await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openPanel(page, name); const root = panel(page, name), region = panelBody(page, name);
  // Layout fixture only: give the body scroll extent, then leave it scrolled and focused.
  await region.evaluate(el => { const p = document.createElement('p'); p.style.height = '2000px'; el.append(p); el.scrollTop = 100; });
  await region.focus(); await expect(region).toBeFocused();
  await root.evaluate(el => {
    // Find the trigger while open, the same way the component records it.
    const triggers = document.querySelectorAll(`[aria-controls="${CSS.escape(el.id)}"]`);
    window.__reopen = { node: el, triggers: triggers.length, closing: null };
    new MutationObserver((_, observer) => {
      if (el.dataset.state !== 'closed') return;
      observer.disconnect();
      const translate = el.style.translate;
      // Two frames into the exit slide, while it is still running.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__reopen.closing = { translate, exitRunning: el.getAnimations().some(a => a.playState === 'running'), connected: el.isConnected };
        triggers[0].click();
      }));
    }).observe(el, { attributes: true, attributeFilter: ['data-state'] });
  });
  expect(await page.evaluate(() => window.__reopen.triggers)).toBe(1);
  const grip = await root.locator('.app-panel-grip').boundingBox();
  await page.mouse.move(grip.x + 40, grip.y + 4); await page.mouse.down(); await page.mouse.move(grip.x + 40, grip.y + 149); await page.mouse.up();
  // The deliberate pull closed from 145px and kept it while closing; the reopen came mid-exit.
  await expect.poll(() => page.evaluate(() => window.__reopen.closing)).toEqual({ translate: '0px 145px', exitRunning: true, connected: true });
  await expectSheetOpen(root);
  expect(await root.evaluate(el => ({ sameNode: el === window.__reopen.node, state: el.dataset.state, translateY: parseFloat(el.style.translate.split(' ')[1] ?? '0') })))
    .toEqual({ sameNode: true, state: 'open', translateY: 0 });
  expect(Math.round((await root.boundingBox()).y)).toBe(24);
  await expect(panelClose(page, name)).toBeFocused();
  expect(await region.evaluate(el => el.scrollTop)).toBe(0);
  await panelClose(page, name).tap(); await expectPanelClosed(page, name);
  expect(await storedPrefs(page)).toBe(before);
  expect(nonGetAlertRequests(harness)).toEqual([]);
});

// After a deliberate pull closes a sheet all the way, Radix removes its node while this component stays
// mounted. The next opening is a new node that must enter on the sheet's own slide alone: no leftover
// drag offset and no translate transition at any frame of the entry, not only once it settles.
// Frames are sampled from requestAnimationFrame only, so the test forces no style at insertion.
for (const name of Object.keys(panels)) test(`${name}: a fresh opening after a pull-to-close enters with no leftover drag offset`, async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 852 }); await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openPanel(page, name); const root = panel(page, name);
  await root.evaluate(el => { window.__pulled = el; });
  const grip = await root.locator('.app-panel-grip').boundingBox();
  await page.mouse.move(grip.x + 40, grip.y + 4); await page.mouse.down(); await page.mouse.move(grip.x + 40, grip.y + 149); await page.mouse.up();
  await expectPanelClosed(page, name);
  expect(await page.evaluate(() => window.__pulled.isConnected)).toBe(false);
  expect(await storedPrefs(page)).toBe(before);
  await page.evaluate(() => {
    const transition = a => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition;
    const entry = window.__entry = { samples: [], stop: false };
    const frame = () => {
      if (entry.stop) return;
      const el = document.querySelector('[role="dialog"][data-state="open"]');
      if (el) {
        const translate = getComputedStyle(el).translate, animations = el.getAnimations();
        entry.samples.push({
          node: el, fresh: el !== window.__pulled,
          offset: translate === 'none' ? 0 : Math.max(...translate.split(' ').map(v => Math.abs(parseFloat(v)))),
          translateTransitions: animations.filter(a => transition(a) && a.transitionProperty === 'translate').length,
          entering: animations.some(a => !transition(a) && a.playState === 'running'),
        });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await panelTrigger(page, name).tap();
  await expect(panel(page, name)).toBeVisible();
  await expectSheetOpen(panel(page, name));
  const { samples, current } = await page.evaluate(() => {
    const entry = window.__entry; entry.stop = true;
    const node = entry.samples[0]?.node;
    return {
      current: !!node && document.querySelector('[role="dialog"][data-state="open"]') === node,
      samples: entry.samples.map(({ node: sampled, ...sample }) => ({ ...sample, sameNode: sampled === node })),
    };
  });
  expect(samples.length).toBeGreaterThan(1);
  // The very first frame is already the new node in its entering slide, with no translate of its own.
  expect(samples[0]).toEqual({ fresh: true, offset: 0, translateTransitions: 0, entering: true, sameNode: true });
  expect(current).toBe(true);
  expect(samples.filter(s => !s.fresh || !s.sameNode || s.offset !== 0 || s.translateTransitions > 0), 'entry frames with a stale node, offset or translate transition').toEqual([]);
  await expect(panelClose(page, name)).toBeFocused();
  expect(await panelBody(page, name).evaluate(el => el.scrollTop)).toBe(0);
  expect(Math.round((await panel(page, name).boundingBox()).y)).toBe(24);
  await panelClose(page, name).tap(); await expectPanelClosed(page, name);
  expect(await storedPrefs(page)).toBe(before);
  expect(nonGetAlertRequests(harness)).toEqual([]);
});

// Native scroll policy (2026-10-09): an overflowing body or heading leaves edge touch moves to the browser.
// Synthetic, cancelable touch events reach the same listeners in both engines: each region's adapter and
// Radix's document scroll lock. They check routing only; native bounce and the scroll indicator need an
// actual iPhone.
async function syntheticMovePrevented(target, { edge = 'top', dy = edge === 'top' ? 30 : -30, fingers = 1 } = {}) {
  return target.evaluate((el, { edge, dy, fingers }) => {
    el.scrollTop = edge === 'top' ? 0 : el.scrollHeight;
    const r = el.getBoundingClientRect(), x = r.left + 20, y = r.top + r.height / 2;
    const fire = (type, clientY) => {
      const points = Array.from({ length: fingers }, (_, i) => ({ identifier: i, target: el, clientX: x + i * 40, clientY, pageX: x + i * 40, pageY: clientY, screenX: x + i * 40, screenY: clientY }));
      const touch = new Event(type, { bubbles: true, cancelable: true, composed: true });
      for (const key of ['touches', 'targetTouches', 'changedTouches']) Object.defineProperty(touch, key, { value: points });
      el.dispatchEvent(touch); return touch.defaultPrevented;
    };
    fire('touchstart', y); return fire('touchmove', y + dy);
  }, { edge, dy, fingers });
}
const injectOverflow = region => region.evaluate(el => { const p = document.createElement('p'); p.style.height = '1500px'; el.append(p); });

for (const name of Object.keys(panels)) test(`${name}: overflowing scroll regions contain overscroll and leave edge moves to the browser`, async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 600 }); await openRoute(page, harness, 'Scores');
  const prefs = await settledPrefs(page);
  await openPanel(page, name); const root = page.getByRole('dialog');
  const region = root.locator('.app-panel-body'), heading = root.locator('.app-panel-heading');
  const scrolling = el => { const s = getComputedStyle(el); return { overscroll: [s.overscrollBehaviorX, s.overscrollBehaviorY], overflowY: s.overflowY, scrollbarWidth: CSS.supports('scrollbar-width', 'auto') ? s.scrollbarWidth : 'auto' }; };
  const native = { overscroll: ['contain', 'contain'], overflowY: 'auto', scrollbarWidth: 'auto' };
  expect(await region.evaluate(scrolling)).toEqual(native);
  expect(await heading.evaluate(scrolling)).toEqual(native);
  // Short content stays with the lock.
  const short = await page.addStyleTag({ content: '.app-panel-body > * { display: none !important; }' });
  expect(await syntheticMovePrevented(region)).toBe(true);
  await short.evaluate(el => el.remove());
  await injectOverflow(region);
  expect(await syntheticMovePrevented(region)).toBe(false);
  expect(await syntheticMovePrevented(region, { edge: 'bottom' })).toBe(false);
  expect(await syntheticMovePrevented(region, { fingers: 2 })).toBe(false);
  expect(await syntheticMovePrevented(page.locator('[data-slot="sheet-overlay"]'))).toBe(true);
  expect(await syntheticMovePrevented(heading)).toBe(true);
  await root.locator('[data-slot="sheet-title"]').evaluate(el => { el.textContent = 'Long accessible heading '.repeat(30); });
  await expect(root.locator('.app-panel-header')).toHaveAttribute('data-heading-scrolls', 'true');
  expect(await syntheticMovePrevented(heading)).toBe(false);
  expect(await syntheticMovePrevented(heading, { edge: 'bottom' })).toBe(false);
  await expect(root).toBeVisible(); expect((await root.boundingBox()).y).toBeCloseTo(24, 0);
  expect(JSON.parse(await storedPrefs(page))).toEqual(JSON.parse(prefs)); expect(nonGetAlertRequests(harness)).toEqual([]);
});

// Baseline: Radix cancelled every cancelable outward move at a region's edge. Chromium's native touch input
// now reaches both body edges and the heading's, reverses, and scrolls back with nothing prevented, while
// the panel and the page behind it stay put. Event routing only; not bounce, indicator or iPhone proof.
for (const name of Object.keys(panels)) test(`${name}: Chromium touch at body and heading edges is never cancelled`, async ({ page, harness, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Touch dispatch requires Chromium CDP; native iPhone remains unverified');
  await page.setViewportSize({ width: 393, height: 600 }); await openRoute(page, harness, 'Scores');
  const prefs = await settledPrefs(page);
  await openPanel(page, name); const root = page.getByRole('dialog');
  const region = root.locator('.app-panel-body'), heading = root.locator('.app-panel-heading');
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 2, radiusY: 2 }] });
  // Document capture sees each move before a region's adapter stops it; a task later, once bubbling and
  // Radix's lock are done with that same event, its final defaultPrevented is recorded.
  await page.evaluate(() => { window.__moves = []; document.addEventListener('touchmove', e => { setTimeout(() => window.__moves.push({ cancelable: e.cancelable, prevented: e.defaultPrevented })); }, { capture: true, passive: true }); });
  async function gesture(x, y, waypoints) {
    await page.evaluate(() => { window.__moves.length = 0; });
    await send('touchStart', x, y);
    for (const [dx, dy] of waypoints) { await page.waitForTimeout(20); await send('touchMove', x + dx, y + dy); }
    await send('touchEnd');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    const moves = await page.evaluate(() => window.__moves.slice());
    return { cancelableAllowed: moves.some(m => m.cancelable && !m.prevented), prevented: moves.filter(m => m.prevented).length };
  }
  const unprevented = { cancelableAllowed: true, prevented: 0 };
  // Outward past the edge, then reversed into the content.
  const path = sign => [15, 30, 45, 60, 30, 0, -30, -60].map(d => [0, sign * d]);
  async function settledScroll(locator) {
    let last = -1;
    await expect.poll(async () => { const now = await locator.evaluate(el => el.scrollTop); const same = now === last; last = now; return same; }).toBe(true);
    return last;
  }
  const background = () => page.evaluate(() => [scrollX, scrollY]);
  const behind = await background();
  await injectOverflow(region); await region.evaluate(el => { el.scrollTop = 0; });
  const b = await region.boundingBox(), x = b.x + 30, y = b.y + b.height / 2;
  expect(await gesture(x, y, path(1))).toEqual(unprevented);
  expect(await settledScroll(region)).toBeGreaterThan(0);
  const bottom = await region.evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
  expect(await gesture(x, y, path(-1))).toEqual(unprevented);
  expect(await settledScroll(region)).toBeLessThan(bottom);
  // A sideways swipe on the body neither moves the panel nor reaches the page behind it.
  const sideways = await gesture(b.x + b.width - 40, y, [[-30, 0], [-60, 2], [-90, 2], [-120, 4]]);
  expect(sideways.prevented).toBe(0);
  expect(await region.evaluate(el => el.scrollLeft)).toBe(0);
  await root.locator('[data-slot="sheet-title"]').evaluate(el => { el.textContent = 'Long accessible heading '.repeat(30); });
  await expect(root.locator('.app-panel-header')).toHaveAttribute('data-heading-scrolls', 'true');
  await heading.evaluate(el => { el.scrollTop = 0; });
  const h = await heading.boundingBox();
  expect(await gesture(h.x + 20, h.y + h.height / 2, path(1))).toEqual(unprevented);
  expect(await settledScroll(heading)).toBeGreaterThan(0);
  expect(await background()).toEqual(behind);
  await expect(root).toBeVisible(); expect((await root.boundingBox()).y).toBeCloseTo(24, 0);
  expect(JSON.parse(await storedPrefs(page))).toEqual(JSON.parse(prefs)); expect(nonGetAlertRequests(harness)).toEqual([]);
  await cdp.detach();
  await info.attach('touch-scope', { body: 'Chromium CDP native input routing only; native bounce and scroll indicator unverified, not iPhone', contentType: 'text/plain' });
});

// A nested confirmation hides the Settings panel; its overflowing body then stays under the scroll lock,
// and the adapter resumes once the confirmation closes and again on a fresh opening.
test('a nested confirmation keeps the Settings body under the scroll lock until it closes', async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, duke('duke-away')];
  await openRoute(page, harness, 'Scores');
  const before = await settledPrefs(page);
  await openSettings(page, 'tap');
  const region = page.locator('.app-panel-body');
  const hidden = () => region.evaluate(el => !!el.closest('[aria-hidden="true"], [inert]'));
  await injectOverflow(region);
  expect(await syntheticMovePrevented(region)).toBe(false);
  const confirm = page.getByRole('alertdialog', { name: 'Show this game only?', exact: true });
  const keep = confirm.getByRole('button', { name: 'Keep hidden', exact: true });
  await settings(page).getByRole('button', { name: 'Show Duke game on Sep 5', exact: true }).tap();
  await expect(keep).toBeFocused();
  await expect.poll(hidden).toBe(true);
  expect(await syntheticMovePrevented(region)).toBe(true);
  await page.evaluate(() => Promise.all([...document.querySelectorAll('[data-slot="alert-dialog-overlay"], [data-slot="alert-dialog-content"]')]
    .flatMap(el => el.getAnimations({ subtree: true })).map(animation => animation.finished.catch(() => {}))));
  await keep.tap();
  await expect(confirm).toHaveCount(0);
  await expect.poll(hidden).toBe(false);
  expect(await syntheticMovePrevented(region)).toBe(false);
  await closeButton(page).tap(); await expectClosed(page);
  await openSettings(page, 'tap'); await injectOverflow(region);
  expect(await syntheticMovePrevented(region)).toBe(false);
  expect(JSON.parse(await storedPrefs(page))).toEqual(JSON.parse(before));
});
