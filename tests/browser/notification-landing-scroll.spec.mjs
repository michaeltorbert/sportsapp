import { test, expect, event } from "./fixtures.mjs";

// A notification link scrolls its displayed card into view exactly once, then opens its game, whichever
// scoreboard (the selected day or the football week) the app applies first. Order is made deterministic by
// holding one board's fixture fulfillment until the other board's response has finished and the app has
// had time to apply it; payloads are unchanged. The natural-timing case stays in app-update.spec.mjs.
const DAY = /[?&]dates=20260905(&|$)/, WEEK = /[?&]dates=20260903-20260908(&|$)/;
// Real time for the app to apply the first board before the second is released. Only order depends on it:
// a premature open shows as a failure, never as a pass.
const APPLY_MS = 300;
const TARGET = "notification-only";

async function holdBoard(page, held, other) {
  let release, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const otherFinished = new Promise(resolve => { finished = resolve; });
  page.on("requestfinished", request => { if (other.test(request.url())) finished(); });
  await page.route(url => held.test(url.href), async route => { await gate; await route.fallback(); });
  return { otherApplied: otherFinished.then(() => new Promise(resolve => setTimeout(resolve, APPLY_MS))), release };
}

// Counts real scrollIntoView calls (keeping the actual scroll) and the scroll position each one leaves.
async function countScrolls(page, { denyStorage = false } = {}) {
  await page.addInitScript(deny => {
    window.__scrolls = []; window.__landingY = null;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      window.__scrolls.push({ id: this.id, screenOpen: !!document.querySelector(".game-screen") });
      const result = original.apply(this, args);
      window.__landingY = window.scrollY;
      return result;
    };
    if (deny) {
      Storage.prototype.getItem = function () { throw new Error("storage denied"); };
      Storage.prototype.setItem = function () { throw new Error("storage denied"); };
      Object.defineProperty(window, "caches", { value: { delete() { throw new Error("Updater must not delete caches"); } } });
    }
  }, denyStorage);
}
const scrolls = page => page.evaluate(() => window.__scrolls);

// Qualifying upcoming games list before the notification's final, so its card starts below the fold.
function events(target = event(TARGET, { state: "final", scores: [0, 28] })) {
  return [...Array.from({ length: 24 }, (_, i) => event(`filler-${i}`, { rank: 1 + i, state: "upcoming", date: "2026-09-05T20:00:00Z" })), target];
}
const open = (harness, path = `/?date=2026-09-05#game-${TARGET}`) => harness.open({ path, waitForScores: false });
const title = page => page.locator(".game-screen h1.game-title");
const card = page => page.locator(`#game-${TARGET}`);
const settled = page => expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
// Viewport pixels from the real renderer for review, named by engine and state; the build's identity is in
// the run's config metadata.
async function shot(page, testInfo, state) {
  const name = `notification-landing-${testInfo.project.name}-${state}`, path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

for (const denyStorage of [false, true]) test(`week board first: the day card scrolls once before its game opens, then Back restores it${denyStorage ? " (storage denied, caches untouched)" : ""}`, async ({ page, harness }, testInfo) => {
  harness.state.events = events();
  await countScrolls(page, { denyStorage });
  const day = await holdBoard(page, DAY, WEEK);
  await open(harness);
  await day.otherApplied;
  // The week board alone neither opens the game nor consumes the landing.
  await expect(page.locator(".game-screen")).toHaveCount(0);
  expect(await scrolls(page)).toEqual([]);
  if (!denyStorage) await shot(page, testInfo, "1-waiting-for-day-board");
  day.release();
  await expect(title(page)).toContainText(`${TARGET} away`);
  expect(await scrolls(page)).toEqual([{ id: `game-${TARGET}`, screenOpen: false }]);
  const landingY = await page.evaluate(() => window.__landingY);
  expect(landingY).toBeGreaterThan(0);
  expect(new URL(page.url()).hash).toBe("");
  if (!denyStorage) await shot(page, testInfo, "2-game-open");
  await page.locator(".game-screen").getByRole("button", { name: /^Back to scores/ }).click();
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("a.game-summary")).toBeFocused();
  expect(Math.abs(await page.evaluate(() => window.scrollY) - landingY)).toBeLessThanOrEqual(1);
  if (!denyStorage) {
    await shot(page, testInfo, "3-back-at-saved-card-position");
    // The category counts in their normal initial context, from the top of the same loaded board.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".filter-tabs")).toBeInViewport();
    await shot(page, testInfo, "4-counts-top-of-board");
    await page.evaluate(y => window.scrollTo(0, y), landingY);
  }
  // No new landing after Back or a refresh, and the consumed notification never reopens.
  await page.getByRole("button", { name: "Refresh scores" }).click(); await settled(page);
  await page.clock.fastForward(1_000);
  expect(await scrolls(page)).toHaveLength(1);
  await expect(page.locator(".game-screen")).toHaveCount(0);
});

