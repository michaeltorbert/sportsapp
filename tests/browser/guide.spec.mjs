import { readFileSync } from "node:fs";
import { test, expect, event } from "./fixtures.mjs";
// ORD-010: the 80-event archive contains one hidden Duke away game; visible counts are 79.
const archive = JSON.parse(readFileSync(new URL("../fixtures/guide-2026-09-12.json", import.meta.url)));
const region = page => page.getByRole("region", { name: "Network and time schedule" });
const dateInput = page => page.getByLabel("Guide date, Eastern time");

test("Guide fits ranked school names to visible space and explains Watchlist stars", async ({ page, harness }) => {
  const listing = event("readable", { date: "2026-09-12T16:00:00Z", state: "upcoming", rank: 8 });
  const teams = listing.competitions[0].competitors;
  teams[0].team.shortDisplayName = "Oklahoma"; teams[0].team.abbreviation = "OU";
  teams[1].team.shortDisplayName = "Michigan"; teams[1].team.abbreviation = "MICH";
  const later = structuredClone(listing); later.id = "later"; later.date = "2026-09-12T23:00:00Z";
  harness.state.events = [listing, later];
  await page.setViewportSize({ width: 1280, height: 850 });
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
  const button = page.locator('.guide-game[data-game="readable"]'), label = button.locator(".guide-game-text");
  await expect(label).toHaveAttribute("data-abbreviated", "false");
  await expect(label.locator(".guide-label-full")).toContainText("#8 Oklahoma @ Michigan");
  await expect(button).toHaveAccessibleName(/#8 Oklahoma @ Michigan.*No. 8 Oklahoma at Michigan/);
  await expect(page.locator(".guide-watch-legend")).toContainText("Watchlist");
  await page.setViewportSize({ width: 320, height: 640 });
  // The full names can fit at 320px with some system fonts; constrain the
  // visible game window to force the fallback without assuming font metrics.
  await region(page).evaluate(el => { el.scrollLeft = 180; });
  await expect(label).toHaveAttribute("data-abbreviated", "true");
  await expect(label.locator(".guide-label-short")).toContainText("#8 OU @ MICH");
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(label).toHaveAttribute("data-abbreviated", "false");
  await page.setViewportSize({ width: 640, height: 850 });
  await region(page).evaluate(el => { el.scrollLeft = 180; });
  await expect(label).toHaveAttribute("data-abbreviated", "true");
  await region(page).evaluate(el => { el.scrollLeft = 0; });
  await expect(label).toHaveAttribute("data-abbreviated", "false");
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  await region(page).evaluate(el => { el.scrollLeft = 180; });
  await expect(label).toHaveAttribute("data-abbreviated", "true");
  const zoomed = await label.evaluate(el => {
    const viewport = el.closest(".guide-viewport"), view = viewport.getBoundingClientRect();
    return {
      labelRight: el.getBoundingClientRect().right,
      barRight: el.parentElement.getBoundingClientRect().right,
      viewRight: view.left + (viewport.clientLeft + viewport.clientWidth) * view.width / viewport.offsetWidth,
    };
  });
  expect(zoomed.labelRight).toBeLessThanOrEqual(Math.min(zoomed.barRight, zoomed.viewRight));
  await page.evaluate(() => { document.body.style.zoom = "1"; });
  await region(page).evaluate(el => { el.scrollLeft = 0; });
  await expect(label).toHaveAttribute("data-abbreviated", "false");
  await page.getByRole("button", { name: "Watchlist only", exact: true }).click();
  await expect(page.locator(".guide-watch-legend, .guide-watch-star")).toHaveCount(0);
  await button.click();
  await expect(page.getByRole("dialog")).toContainText("No. 8 Oklahoma");
  await expect(page.getByRole("link", { name: "Find on YouTube TV" })).toHaveAttribute("href", "https://tv.youtube.com/search/Oklahoma%20Michigan");
});

test("Guide labels stay inside the scrollable client area with reserved right space", async ({ page, harness }) => {
  const listing = event("gutter", { date: "2026-09-12T16:00:00Z", state: "upcoming", rank: 8 });
  const teams = listing.competitions[0].competitors;
  teams[0].team.shortDisplayName = "Northwestern State"; teams[0].team.abbreviation = "NORTHWESTERN";
  teams[1].team.shortDisplayName = "Southeastern Louisiana"; teams[1].team.abbreviation = "SOUTHEASTERN";
  harness.state.events = [listing];
  await page.setViewportSize({ width: 320, height: 640 });
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
  await region(page).evaluate(el => {
    el.style.overflowY = "scroll";
    el.style.scrollbarGutter = "stable";
    // A substantial right border also exercises the client-edge distinction on
    // platforms whose scrollbars overlay content rather than reserving a gutter.
    el.style.borderRightWidth = "24px";
  });
  await expect.poll(() => page.locator(".guide-game-text").evaluate(el => {
    const viewport = el.closest(".guide-viewport"), view = viewport.getBoundingClientRect();
    const clientRight = view.left + (viewport.clientLeft + viewport.clientWidth) * view.width / viewport.offsetWidth;
    return el.getBoundingClientRect().right <= clientRight;
  })).toBe(true);
});

test("YouTube TV search safely encodes school names and retains ESPN", async ({ page, harness }) => {
  const listing = event("encoded", { date: "2026-09-12T16:00:00Z", state: "upcoming" });
  listing.competitions[0].competitors[0].team.shortDisplayName = "Texas A&M";
  listing.competitions[0].competitors[1].team.shortDisplayName = "Miami (OH)";
  harness.state.events = [listing];
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
  await page.locator(".guide-game").click();
  const link = page.getByRole("link", { name: "Find on YouTube TV" });
  await expect(link).toHaveAttribute("href", "https://tv.youtube.com/search/Texas%20A%26M%20Miami%20(OH)");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("dialog")).toContainText("Search results may include replays.");
  await expect(page.getByRole("link", { name: "Open Gamecast" })).toBeVisible();
});
async function openGuide(page, harness, options = {}) {
  harness.state.events = structuredClone(archive.events);
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false, ...options });
  await expect(page.getByRole("button", { name: "Refresh guide", exact: true })).toBeEnabled();
  await expect(page.getByTestId("guide-count")).toContainText("games listed");
}

