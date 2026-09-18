import { test, expect, event } from "./fixtures.mjs";
const now = "2026-09-06T03:59:00Z";
function setup(state, elapsed = 425000) {
  const game = event("halftime", { acc: true, rank: 5 });
  game.status = { period: 2, clock: 0, type: { name: "STATUS_HALFTIME", state: "in", shortDetail: "Halftime" } };
  game.competitions[0].broadcasts[0].names = ["ESPN College Football Extra Long Network", "ACC Network Extra"];
  state.events = [game];
  state.summary = { header: { id: game.id, competitions: [{ competitors: game.competitions[0].competitors, status: game.status }] }, drives: { current: { plays: [{ id: "q2-end", type: { id: "2" }, period: { number: 2 }, clock: { displayValue: "0:00" }, wallclock: new Date(Date.parse(now) - elapsed).toISOString() }] } } };
  return game;
}
const status = page => page.locator(".halftime-status:visible").first();

test("320px before/after, exact countdown copy and isolated one-second ticking", async ({ page, harness }, info) => {
  await page.setViewportSize({ width: 320, height: 844 }); setup(harness.state);
  harness.state.failSummary = true;
  await harness.open({ now }); await expect(status(page)).toHaveText("Halftime");
  await page.screenshot({ path: info.outputPath("halftime-before-320.png"), fullPage: true });
  harness.state.failSummary = false;
  await page.getByRole("button", { name: "Refresh scores", exact: true }).click();
  await expect(status(page)).toHaveText("Halftime 12:55");
  await page.screenshot({ path: info.outputPath("halftime-after-320.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const requests = harness.state.summaryRequests, scores = harness.state.scoreRequests.length;
  await page.evaluate(() => { window.__outsideTickChanges = 0; const observer = new MutationObserver(changes => { window.__outsideTickChanges += changes.length; }); document.querySelectorAll(".tab-count,.team-name,.section-label").forEach(el => observer.observe(el, { childList: true, subtree: true, characterData: true })); });
  await page.clock.runFor(1000); await expect(status(page)).toHaveText("Halftime 12:54");
  expect(harness.state.summaryRequests).toBe(requests); expect(harness.state.scoreRequests.length).toBe(scores);
  expect(await page.evaluate(() => window.__outsideTickChanges)).toBe(0);
  await expect(page.locator(".halftime-status[aria-live]")).toHaveCount(0);
});
test("estimate expiry and later Q3 do not invent a game restart", async ({ page, harness }) => {
  const game = setup(harness.state, 1199000); await harness.open({ now });
  await expect(status(page)).toHaveText("Halftime 0:01");
  await page.clock.runFor(1000); await expect(status(page)).toHaveText("Halftime · Awaiting 3rd quarter");
  game.status = { period: 3, clock: 899, type: { name: "STATUS_IN_PROGRESS", state: "in", shortDetail: "14:59 - 3rd" } };
  await page.getByRole("button", { name: "Refresh scores", exact: true }).click();
  await expect(page.locator(".game-status:visible").first()).toHaveText("14:59 - 3rd");
});
test("summary expiry hides an unfrozen estimate and a later success restores it", async ({ page, harness }) => {
  setup(harness.state); await harness.open({ now }); await expect(status(page)).toHaveText("Halftime 12:55");
  harness.state.failSummary = true;
  await page.clock.runFor(91000); await expect(status(page)).toHaveText("Halftime");
  harness.state.failSummary = false; await page.getByRole("button", { name: "Refresh scores", exact: true }).click();
  await expect(status(page)).toHaveText("Halftime 11:24");
});
test("visibility resume inside cache TTL requires post-boundary status, and offline hides immediately", async ({ page, harness, context }) => {
  setup(harness.state); await harness.open({ now }); await expect(status(page)).toHaveText("Halftime 12:55");
  harness.state.failSummary = true;
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(status(page)).toHaveText("Halftime");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(status(page)).toHaveText("Halftime");
  await expect(page.getByRole("button", { name: "Refresh scores", exact: true })).toBeEnabled();
  harness.state.failSummary = false; await page.getByRole("button", { name: "Refresh scores", exact: true }).click();
  await expect(status(page)).toHaveText("Halftime 12:55");
  await context.setOffline(true); await expect(status(page)).toHaveText("Halftime");
});
test("material device clock jump invalidates old status", async ({ page, harness }) => {
  setup(harness.state); await harness.open({ now }); await expect(status(page)).toHaveText("Halftime 12:55");
  await page.clock.setSystemTime(new Date(Date.parse(now) + 60000)); await page.clock.runFor(1000);
  await expect(status(page)).toHaveText("Halftime");
});

test("scope error suppresses while unrelated overnight errors leave a healthy timer", async ({ page, harness }) => {
  setup(harness.state);
  await page.route("**/scoreboard?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("dates") === "20260904") return route.fulfill({ status: 503, body: "failed overnight" });
    return route.fallback();
  });
  await harness.open({ now }); await expect(status(page)).toHaveText("Halftime 12:55");
  await expect(page.locator(".feed-banner")).toBeVisible();
  harness.state.failScores = true;
  await page.getByRole("button", { name: "Refresh scores", exact: true }).click();
  await expect(status(page)).toHaveText("Halftime");
});

test("zero-leaf hidden interval cannot revive cached timing after tab remount", async ({ page, harness }) => {
  setup(harness.state); await harness.open({ now }); await expect(status(page)).toHaveText("Halftime 12:55");
  await page.getByRole("tab", { name: /One score/ }).click(); // Seven-point game still visible.
  await expect(status(page)).toHaveText("Halftime 12:55");
  await page.getByRole("tab", { name: /Upsets/ }).click(); // Ranked away trails, remains visible.
  await expect(status(page)).toHaveText("Halftime 12:55");
  // Hide the game through an empty daily date so no countdown leaf remains mounted.
  await page.getByLabel("Scoreboard date, Eastern time").fill("2026-09-03");
  await expect(page.locator(".halftime-status:visible")).toHaveCount(0);
  harness.state.failSummary = true;
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.getByRole("tab", { name: /ACC/ }).click();
  await expect(status(page)).toHaveText("Halftime");
});
