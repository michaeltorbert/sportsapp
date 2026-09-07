import { test, expect, event, cards, dateInput, expectCount } from "./fixtures.mjs";

test("mobile touch navigation keeps tab counts and daily/weekly scopes separate", async ({ page, harness }, testInfo) => {
  await harness.open();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  for (const [name, count] of [["Watchlist", 3], ["ACC", 2], ["Top 25", 3], ["One score", 2], ["Upsets", 1]]) await expectCount(page, name, count);
  await expect(cards(page)).toHaveCount(3);
  for (const name of ["ACC", "Top 25", "One score", "Upsets", "Watchlist"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
    await tab.tap();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const weekly = ["ACC", "Top 25"].includes(name);
    await expect(dateInput(page)).toHaveCount(weekly ? 0 : 1);
    await expect(page.locator(".week-label")).toHaveCount(weekly ? 1 : 0);
    if (name === "ACC") {
      await expect(page.locator("#game-sunday-acc")).toBeVisible();
      await expect(cards(page)).toHaveCount(2);
    }
    if (name === "Top 25") {
      await expect(page.locator("#game-monday-ranked")).toBeVisible();
      await expect(cards(page)).toHaveCount(3);
    }
  }
  // Real touch events on the desktop engines; verify viewport overflow, controls,
  // and a full-page artifact rather than describing this as physical iOS testing.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of [page.getByRole("button", { name: "Refresh scores" }), page.getByRole("button", { name: "Next day" }), page.getByRole("tab", { name: /^Watchlist/ })]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  await page.screenshot({ path: testInfo.outputPath("mobile-watchlist.png"), fullPage: true, animations: "disabled" });
  await testInfo.attach("mobile-watchlist", { path: testInfo.outputPath("mobile-watchlist.png"), contentType: "image/png" });
  await page.getByRole("button", { name: "Next day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(cards(page)).toHaveCount(1);
  await expectCount(page, "Watchlist", 1);
  await expectCount(page, "ACC", 2);
  await expectCount(page, "Top 25", 3);
  await page.getByRole("tab", { name: /^Top 25/ }).tap();
  await expect(page.locator("#game-monday-ranked")).toBeVisible();
  await page.getByRole("tab", { name: /^Watchlist/ }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await page.getByRole("button", { name: "Previous day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(cards(page)).toHaveCount(3);
});

test("Hide finals persists after reload and updates every scope's count", async ({ page, harness }) => {
  await harness.open();
  await expect(page.locator("#game-acc-final")).toBeVisible();
  await page.getByLabel("Hide finals").tap();
  await expect(page.locator("#game-acc-final")).toHaveCount(0);
  await expectCount(page, "Watchlist", 2);
  await expectCount(page, "ACC", 1);
  await expectCount(page, "Top 25", 2);
  await page.reload();
  await expect(page.getByLabel("Hide finals")).toBeChecked();
  await expectCount(page, "Watchlist", 2);
  await page.getByRole("tab", { name: /^ACC/ }).tap();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator("#game-sunday-acc")).toBeVisible();
  await page.getByRole("tab", { name: /^Top 25/ }).tap();
  await expect(page.locator("#game-friday-ranked")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
});

test("a failed refresh preserves loaded scores and healthy retry removes the warning", async ({ page, harness }) => {
  await harness.open();
  await expect(cards(page)).toHaveCount(3);
  const before = await cards(page).allTextContents();
  harness.state.failScores = true;
  await page.getByRole("button", { name: "Refresh scores" }).tap();
  await expect(page.getByRole("alert")).toContainText("Could not refresh scores");
  await expect(page.getByRole("alert")).toContainText("Displayed scores may be out of date");
  expect(await cards(page).allTextContents()).toEqual(before);
  await expectCount(page, "Watchlist", 3);
  await page.getByRole("tab", { name: /^Top 25/ }).tap();
  await expect(page.locator("#game-monday-ranked")).toBeVisible();
  harness.state.failScores = false;
  await page.getByRole("button", { name: "Retry", exact: true }).tap();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("fresh open after Eastern midnight holds unfinished yesterday then automatically rolls forward", async ({ page, harness }) => {
  harness.state.events = [event("overnight", { rank: 5 }), event("today-game", { date: "2026-09-06T21:00:00Z", acc: true, state: "upcoming" })];
  await harness.open({ now: "2026-09-06T04:01:00Z" });
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(page.locator(".overnight-note")).toContainText("Today is staying on Sep 5");
  await expect(page.locator("#game-overnight")).toBeVisible();
  harness.state.events[0] = event("overnight", { rank: 5, state: "final" });
  // Exercise the actual polling interval, without tapping Today or Refresh.
  await page.clock.fastForward(31_000);
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(page.locator("#game-today-game")).toBeVisible();
  await expect(page.locator("#game-overnight")).toHaveCount(0);
  await expect(page.locator(".overnight-note")).toHaveCount(0);
});

test("a manually selected date survives automatic midnight rollover until Today is tapped", async ({ page, harness }) => {
  harness.state.events = [event("overnight", { rank: 5 }), event("today-game", { date: "2026-09-06T21:00:00Z", acc: true, state: "upcoming" })];
  await harness.open({ now: "2026-09-06T04:01:00Z", path: "/?date=2026-09-05" });
  await expect(page.locator("#game-overnight")).toBeVisible();
  harness.state.events[0] = event("overnight", { rank: 5, state: "final" });
  await page.clock.fastForward(31_000);
  await expect(page.locator("#game-overnight .game-status")).toHaveText("Final");
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(page.locator(".overnight-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(page.locator("#game-today-game")).toBeVisible();
});
