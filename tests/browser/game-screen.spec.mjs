import { readFileSync } from "node:fs";
import { test, expect, event, NOW, category, period, dateInput } from "./fixtures.mjs";
import { bundle } from "../helpers.mjs";

// Navigation, restoration, history ownership and privacy of the dedicated game screen.
// Stats are the real normalizer's output for saved public fixtures (see game-stats.spec.mjs).
const { normalizeGameStats } = await bundle("lib/game-stats.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/espn-summary-${name}.json`, import.meta.url), "utf8"));
const FINAL = { id: "401858481", teams: ["84", "158"] }, LIVE = { id: "401856717", teams: ["251", "201"] };
function matchup({ id, teams }, options) {
  const e = event(id, options);
  e.competitions[0].competitors.forEach((c, i) => { c.id = teams[i]; c.team.id = teams[i]; });
  return e;
}
function serve(harness, { gate } = {}) {
  harness.state.stats = async (url, route) => {
    const id = url.searchParams.get("event");
    if (gate && id === gate.id) await gate.promise;
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(normalizeGameStats(fixture(id === FINAL.id ? "final" : "live"), id, new Date(Date.parse(NOW) - 5000).toISOString())) });
  };
}
// A tall Saturday board: ranked live games sorted by priority, so a state change moves a card.
const filler = (count = 16) => Array.from({ length: count }, (_, i) => event(`g${i}`, { rank: i + 1, scores: [i, 30] }));

const screen = page => page.locator(".game-screen");
const board = page => page.locator(".scores-view");
const cardLink = (page, id) => page.locator(`#game-${id} a.game-summary`);
const back = page => screen(page).getByRole("button", { name: /^Back to scores/ });
const scrollY = page => page.evaluate(() => Math.round(scrollY));
const maxScroll = page => page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
async function expectScroll(page, y) { await expect.poll(async () => Math.abs((await scrollY(page)) - Math.min(y, await maxScroll(page)))).toBeLessThanOrEqual(2); }
// Proof that no framework navigation ran: every RSC fetch and document load is recorded, the
// main element, scoreboard DOM and window survive, and the framework's popstate handler (which
// sets __VINEXT_RSC_PENDING__ for each traversal it performs) never ran.
function recordNavigation(page) {
  const seen = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.resourceType() === "document" || url.pathname.endsWith(".rsc") || request.headers().rsc === "1") seen.push(`${request.resourceType()} ${url.pathname}${url.search}`);
  });
  return seen;
}
async function markDocument(page) {
  await page.evaluate(() => {
    window.__main = document.querySelector("main"); window.__board = document.querySelector(".scores-view"); window.__frameworkTraversals = 0;
    let pending = window.__VINEXT_RSC_PENDING__ ?? null;
    Object.defineProperty(window, "__VINEXT_RSC_PENDING__", { configurable: true, get() { return pending; }, set(value) { if (value) window.__frameworkTraversals++; pending = value; } });
  });
}
async function expectSameDocument(page) {
  expect(await page.evaluate(() => window.__main === document.querySelector("main") && window.__board === document.querySelector(".scores-view"))).toBe(true);
  expect(await page.evaluate(() => window.__frameworkTraversals)).toBe(0);
}
const entry = page => page.evaluate(() => history.state?.ss ?? null);