test("Guide URL owner preserves date/mode across reload, Back/Forward and app navigation without mode refetch", async ({ page, harness, baseURL }, testInfo) => {
  const guideRequests = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === new URL(baseURL).origin && ["/guide", "/guide/", "/guide.rsc"].includes(url.pathname)) guideRequests.push(request.url());
  });
  await openGuide(page, harness);
  await page.waitForLoadState("networkidle");
  const initialGuideRequests = [...guideRequests];
  const initial = await page.getByTestId("guide-count").innerText();
  const requests = harness.state.scoreRequests.length;
  const mounts = await page.evaluate(() => { window.__guideOriginal = document.querySelector(".guide-shell"); return !!window.__guideOriginal; });
  expect(mounts).toBe(true);
  await page.getByRole("button", { name: "Watchlist only", exact: true }).click();
  await expect(page).toHaveURL(/view=watch/);
  await expect(page.getByTestId("guide-count")).not.toHaveText(initial);
  expect(harness.state.scoreRequests.length).toBe(requests);
  expect(await page.evaluate(() => window.__guideOriginal === document.querySelector(".guide-shell"))).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(guideRequests).toEqual(initialGuideRequests);
  await page.goBack(); await expect(page.getByRole("button", { name: "All games", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(harness.state.scoreRequests.length).toBe(requests);
  expect(await page.evaluate(() => window.__guideOriginal === document.querySelector(".guide-shell"))).toBe(true);
  await page.goForward(); await expect(page.getByRole("button", { name: "Watchlist only", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(harness.state.scoreRequests.length).toBe(requests);
  expect(await page.evaluate(() => window.__guideOriginal === document.querySelector(".guide-shell"))).toBe(true);
  await page.waitForLoadState("networkidle");
  await testInfo.attach("guide-history-route-requests", { body: JSON.stringify({ initial: initialGuideRequests, afterNativeTraversal: guideRequests }), contentType: "application/json" });
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
  await expect(bars.first()).toHaveAccessibleName(/2026-09-12/);
  for (const label of await page.locator(".guide-game-text b").allTextContents()) expect(label).toMatch(/^\d{1,2}:\d{2}$/);
  await region(page).evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const finalTick = await page.locator(".guide-hours > span").last().boundingBox(), edge = await region(page).boundingBox();
  expect(finalTick.x + finalTick.width).toBeLessThanOrEqual(edge.x + edge.width);
  await region(page).evaluate(el => { el.scrollLeft = 0; });
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
  for (const [name, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["short-landscape", 844, 330], ["small-landscape", 667, 375], ["desktop", 1280, 850], ["narrow", 320, 640]]) {
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
  await expect(page.getByRole("alert")).toContainText("Could not refresh schedule");
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


for (const action of ["Today", "Back"]) test(`manual date to ${action} immediately leaves the manual board while overnight is pending`, async ({ page, harness }) => {
  harness.state.events = [event("manual-future", { date: "2026-09-19T20:00:00Z", state: "upcoming" }), event("effective-today", { date: "2026-09-12T20:00:00Z", state: "upcoming" })];
  await harness.open({ path: "/guide", now: "2026-09-12T15:00:00Z", waitForScores: false });
  await expect(dateInput(page)).toHaveValue("2026-09-12");
  await expect(page.getByRole("button", { name: "Refresh guide", exact: true })).toBeEnabled();
  await dateInput(page).fill("2026-09-19");
  await expect(page.locator('.guide-game[data-game="manual-future"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh guide", exact: true })).toBeEnabled();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("https://site.api.espn.com/**/scoreboard?*", async route => {
    if (new URL(route.request().url()).searchParams.get("dates") === "20260911") await gate;
    await route.fallback().catch(() => {});
  });
  try {
    if (action === "Today") await page.getByRole("button", { name: "Today", exact: true }).click();
    else await page.goBack();
    await expect(page).toHaveURL(/\/guide$/);
    await expect(dateInput(page)).toHaveValue("2026-09-12");
    await expect(page.locator('.guide-game[data-game="manual-future"]')).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Loading guide" })).toBeVisible();
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(dateInput(page)).toHaveValue("2026-09-13");
    await expect(page.getByRole("heading", { name: "No games listed for this day" })).toBeVisible();
  } finally { release(); }
});

for (const remaining of ["empty", "tbd-only", "tbd-opener"]) test(`removed details retain connected keyboard focus with ${remaining} results`, async ({ page, harness }) => {
  const initial = event("removed-focus", { date: "2026-09-12T20:00:00Z", state: "upcoming" });
  if (remaining === "tbd-opener") initial.competitions[0].timeValid = false;
  harness.state.events = [initial];
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
  const opener = page.getByRole("button", { name: /removed-focus away at removed-focus home/ });
  await opener.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  const tbd = event("remaining-tbd", { date: "2026-09-12T20:00:00Z", state: "upcoming" });
  tbd.competitions[0].timeValid = false;
  harness.state.events = remaining === "tbd-only" ? [tbd] : [];
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(region(page)).toHaveCount(0);
  await expect(page.getByTestId("guide-count")).toBeFocused();
  expect(await page.evaluate(() => document.activeElement.isConnected && document.activeElement !== document.body)).toBe(true);
});


test("unresolved initial Today timeout exposes a valid unavailable date instead of indefinite loading", async ({ page, harness }) => {
  await page.addInitScript(() => localStorage.setItem("ss:game-day", "invalid-saved-date"));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("https://site.api.espn.com/**/scoreboard?*", async route => {
    await gate; await route.fallback().catch(() => {});
  });
  try {
    await harness.open({ path: "/guide", now: "2026-09-12T15:00:00Z", waitForScores: false });
    await expect(page.getByRole("status", { name: "Loading guide" })).toBeVisible();
    await page.clock.fastForward(41_000);
    await expect(dateInput(page)).toHaveValue("2026-09-12");
    await expect(page.getByRole("heading", { name: "Schedule temporarily unavailable" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading guide" })).toHaveCount(0);
  } finally { release(); }
});

test("tall streaming lane keeps its network label visible at top middle and bottom", async ({ page, harness }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openGuide(page, harness);
  const lane = page.locator('[data-network="espn+"]');
  const label = lane.locator(".guide-network-name > span");
  const sizes = await lane.evaluate(el => ({ top: el.offsetTop, height: el.offsetHeight }));
  expect(sizes.height).toBeGreaterThan(400);
  for (const portion of [0, .5, 1]) {
    await region(page).evaluate((el, { sizes, portion }) => { el.scrollTop = sizes.top - 40 + portion * (sizes.height - el.clientHeight + 40); }, { sizes, portion });
    const view = await region(page).boundingBox(), bounds = await label.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(view.y + 39);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(view.y + view.height + 1);
    await expect(label).toHaveText("ESPN+");
  }
});

test("pointer tap and details return preserve horizontal pan while keyboard navigation reveals starts", async ({ page, harness, browserName }) => {
  await openGuide(page, harness);
  const first = page.locator(".guide-game").first();
  for (const closeWith of ["pointer", "Escape"]) {
    await region(page).evaluate(el => { el.scrollLeft = 180; el.scrollTop = 0; });
    const view = await region(page).boundingBox(), bar = await first.boundingBox();
    expect(bar.x).toBeLessThan(view.x + 80);
    await page.mouse.click(view.x + 105, bar.y + bar.height / 2);
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.locator(".guide-viewport").evaluate(el => el.scrollLeft)).toBe(180);
    if (closeWith === "Escape") await page.keyboard.press("Escape");
    else await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => region(page).evaluate(el => el.scrollLeft)).toBe(180);
  }
  await region(page).focus(); await page.keyboard.press("ArrowRight");
  // Chromium animates this key scroll; mobile WebKit does not move the viewport.
  // Let any native motion settle before testing a separate focus reveal.
  if (browserName === "chromium") await expect.poll(() => region(page).evaluate(el => el.scrollLeft)).toBeGreaterThan(180);
  await expect.poll(() => region(page).evaluate(async el => {
    const left = el.scrollLeft;
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
    return el.scrollLeft === left;
  })).toBe(true);
  // Establish keyboard modality; mobile Safari may skip buttons with its default Tab preference.
  await first.focus(); await expect(first).toBeFocused();
  await expect.poll(() => first.evaluate(el => el.matches(":focus-visible"))).toBe(true);
  const bounds = await first.boundingBox(), view = await region(page).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(view.x + 79);
});

test("timeline allows vertical chaining to the text schedule while containing horizontal overscroll", async ({ page, harness, browserName }) => {
  await openGuide(page, harness);
  const styles = await region(page).evaluate(el => ({ x: getComputedStyle(el).overscrollBehaviorX, y: getComputedStyle(el).overscrollBehaviorY }));
  expect(styles).toEqual({ x: "contain", y: "auto" });
  await region(page).evaluate(el => { el.scrollTop = el.scrollHeight; });
  const bounds = await region(page).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, Math.min(bounds.y + bounds.height / 2, 700));
  const start = await page.evaluate(() => scrollY);
  // Mobile WebKit has no mouse-wheel automation; its computed policy is checked above.
  if (browserName === "webkit") return;
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(start);
});

test("feed age uses seconds outside the stable status announcement", async ({ page, harness }) => {
  await openGuide(page, harness);
  const status = page.locator('.guide-feed [role="status"]');
  await expect(status).toHaveText("Schedule updated.");
  await page.clock.fastForward(16_000);
  await expect(page.locator(".guide-feed")).toContainText(/1[56]s ago/);
  await expect(page.locator(".guide-feed")).not.toContainText("0m ago");
  await expect(status).toHaveText("Schedule updated.");
  await expect(page.getByRole("button", { name: "Start — jump to schedule start", exact: true })).toBeVisible();
});


test("Back from Scores restores Guide date and pushed mode", async ({ page, harness }) => {
  await openGuide(page, harness);
  await page.getByRole("button", { name: "Watchlist only", exact: true }).click();
  await expect(page).toHaveURL(/date=2026-09-12&view=watch/);
  await page.getByRole("link", { name: "Scores", exact: true }).click();
  await expect(page.getByLabel("Scoreboard date, Eastern time")).toHaveValue("2026-09-12");
  await page.goBack();
  await expect(page).toHaveURL(/\/guide\?date=2026-09-12&view=watch$/);
  await expect(dateInput(page)).toHaveValue("2026-09-12");
  await expect(page.getByRole("button", { name: "Watchlist only", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("guide-count")).toContainText("on this day");
  await page.waitForLoadState("networkidle");
  const scoreRequests = harness.state.scoreRequests.length;
  await page.goBack();
  await expect(page.getByRole("button", { name: "All games", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("guide-count")).toContainText("79 games listed");
  await page.goForward();
  await expect(page.getByRole("button", { name: "Watchlist only", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.waitForLoadState("networkidle");
  expect(harness.state.scoreRequests.length).toBe(scoreRequests);
  await page.goForward();
  await expect(page.getByLabel("Scoreboard date, Eastern time")).toHaveValue("2026-09-12");
  await expect(page.locator(".guide-shell")).toHaveCount(0);
});


test("Jump is absent for Watchlist with only TBD games or no matching games", async ({ page, harness }) => {
  const timed = event("timed-plain", { date: "2026-09-12T20:00:00Z", state: "upcoming" });
  const tbd = event("tbd-watch", { date: "2026-09-12T20:00:00Z", state: "upcoming", acc: true });
  tbd.competitions[0].timeValid = false;
  harness.state.events = [timed, tbd];
  await harness.open({ path: "/guide?date=2026-09-12&view=watch", now: "2026-09-12T15:00:00Z", waitForScores: false });
  await expect(page.getByRole("heading", { name: "Time TBD", exact: true })).toBeVisible();
  await expect(region(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Now|Start) — jump to/ })).toHaveCount(0);
  await page.getByRole("button", { name: "All games", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start — jump to schedule start", exact: true })).toBeVisible();
  harness.state.events = [timed];
  await page.getByRole("button", { name: "Refresh guide", exact: true }).click();
  await expect(page.getByTestId("guide-count")).toContainText("1 game listed");
  await page.getByRole("button", { name: "Watchlist only", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No Watchlist games on this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Now|Start) — jump to/ })).toHaveCount(0);
});

test("offline Today reports one connection warning after both fetch scopes fail", async ({ page, harness }) => {
  await openGuide(page, harness, { path: "/guide" });
  harness.state.failScores = true;
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  await page.getByRole("button", { name: "Refresh guide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh guide", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert").locator("p")).toHaveText(["You're offline. Reconnect to refresh schedule."]);
  await expect(page.locator(".guide-overnight")).toHaveCount(0);
  await expect(page.getByTestId("guide-count")).toContainText("79 games listed");
});


test("Guide date Back and Forward load the selected feed", async ({ page, harness }) => {
  await openGuide(page, harness);
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(dateInput(page)).toHaveValue("2026-09-13");
  await expect(page.getByRole("heading", { name: "No games listed for this day" })).toBeVisible();
  const requests = harness.state.scoreRequests.length;
  await page.goBack();
  await expect(dateInput(page)).toHaveValue("2026-09-12");
  await expect(page.getByTestId("guide-count")).toContainText("79 games listed");
  expect(harness.state.scoreRequests.length).toBeGreaterThan(requests);
  await page.goForward();
  await expect(dateInput(page)).toHaveValue("2026-09-13");
  await expect(page.getByRole("heading", { name: "No games listed for this day" })).toBeVisible();
});


test("a failed retained day keeps its warning after another date also fails", async ({ page, harness }) => {
  await openGuide(page, harness);
  harness.state.failScores = true;
  await page.getByRole("button", { name: "Refresh guide", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not refresh schedule");
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(dateInput(page)).toHaveValue("2026-09-13");
  await expect(page.getByRole("heading", { name: "Schedule temporarily unavailable" })).toBeVisible();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("https://site.api.espn.com/**/scoreboard?*", async route => {
    if (new URL(route.request().url()).searchParams.get("dates") === "20260912") await gate;
    await route.fallback();
  });
  harness.state.failScores = false;
  try {
    await page.goBack();
    await expect(dateInput(page)).toHaveValue("2026-09-12");
    await expect(page.getByTestId("guide-count")).toContainText("79 games listed");
    await expect(page.getByRole("alert")).toContainText("Could not refresh schedule");
    await expect(page.locator(".guide-feed")).toContainText("Last update");
  } finally { release(); }
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".guide-feed")).toContainText("Updated just now");
});

test("TBD listings visibly distinguish live, final, postponed and canceled games", async ({ page, harness }) => {
  harness.state.events = ["live", "final", "postponed", "canceled", "scheduled"].map(state => {
    const game = event(`tbd-${state}`, { date: "2026-09-12T20:00:00Z", state: state === "final" ? "final" : state === "live" ? "live" : "upcoming" });
    game.competitions[0].timeValid = false;
    if (["postponed", "canceled"].includes(state)) game.status.type = { name: `STATUS_${state.toUpperCase()}`, state: "pre", completed: false, shortDetail: state[0].toUpperCase() + state.slice(1) };
    return game;
  });
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T15:00:00Z", waitForScores: false });
  await expect(page.getByTestId("guide-count")).toContainText("5 games listed");
  for (const status of ["Live", "Final", "Postponed", "Canceled"]) await expect(page.locator(".guide-tbd").getByRole("button", { name: new RegExp(`tbd-${status.toLowerCase()}`) })).toContainText(`${status} · Listed on`);
  await expect(page.locator(".guide-tbd").getByRole("button", { name: /tbd-scheduled/ }).locator("span:not(.sr-only)")).not.toContainText("Scheduled");
});


test("Guide controls include their visible label in the accessible name", async ({ page, harness }) => {
  const timed = event("label-timed", { date: "2026-09-12T16:00:00Z", state: "live", rank: 5 });
  const tbd = event("label-tbd", { date: "2026-09-12T20:00:00Z", state: "final", acc: true });
  tbd.competitions[0].timeValid = false;
  harness.state.events = [timed, tbd];
  await harness.open({ path: "/guide?date=2026-09-12", now: "2026-09-12T17:00:00Z", waitForScores: false });
  await expect(page.getByTestId("guide-count")).toContainText("2 games listed");
  for (const control of await page.locator(".guide-game, .guide-tbd button, .guide-jump").all()) {
    const visible = await control.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const text = [];
      while (walker.nextNode()) {
        let parent = walker.currentNode.parentElement, hidden = false;
        while (parent && parent !== element) {
          const style = getComputedStyle(parent);
          if (parent.matches('[aria-hidden="true"], .sr-only') || style.display === "none" || style.visibility === "hidden") hidden = true;
          parent = parent.parentElement;
        }
        if (!hidden) text.push(walker.currentNode.textContent);
      }
      return text.join(" ").replace(/\s+/g, " ").trim();
    });
    expect(visible).not.toBe("");
    const escaped = visible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(control).toHaveAccessibleName(new RegExp(`^${escaped}`));
    await expect(control).not.toHaveAccessibleName(/★/);
  }
  const timedButton = page.locator(".guide-game");
  await expect(timedButton).toHaveAccessibleName(/label-timed away at label-timed home, 2026-09-12, 12:00 PM EDT/);
  await expect(timedButton).toHaveAccessibleName(/Watchlist.*Estimated 3½-hour window; actual end unknown/);
  await expect(page.locator(".guide-tbd button")).toHaveAccessibleName(/label-tbd away at label-tbd home, 2026-09-12, Time TBD/);
  await expect(page.getByRole("button", { name: "Now — jump to current time", exact: true })).toBeVisible();
  await page.clock.fastForward(4 * 60 * 60 * 1000);
  await expect(page.getByRole("button", { name: "Start — jump to schedule start", exact: true })).toBeVisible();
});
