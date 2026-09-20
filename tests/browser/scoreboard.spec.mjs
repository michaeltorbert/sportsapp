import { test, expect, event, cards, dateInput, expectCount, expectUpsetCount, expectPressed, category, period } from "./fixtures.mjs";

test("mobile touch navigation toggles categories, resets with All, and keeps Day and Week counts period-relative", async ({ page, harness }, testInfo) => {
  await harness.open();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expectPressed(page, ["All"]);
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  for (const [name, count] of [["All", 3], ["ACC", 1], ["Top 25", 1], ["One score", 2]]) await expectCount(page, name, count);
  await expectUpsetCount(page, 1, 1);
  await expect(cards(page)).toHaveCount(3);
  // ORD-011: All → ACC → ACC + Upsets → Upsets → All, with the union shown once per game.
  await category(page, "ACC").tap(); await expectPressed(page, ["ACC"]);
  await expect(cards(page)).toHaveCount(1); await expect(page.locator("#game-acc-final")).toBeVisible();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await category(page, "Upsets").tap(); await expectPressed(page, ["ACC", "Upsets"]);
  await expect(cards(page)).toHaveCount(2); await expect(page.locator("#game-ranked-live")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ACC and Upset watch.");
  await category(page, "ACC").tap(); await expectPressed(page, ["Upsets"]);
  await expect(cards(page)).toHaveCount(1); await expect(page.locator("#game-ranked-live")).toBeVisible();
  await category(page, "Upsets").tap(); await expectPressed(page, ["All"]);
  await expect(cards(page)).toHaveCount(3);
  await category(page, "All").tap(); await expectPressed(page, ["All"]);
  await expect(cards(page)).toHaveCount(3);
  // Week applies to every category; the date picker gives way to the week label.
  await period(page, "Week").tap();
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(dateInput(page)).toHaveCount(0); await expect(page.locator(".week-label")).toHaveCount(1);
  for (const [name, count] of [["All", 6], ["ACC", 2], ["Top 25", 3], ["One score", 2]]) await expectCount(page, name, count);
  await expectUpsetCount(page, 1, 1);
  await expect(cards(page)).toHaveCount(6);
  await expect(page.locator("#game-sunday-acc")).toBeVisible(); await expect(page.locator("#game-monday-ranked")).toBeVisible();
  await category(page, "Top 25").tap(); await expectPressed(page, ["Top 25"]);
  await expect(cards(page)).toHaveCount(3); await expect(page.locator("#game-friday-ranked")).toBeVisible();
  await category(page, "ACC").tap(); await expectPressed(page, ["ACC", "Top 25"]);
  await expect(cards(page)).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ACC and Top 25 this week.");
  // Day returns to the selected date and keeps the same categories.
  await period(page, "Day").tap();
  await expect(dateInput(page)).toHaveValue("2026-09-05"); await expectPressed(page, ["ACC", "Top 25"]);
  await expect(cards(page)).toHaveCount(2);
  await category(page, "All").tap(); await expect(cards(page)).toHaveCount(3);
  // Real touch events on the desktop engines; verify viewport overflow, controls,
  // and a full-page artifact rather than describing this as physical iOS testing.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of [page.getByRole("button", { name: "Refresh scores" }), page.getByRole("button", { name: "Next day" }), category(page, "All"), category(page, "One score"), period(page, "Week")]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  await page.screenshot({ path: testInfo.outputPath("mobile-watchlist.png"), fullPage: true, animations: "disabled" });
  await testInfo.attach("mobile-watchlist", { path: testInfo.outputPath("mobile-watchlist.png"), contentType: "image/png" });
  await page.getByRole("button", { name: "Next day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(cards(page)).toHaveCount(1);
  await expectCount(page, "All", 1);
  await expectCount(page, "ACC", 1);
  await expectCount(page, "Top 25", 0);
  await period(page, "Week").tap();
  await expect(page.locator("#game-monday-ranked")).toBeVisible();
  await expectCount(page, "Top 25", 3);
  await period(page, "Day").tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await page.getByRole("button", { name: "Previous day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(cards(page)).toHaveCount(3);
});

test("Upsets shows active and total watches without overflowing a 320px viewport", async ({ page, harness }) => {
  harness.state.events = [
    event("brewing-upset", { rank: 5 }),
    event("concluded-upset", { rank: 8, state: "final" }),
  ];
  await page.setViewportSize({ width: 320, height: 700 });
  await harness.open();
  await expectUpsetCount(page, 1, 2);
  await category(page, "Upsets").tap();
  await expect(cards(page)).toHaveCount(2);
  await page.getByLabel("Hide finals").tap();
  await expectUpsetCount(page, 1, 1);
  await expect(cards(page)).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await category(page, "Upsets").boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
});

test("legacy tab links keep their period and explicit category links restore multi-select on either period", async ({ page, harness }) => {
  const visit = async path => { await page.goto(path); await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled(); };
  await harness.open({ path: "/?tab=acc" });
  await expectPressed(page, ["ACC"]); await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#game-sunday-acc")).toBeVisible(); await expect(cards(page)).toHaveCount(2);
  await visit("/?tab=upset");
  await expectPressed(page, ["Upsets"]); await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page)).toHaveCount(1);
  await visit("/?cats=acc,upset&period=week&date=2026-09-04");
  await expectPressed(page, ["ACC", "Upsets"]); await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page)).toHaveCount(3);
  await period(page, "Day").tap();
  await expect(dateInput(page)).toHaveValue("2026-09-04"); await expect(cards(page)).toHaveCount(0);
  await expect(page.locator(".empty-card")).toContainText("Nothing matches these categories.");
  await visit("/?cats=bogus,top25&period=month");
  await expectPressed(page, ["Top 25"]); await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
});

test("keyboard toggling keeps focus on the pressed button and announces the shown count", async ({ page, harness }) => {
  await harness.open();
  const shown = page.locator(".score-content").getByRole("status");
  await expect(shown).toHaveText("3 games shown.");
  await category(page, "ACC").focus();
  await page.keyboard.press("Space");
  await expect(category(page, "ACC")).toBeFocused();
  await expectPressed(page, ["ACC"]);
  await expect(shown).toHaveText("1 game shown.");
  await page.keyboard.press("Space");
  await expect(category(page, "ACC")).toBeFocused();
  await expectPressed(page, ["All"]);
  await expect(shown).toHaveText("3 games shown.");
});

test("Hide finals persists after reload and updates every scope's count", async ({ page, harness }) => {
  await harness.open();
  await expect(page.locator("#game-acc-final")).toBeVisible();
  await page.getByLabel("Hide finals").tap();
  await expect(page.locator("#game-acc-final")).toHaveCount(0);
  await expectCount(page, "All", 2);
  await expectCount(page, "ACC", 0);
  await expectCount(page, "Top 25", 1);
  await expectUpsetCount(page, 1, 1);
  await page.reload();
  await expect(page.getByLabel("Hide finals")).toBeChecked();
  await expectCount(page, "All", 2);
  await expectUpsetCount(page, 1, 1);
  await period(page, "Week").tap();
  await expectCount(page, "All", 4); await expectCount(page, "ACC", 1); await expectCount(page, "Top 25", 2);
  await category(page, "ACC").tap();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator("#game-sunday-acc")).toBeVisible();
  await category(page, "Top 25").tap();
  await expect(page.locator("#game-friday-ranked")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(3);
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
  await expectCount(page, "All", 3);
  await period(page, "Week").tap();
  await category(page, "Top 25").tap();
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


test("home wordmark returns a manually selected date to Today", async ({ page, harness }) => {
  await harness.open({ path: "/?date=2026-09-04" });
  await expect(dateInput(page)).toHaveValue("2026-09-04");
  await page.getByRole("button", { name: "Previous day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-03");
  await page.getByRole("link", { name: "Saturday Signal home" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(page).toHaveURL(/\/$/);
  await expect(cards(page)).toHaveCount(3);
});