test("a card opens its screen; on-screen Back, browser Back and Forward restore the view, focus and scroll without framework navigation", async ({ page, harness }, info) => {
  harness.state.events = [...harness.state.events, ...filler()];
  await page.setViewportSize({ width: 393, height: 700 });
  await harness.open();
  await period(page, "Week").tap();
  await category(page, "ACC").tap(); await category(page, "Top 25").tap();
  await page.getByLabel("Hide finals").check();
  const target = "g9";
  await cardLink(page, target).scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 120));
  const saved = await scrollY(page);
  expect(saved).toBeGreaterThan(0);
  await markDocument(page);
  const navigation = recordNavigation(page);
  const polls = harness.state.scoreRequests.length;
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundColor)).toBe("rgb(10, 14, 22)");
  await cardLink(page, target).tap();
  await expect(screen(page)).toBeVisible(); await expect(board(page)).toBeHidden();
  const url = new URL(page.url());
  expect(Object.fromEntries(url.searchParams)).toEqual({ event: target, cats: "acc,top25", period: "week" });
  await expect(screen(page).locator("h1.game-title")).toBeFocused();
  expect(await scrollY(page)).toBe(0);
  // The approved safe-area band matches the screen only while it is shown.
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundColor)).toBe("rgb(13, 22, 38)");
  await page.screenshot({ path: info.outputPath("screen-arrival.png"), animations: "disabled" });
  const restored = async () => {
    await expect(board(page)).toBeVisible(); await expect(screen(page)).toHaveCount(0);
    await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["ACC", "Top 25"]) await expect(category(page, name)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Hide finals")).toBeChecked();
    await expect(cardLink(page, target)).toBeFocused();
    await expectScroll(page, saved);
    expect(new URL(page.url()).searchParams.has("event")).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundColor)).toBe("rgb(10, 14, 22)");
  };
  await back(page).tap();
  await restored();
  await page.goForward();
  await expect(screen(page)).toBeVisible();
  await expect(screen(page).locator("h1.game-title")).toBeFocused();
  // Section switches replace the entry: Back still returns straight to the scoreboard.
  await screen(page).getByRole("button", { name: "Player stats", exact: true }).tap();
  await expect(page).toHaveURL(/section=players/);
  await page.goBack();
  await restored();
  await page.goForward();
  await expect(screen(page).getByRole("button", { name: "Player stats", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await restored();
  expect(navigation, "owned traversals make no RSC or document request").toEqual([]);
  await expectSameDocument(page);
  expect(harness.state.scoreRequests.length, "the one scoreboard poller kept running without restarting").toBe(polls);
});

test("absolute scroll survives a group and order change while the screen is open, and a later poll", async ({ page, harness }) => {
  harness.state.events = filler(18);
  await page.setViewportSize({ width: 393, height: 640 });
  await harness.open();
  const target = "g8";
  await cardLink(page, target).scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 80));
  const saved = await scrollY(page);
  const before = await page.locator("article.game-card").evaluateAll(cards => cards.map(card => card.id));
  await cardLink(page, target).tap();
  await expect(screen(page)).toBeVisible();
  // While the game is open it finishes: its card moves to Final, and the order changes.
  const moved = harness.state.events.find(e => e.id === target);
  moved.status = { period: 4, clock: 0, type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } };
  harness.state.events.find(e => e.id === "g2").competitions[0].competitors[0].score = "29";
  await page.clock.fastForward(30_000);
  await expect(screen(page).locator(".mh-state")).toHaveText("Final");
  const after = await page.locator("article.game-card").evaluateAll(cards => cards.map(card => card.id));
  expect(after).not.toEqual(before);
  await expect(page.locator(".score-section", { has: page.locator(`#game-${target}`) }).locator("h2")).toHaveText("Final");
  await page.goBack();
  await expect(board(page)).toBeVisible();
  await expectScroll(page, saved);
  // Focus returns to the moved card without re-anchoring the position to it.
  await expect(cardLink(page, target)).toBeFocused();
  await page.clock.fastForward(30_000);
  await expect.poll(() => harness.state.scoreRequests.length).toBeGreaterThan(0);
  await expectScroll(page, saved);
});

test("a missing origin card falls back to the stable Scores heading", async ({ page, harness }) => {
  await harness.open();
  await cardLink(page, "close-live").tap();
  await expect(screen(page)).toBeVisible();
  harness.state.events = harness.state.events.filter(e => e.id !== "close-live");
  await page.clock.fastForward(30_000);
  await expect(screen(page).getByRole("heading", { name: /Game unavailable|Loading game/ })).toBeVisible();
  await back(page).tap();
  await expect(board(page)).toBeVisible();
  await expect(page.locator("#scoreboard-heading")).toBeFocused();
});