test("day board first: the card scrolls once, then the game opens", async ({ page, harness }) => {
  harness.state.events = events();
  await countScrolls(page);
  const week = await holdBoard(page, WEEK, DAY);
  await open(harness);
  await expect(title(page)).toContainText(`${TARGET} away`);
  expect(await scrolls(page)).toEqual([{ id: `game-${TARGET}`, screenOpen: false }]);
  week.release(); await week.otherApplied;
  await page.locator(".game-screen").getByRole("button", { name: /^Back to scores/ }).click();
  await expect(card(page).locator("a.game-summary")).toBeFocused();
  expect(await scrolls(page)).toHaveLength(1);
});

test("Week display waits for the week board, not the day board, before opening", async ({ page, harness }) => {
  harness.state.events = events();
  await countScrolls(page);
  const week = await holdBoard(page, WEEK, DAY);
  await open(harness, `/?date=2026-09-05&period=week#game-${TARGET}`);
  await week.otherApplied;
  await expect(page.locator(".game-screen")).toHaveCount(0);
  expect(await scrolls(page)).toEqual([]);
  week.release();
  await expect(title(page)).toContainText(`${TARGET} away`);
  expect(await scrolls(page)).toEqual([{ id: `game-${TARGET}`, screenOpen: false }]);
});

test("a failed day board never blocks the notification: the week board opens it once, with no card to scroll", async ({ page, harness }) => {
  harness.state.events = events();
  await countScrolls(page);
  await page.route(url => DAY.test(url.href), route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "simulated day failure" }) }));
  await open(harness);
  await expect(title(page)).toContainText(`${TARGET} away`);
  expect(await scrolls(page)).toEqual([]);
  await page.locator(".game-screen").getByRole("button", { name: /^Back to scores/ }).click();
  await expect(page.locator(".game-screen")).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(page.locator(".game-screen")).toHaveCount(0);
  expect(await scrolls(page)).toEqual([]);
});

test("a week-only notification game opens once after the day board loads, without a card scroll", async ({ page, harness }) => {
  harness.state.events = events(event(TARGET, { state: "upcoming", date: "2026-09-06T21:00:00Z" }));
  await countScrolls(page);
  const day = await holdBoard(page, DAY, WEEK);
  await open(harness);
  await day.otherApplied;
  await expect(page.locator(".game-screen")).toHaveCount(0);
  day.release();
  await expect(title(page)).toContainText(`${TARGET} away`);
  await page.locator(".game-screen").getByRole("button", { name: /^Back to scores/ }).click();
  await expect(page.locator(".game-screen")).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(page.locator(".game-screen")).toHaveCount(0);
  expect(await scrolls(page)).toEqual([]);
});

test("a protected Duke notification stays hidden whichever board arrives first", async ({ page, harness }) => {
  // ORD-019: a started game with Duke as the confirmed away team is hidden by default.
  const duke = event("duke-hidden", { acc: true });
  duke.competitions[0].neutralSite = false;
  Object.assign(duke.competitions[0].competitors[0].team, { id: "150", shortDisplayName: "Duke" });
  harness.state.events = events(duke);
  await countScrolls(page);
  const day = await holdBoard(page, DAY, WEEK);
  await open(harness, "/?date=2026-09-05#game-duke-hidden");
  await day.otherApplied;
  day.release(); await settled(page);
  await page.clock.fastForward(1_000);
  await expect(page.locator(".game-screen")).toHaveCount(0);
  await expect(page.locator("#game-duke-hidden")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show Duke game on Sep 5", exact: true })).toBeVisible();
  expect(await scrolls(page)).toEqual([]);
});

test("input while the notification waits cancels its opening but keeps the one landing scroll", async ({ page, harness }) => {
  harness.state.events = events();
  await countScrolls(page);
  const day = await holdBoard(page, DAY, WEEK);
  await open(harness);
  await day.otherApplied;
  await page.keyboard.press("Shift");
  day.release(); await settled(page);
  await expect(card(page)).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(page.locator(".game-screen")).toHaveCount(0);
  expect(await scrolls(page)).toEqual([{ id: `game-${TARGET}`, screenOpen: false }]);
});
