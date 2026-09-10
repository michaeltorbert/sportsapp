import { readFileSync } from "node:fs";
import { test, expect, event } from "./fixtures.mjs";
const archive = JSON.parse(readFileSync(new URL("../fixtures/guide-2026-09-12.json", import.meta.url)));
const region = page => page.getByRole("region", { name: "Network and time schedule" });
const dateInput = page => page.getByLabel("Guide date, Eastern time");
async function openGuide(page, harness, options = {}) {
  harness.state.events = structuredClone(archive.events);
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false, ...options });
  await expect(page.getByRole("button", { name: "Refresh guide", exact: true })).toBeEnabled();
  await expect(page.getByTestId("guide-count")).toContainText("games listed");
}

test("Guide URL owner preserves date/mode across reload, Back/Forward and app navigation without mode refetch", async ({ page, harness }) => {
  await openGuide(page, harness);
  const initial = await page.getByTestId("guide-count").innerText();
  const requests = harness.state.scoreRequests.length;
  const mounts = await page.evaluate(() => { window.__guideOriginal = document.querySelector(".guide-shell"); return !!window.__guideOriginal; });
  expect(mounts).toBe(true);
  await page.getByRole("button", { name: "Watchlist only", exact: true }).click();
  await expect(page).toHaveURL(/view=watch/);
  await expect(page.getByTestId("guide-count")).not.toHaveText(initial);
  expect(harness.state.scoreRequests.length).toBe(requests);
  expect(await page.evaluate(() => window.__guideOriginal === document.querySelector(".guide-shell"))).toBe(true);
  await page.goBack(); await expect(page.getByRole("button", { name: "All games", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goForward(); await expect(page.getByRole("button", { name: "Watchlist only", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload(); await expect(dateInput(page)).toHaveValue("2026-09-12");
  await expect(page.getByRole("button", { name: "Watchlist only", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Scores", exact: true }).click();
  await expect(page.getByLabel("Scoreboard date, Eastern time")).toHaveValue("2026-09-12");
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await expect(dateInput(page)).toHaveValue("2026-09-12");
  await expect(page.getByRole("button", { name: "All games", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("full archive geometry, scrolling, accessible details and responsive screenshots", async ({ page, harness }, testInfo) => {
  await openGuide(page, harness);
  const bars = page.locator(".guide-game");
  expect(await bars.count()).toBeGreaterThan(25);
  await expect(bars.first()).toHaveAttribute("aria-label", /2026-09-12/);
  const measurements = await bars.evaluateAll(elements => elements.slice(0, 20).map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, start: Number(el.dataset.start), x: el.parentElement.getBoundingClientRect().left - el.parentElement.parentElement.getBoundingClientRect().left })));
  for (const m of measurements) { expect(m.width).toBeCloseTo(315, 0); expect(m.height).toBeGreaterThanOrEqual(44); }
  for (const a of measurements) for (const b of measurements) expect(a.x - b.x).toBeCloseTo((a.start - b.start) / 3_600_000 * 90, 0);
  await bars.first().focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Listed on");
  await expect(page.getByRole("link", { name: "Open Gamecast" })).toHaveAttribute("href", /^https:\/\/www\.espn\.com\//);
  await page.keyboard.press("Escape"); await expect(bars.first()).toBeFocused();
  await region(page).evaluate(el => { el.scrollLeft = 260; el.scrollTop = 90; });
  await page.getByRole("button", { name: "Refresh guide", exact: true }).click();
  await expect.poll(() => region(page).evaluate(el => el.scrollLeft)).toBe(260);
  for (const [name, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["short-landscape", 844, 330], ["desktop", 1280, 850], ["narrow", 320, 640]]) {
    await page.setViewportSize({ width, height });
    await region(page).evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (name.includes("landscape")) expect((await region(page).boundingBox()).y).toBeLessThanOrEqual(196);
    const shot = testInfo.outputPath(`guide-${name}.png`);
    await page.screenshot({ path: shot, fullPage: true, animations: "disabled" });
    await testInfo.attach(`guide-${name}`, { path: shot, contentType: "image/png" });
  }
});

test("TBD, unknown networks, concurrent listings, filtered-empty and partial warnings stay visible", async ({ page, harness }) => {
  const tbd = event("tbd", { date: "2026-09-12T20:00:00Z", state: "upcoming" }); tbd.competitions[0].timeValid = false; tbd.competitions[0].broadcasts = [null];
  const unknown = event("unknown", { date: "2026-09-12T20:00:00Z", state: "upcoming" }); unknown.competitions[0].broadcasts = [];
  const stream1 = event("stream1", { date: "2026-09-12T20:00:00Z", state: "upcoming" }); stream1.competitions[0].broadcasts = [{ names: ["ESPN+", "SECN+"] }];
  const stream2 = structuredClone(stream1); stream2.id = "stream2";
  harness.state.events = [tbd, unknown, stream1, stream2, { id: "unreadable" }];
  await harness.open({ path: "/guide?date=2026-09-12", waitForScores: false });
  await expect(page.getByTestId("guide-count")).toContainText("4 games listed");
  await expect(page.getByRole("heading", { name: "Time TBD", exact: true })).toBeVisible();
  await expect(page.locator(".guide-game[data-game=tbd]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Network TBD", exact: true })).toBeVisible();
  await expect(page.locator('[data-network="espn+"] .guide-game')).toHaveCount(2);
  await expect(page.getByRole("alert")).toContainText("Some games could not be read");
  await page.getByRole("button", { name: "Watchlist only", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No Watchlist games on this day" })).toBeVisible();
  await page.getByRole("button", { name: "All games", exact: true }).click();
  await expect(page.getByTestId("guide-count")).toContainText("4 games listed");
});

test("manual-day freshness ignores failed overnight probe; stale refresh retains data with retry", async ({ page, harness }) => {
  await page.route("https://site.api.espn.com/**/scoreboard?*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("dates") === "20260911") return route.fulfill({ status: 503, body: "unavailable" });
    return route.fallback();
  });
  await openGuide(page, harness);
  await expect(page.locator(".guide-feed")).toContainText("Updated just now");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const count = await page.getByTestId("guide-count").innerText();
  harness.state.failScores = true;
  await page.getByRole("button", { name: "Refresh guide", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not refresh");
  await expect(page.getByTestId("guide-count")).toHaveText(count);
  harness.state.failScores = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Guide follows late games overnight; manual date remains fixed; clean inherited update keys", async ({ page, harness }) => {
  harness.state.events = [event("overnight", { rank: 5 }), event("today", { date: "2026-09-06T20:00:00Z", rank: 5, state: "upcoming" })];
  await harness.open({ path: "/guide", now: "2026-09-06T04:01:00Z", waitForScores: false });
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  harness.state.events[0] = event("overnight", { rank: 5, state: "final" });
  await page.clock.fastForward(31_000);
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await page.goto(`/guide?date=2026-09-05&view=watch&tab=acc&_ss_update=${"a".repeat(40)}&_ss_hide_finals=1`);
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(page).toHaveURL(/\/guide\?date=2026-09-05&view=watch$/);
  await page.clock.fastForward(31_000); await expect(dateInput(page)).toHaveValue("2026-09-05");
});

test("first offline mount reports unavailable, with no fabricated cache reopening", async ({ page, harness }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { value: false, configurable: true }));
  harness.state.failScores = true;
  await harness.open({ path: "/guide?date=2026-09-12", waitForScores: false });
  await expect(page.getByRole("heading", { name: "Schedule temporarily unavailable" })).toBeVisible();
  await expect(page.locator(".guide-game")).toHaveCount(0);
});

test("manual Guide day loads and changes immediately while yesterday is pending", async ({ page, harness }) => {
  const waiting = [];
  await page.route("https://site.api.espn.com/**/scoreboard?*", async route => {
    if (new URL(route.request().url()).searchParams.get("dates") !== "20260911") return route.fallback();
    await new Promise(resolve => waiting.push(resolve));
    await route.fulfill({ status: 503, body: "unavailable" }).catch(() => {});
  });
  try {
    harness.state.events = structuredClone(archive.events);
    await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
    await expect(page.getByTestId("guide-count")).toContainText("games listed");
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(dateInput(page)).toHaveValue("2026-09-13");
    await expect(page.getByRole("heading", { name: "No games listed for this day" })).toBeVisible();
    await expect(page.locator(".guide-game")).toHaveCount(0);
  } finally { waiting.forEach(resolve => resolve()); }
});

test("verified app refresh preserves Guide route, explicit date and mode without Scores keys", async ({ page, harness }) => {
  let calls = 0;
  await page.route("**/api/health", route => { calls++; return route.fulfill({ json: { version: "next", commit: "b".repeat(40) } }); });
  await openGuide(page, harness, { path: "/guide?date=2026-09-12&view=watch&tab=acc" });
  await page.clock.fastForward(3100); await expect.poll(() => calls).toBeGreaterThan(0);
  await page.clock.fastForward(10100);
  await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible();
  const reloaded = page.waitForEvent("domcontentloaded");
  await page.getByRole("button", { name: "Refresh app", exact: true }).click();
  await reloaded;
  await expect(page).toHaveURL(/\/guide\?date=2026-09-12&view=watch$/);
  await expect(dateInput(page)).toHaveValue("2026-09-12");
  await expect(page.getByRole("button", { name: "Watchlist only", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(harness.state.alertRequests.filter(r => r.method !== "GET")).toEqual([]);
});

test("polling preserves the viewed instant and surviving network when earlier listings change", async ({ page, harness }) => {
  await page.setViewportSize({ width: 844, height: 330 });
  harness.state.events = ["ABC", "FOX", "CBS", "NBC", "ESPN", "ESPNU", "ESPN+"].map((network, i) => {
    const game = event(`anchor-${i}`, { date: i === 0 ? "2026-09-12T16:00:00Z" : "2026-09-13T02:00:00Z", state: "upcoming" });
    game.competitions[0].broadcasts = [{ names: [network] }]; return game;
  });
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
  await expect(page.getByTestId("guide-count")).toContainText("7 games listed");
  await region(page).evaluate(el => { el.scrollLeft = 180; el.scrollTop = 90; });
  await expect.poll(() => region(page).evaluate(el => el.scrollTop)).toBe(90);
  harness.state.events[0].date = "2026-09-12T15:00:00Z";
  harness.state.events[0].competitions[0].date = "2026-09-12T15:00:00Z";
  harness.state.events.splice(1, 1);
  await page.getByRole("button", { name: "Refresh guide", exact: true }).click();
  await expect(page.getByTestId("guide-count")).toContainText("6 games listed");
  await expect.poll(() => region(page).evaluate(el => el.scrollLeft)).toBe(270);
  await expect.poll(() => region(page).evaluate(el => el.scrollTop)).toBe(46);
});

test("reduced motion and doubled desktop scale retain reachable controls and text schedule", async ({ page, harness }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 850 });
  await openGuide(page, harness);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText("Text schedule", { exact: true }).click();
  const listing = page.locator(".guide-text-schedule a").first();
  await expect(listing).toContainText("2026-09-12");
  await listing.focus(); await expect(listing).toBeFocused();
  await expect(listing).toHaveAttribute("href", /^https:\/\/www\.espn\.com\//);
});


test("a previous day's failure does not label a newly selected pending day unavailable", async ({ page, harness }) => {
  harness.state.failScores = true;
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
  await expect(page.getByRole("heading", { name: "Schedule temporarily unavailable" })).toBeVisible();
  harness.state.failScores = false;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("https://site.api.espn.com/**/scoreboard?*", async route => {
    if (new URL(route.request().url()).searchParams.get("dates") === "20260913") await gate;
    await route.fallback();
  });
  try {
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(dateInput(page)).toHaveValue("2026-09-13");
    await expect(page.getByRole("status", { name: "Loading guide" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schedule temporarily unavailable" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "No games listed for this day" })).toBeVisible();
});


test("removed game details close and do not reopen if a later poll restores the listing", async ({ page, harness }) => {
  await openGuide(page, harness);
  const first = page.locator(".guide-game").first();
  const id = await first.getAttribute("data-game");
  await first.click(); await expect(page.getByRole("dialog")).toBeVisible();
  const removed = harness.state.events.find(e => e.id === id);
  harness.state.events = harness.state.events.filter(e => e.id !== id);
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(region(page)).toBeFocused();
  harness.state.events.push(removed);
  await page.clock.fastForward(31_000);
  await expect(page.locator(`.guide-game[data-game="${id}"]`).first()).toBeAttached();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