test("reload on the screen keeps it; Back then restores the scoreboard as it was left", async ({ page, harness }) => {
  await page.setViewportSize({ width: 393, height: 640 });
  harness.state.events = [...harness.state.events, ...filler(12).map(e => { e.date = "2026-09-06T20:00:00Z"; e.status.type = { name: "STATUS_SCHEDULED", state: "pre", completed: false, shortDetail: "Scheduled" }; e.competitions[0].competitors.forEach(c => { c.score = "0"; }); return e; })];
  await harness.open();
  await page.getByRole("button", { name: "Next day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await category(page, "Top 25").tap();
  await cardLink(page, "g6").scrollIntoViewIfNeeded();
  const saved = await scrollY(page);
  await cardLink(page, "g6").tap();
  await expect(screen(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("date")).toBe("2026-09-06");
  await page.reload();
  await expect(screen(page).locator("h1.game-title")).toContainText("g6");
  await screen(page).getByRole("button", { name: "Player stats", exact: true }).tap();
  await page.goBack();
  await expect(board(page)).toBeVisible();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(category(page, "Top 25")).toHaveAttribute("aria-pressed", "true");
  await expect(cardLink(page, "g6")).toBeFocused();
  await expectScroll(page, saved);
});

test("direct links open the screen and Back stays in the app; unknown or malformed IDs are generic or ignored", async ({ page, harness }) => {
  await harness.open({ path: "/?event=ranked-live&date=2026-09-05", waitForScores: false });
  await expect(screen(page).locator("h1.game-title")).toContainText("ranked-live away at ranked-live home");
  const length = await page.evaluate(() => history.length);
  expect(await entry(page)).toMatchObject({ kind: "game", id: "ranked-live", from: false });
  await back(page).tap();
  await expect(board(page)).toBeVisible();
  await expect(cardLink(page, "ranked-live")).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(length);
  expect(new URL(page.url()).search).toBe("?date=2026-09-05");
  const statsRequests = harness.state.statsRequests.length;
  await page.goto("/?event=999999999");
  await expect(screen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  await expect(screen(page).locator(".masthead, .view-nav")).toHaveCount(0);
  await page.goto("/?event=%3Cscript%3E");
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(screen(page)).toHaveCount(0);
  expect(harness.state.statsRequests, "unknown and malformed IDs do no stats work").toHaveLength(statsRequests);
});

test("a notification link opens once: replace-then-push, a consumed marker, and no reopening after Back, a poll or reload", async ({ page, harness }) => {
  await harness.open({ path: "/?date=2026-09-05#game-ranked-live", waitForScores: false });
  await expect(screen(page)).toBeVisible();
  await expect(screen(page).locator("h1.game-title")).toContainText("ranked-live away");
  expect(new URL(page.url()).hash).toBe("");
  expect(new URL(page.url()).searchParams.get("event")).toBe("ranked-live");
  expect(await entry(page)).toMatchObject({ kind: "game", id: "ranked-live", from: true });
  await page.goBack();
  await expect(board(page)).toBeVisible();
  expect(page.url()).not.toContain("#game-");
  expect(await entry(page)).toMatchObject({ kind: "board", consumed: "ranked-live" });
  await expect(cardLink(page, "ranked-live")).toBeFocused();
  await page.clock.fastForward(31_000);
  await expect(screen(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(page.locator("#game-ranked-live")).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(screen(page)).toHaveCount(0);
});

test("switching from game A to game B never shows A's stats on B's screen", async ({ page, harness }) => {
  let release;
  serve(harness, { gate: { id: FINAL.id, promise: new Promise(resolve => { release = resolve; }) } });
  harness.state.events = [matchup(LIVE, { state: "live" }), matchup(FINAL, { state: "final", scores: [20, 17] })];
  await harness.open();
  await cardLink(page, LIVE.id).tap();
  await expect(screen(page).getByRole("row", { name: /Total yards/ })).toContainText("235");
  await back(page).tap();
  await cardLink(page, FINAL.id).tap();
  await expect(screen(page).getByRole("status").filter({ hasText: "Loading team stats…" })).toBeVisible();
  await expect(screen(page).locator("table")).toHaveCount(0);
  await expect(screen(page)).not.toContainText("235");
  release();
  await expect(screen(page).getByRole("row", { name: /Total yards/ })).toContainText("328");
  expect(harness.state.statsRequests).toEqual([`?event=${LIVE.id}&phase=started&refresh=0`, `?event=${FINAL.id}&phase=final&refresh=0`]);
});

test("hiding a Duke game while its screen is open leaves only the generic screen and stops its stats work", async ({ page, harness }) => {
  serve(harness);
  const duke = event("duke-home", { acc: true });
  duke.competitions[0].neutralSite = false;
  const team = duke.competitions[0].competitors[1].team; team.id = "150"; team.shortDisplayName = "Duke"; team.abbreviation = "DUKE";
  harness.state.events = [duke];
  await harness.open({ path: "/?date=2026-09-05" });
  await cardLink(page, "duke-home").tap();
  await expect(screen(page).locator("h1.game-title")).toContainText("Duke");
  const requests = harness.state.statsRequests.length;
  // Another tab hides it (the Settings sheet is on the scoreboard).
  await page.evaluate(() => {
    const key = "ss:duke-visibility:v2", stored = JSON.parse(localStorage.getItem(key));
    const value = JSON.stringify({ ...stored, manual: { "duke-home": true } });
    localStorage.setItem(key, value); dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
  await expect(screen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  await expect(screen(page)).not.toContainText(/Duke|DUKE/);
  await expect(screen(page).locator(".masthead, .view-nav, table")).toHaveCount(0);
  await page.clock.fastForward(61_000);
  expect(harness.state.statsRequests).toHaveLength(requests);
  // A direct link to it is the same generic screen.
  await page.goto("/?event=duke-home&date=2026-09-05");
  await expect(screen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  await expect(screen(page)).not.toContainText(/Duke|DUKE/);
});

for (const mode of ["offline", "rsc-503"]) {
  test(`owned Back and Forward work ${mode === "offline" ? "offline" : "with RSC responses failing (503)"} with zero framework requests`, async ({ page, harness, context }) => {
    await harness.open();
    await cardLink(page, "close-live").scrollIntoViewIfNeeded();
    const saved = await scrollY(page);
    await cardLink(page, "close-live").tap();
    await expect(screen(page)).toBeVisible();
    await markDocument(page);
    const navigation = recordNavigation(page);
    if (mode === "offline") await context.setOffline(true);
    else await page.route(url => url.pathname.endsWith(".rsc"), route => route.fulfill({ status: 503, body: "simulated RSC outage" }));
    for (let round = 0; round < 2; round++) {
      await page.goBack();
      await expect(board(page)).toBeVisible();
      await expect(cardLink(page, "close-live")).toBeFocused();
      await expectScroll(page, saved);
      await page.goForward();
      await expect(screen(page)).toBeVisible();
      await expect(screen(page).locator("h1.game-title")).toBeFocused();
    }
    await back(page).tap();
    await expect(board(page)).toBeVisible();
    expect(navigation).toEqual([]);
    await expectSameDocument(page);
    if (mode === "offline") await context.setOffline(false);
  });
}

test("a foreign Guide traversal still reaches the framework, and Guide links work after owned traversals", async ({ page, harness }) => {
  await harness.open();
  await markDocument(page);
  await cardLink(page, "ranked-live").tap();
  await expect(screen(page)).toBeVisible();
  await page.goBack();
  await expect(board(page)).toBeVisible();
  expect(await page.evaluate(() => window.__frameworkTraversals)).toBe(0);
  // The framework's URL state was re-committed: its Guide link navigates normally.
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await expect(page.locator(".guide-shell")).toBeVisible();
  await expect(page).toHaveURL(/\/guide/);
  await page.goBack();
  await expect(page.locator("#game-ranked-live")).toBeVisible();
  expect(await page.evaluate(() => window.__frameworkTraversals), "the framework handled the foreign traversal").toBeGreaterThan(0);
  // Back on the scoreboard, games still open and close in place.
  await cardLink(page, "ranked-live").tap();
  await expect(screen(page)).toBeVisible();
  await back(page).tap();
  await expect(board(page)).toBeVisible();
});

test("sticky bars, condensed title, category jumps and keyboard path; nothing sticks at 200% zoom", async ({ page, harness }, info) => {
  serve(harness);
  harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] })];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await harness.open();
  await cardLink(page, FINAL.id).focus(); await page.keyboard.press("Enter");
  await expect(screen(page).locator("h1.game-title")).toBeFocused();
  await screen(page).getByRole("button", { name: "Player stats", exact: true }).tap();
  const receiving = screen(page).getByRole("button", { name: "Receiving", exact: true });
  await receiving.tap();
  await expect(page.locator("#cat-receiving-h")).toBeFocused();
  await expect(receiving).toHaveAttribute("aria-current", "true");
  await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
  const bar = await screen(page).locator(".game-bar").boundingBox(), nav = await screen(page).locator(".view-nav").boundingBox();
  expect(Math.abs(bar.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(nav.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  await expect(screen(page).locator(".title-score")).toBeVisible();
  await expect(screen(page).locator(".title-score")).toHaveText(/20\s*–\s*17/);
  // Every jump and section control is a 44px target.
  for (const control of await screen(page).locator(".jump-links button, .view-switch button, .back-button, .gamecast").all()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("receiving-390.png"), animations: "disabled" });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addStyleTag({ content: "html { zoom: 2; }" });
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => screen(page).locator(".game-bar").evaluate(el => getComputedStyle(el).position)).toBe("static");
  expect(await screen(page).locator(".view-nav").evaluate(el => getComputedStyle(el).position)).toBe("static");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("players-393-zoom200.png"), fullPage: true, animations: "disabled" });
});
