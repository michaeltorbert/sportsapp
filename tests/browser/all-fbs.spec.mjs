import { test, expect, event, cards, dateInput, expectCount, expectUpsetCount, expectPressed, category, period } from "./fixtures.mjs";

// Issue #176 / ORD-021: the All FBS games scope. Local route fixtures only (simulated ESPN responses);
// not live-feed, provider-completeness or physical-device evidence. The shared standard events stay
// unchanged; each test adds its own games outside the curated watchlist.
const allFbs = page => page.getByRole("checkbox", { name: "All FBS games", exact: true });
const hideFinals = page => page.getByLabel("Hide finals");
const heading = page => page.locator("#scoreboard-heading");
const shown = page => page.locator(".score-content").getByRole("status");
const emptyTitle = page => page.locator('.empty-card [data-slot="empty-title"]');
const saved = page => page.evaluate(() => localStorage.getItem("ss:all-fbs"));
const UPDATE = "0123456789abcdef0123456789abcdef01234567";

// Unranked, non-ACC games: an ordinary upcoming game and an FBS–FCS-shaped matchup on Saturday,
// and another ordinary game on Sunday for Week. The feed fixture carries no FCS classification.
function outsideWatchlist() {
  const fcs = event("fbs-fcs", { state: "upcoming", date: "2026-09-05T17:00:00Z" });
  fcs.competitions[0].competitors[1].team.conferenceId = "81";
  return [event("ordinary-next", { state: "upcoming", date: "2026-09-05T23:00:00Z" }), fcs, event("ordinary-sunday", { state: "upcoming", date: "2026-09-06T20:00:00Z" })];
}
// A confirmed (non-neutral) Duke away game in progress: hidden by the default Duke setting (ORD-020).
// An unknown venue cannot prove an away game and stays shown, so the venue is set explicitly.
function dukeAway() {
  const g = event("duke-away", { acc: true });
  g.competitions[0].neutralSite = false;
  const team = g.competitions[0].competitors[0].team; team.id = "150"; team.shortDisplayName = "Duke"; team.abbreviation = "DUKE";
  return g;
}
async function screenshot(page, testInfo, name, fullPage = false) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
async function assertFixtureMediaIsMuted(page) {
  const muted = await page.evaluate(() => {
    const media = document.createElement("video"); media.muted = false; document.body.append(media);
    media.dispatchEvent(new Event("play", { bubbles: true }));
    const result = media.muted; media.remove(); return result;
  });
  expect(muted, "the browser fixture mutes media before interaction").toBe(true);
}

test("issue acceptance: an ordinary game appears with All FBS games, leaves under ACC, returns with All FBS, and unchecking restores the watchlist, in Day and Week", async ({ page, harness }, testInfo) => {
  harness.state.events = [...harness.state.events, ...outsideWatchlist()];
  await page.setViewportSize({ width: 390, height: 844 });
  await harness.open();
  await assertFixtureMediaIsMuted(page);
  // Default off: All keeps its watchlist meaning and nothing is saved.
  await expect(allFbs(page)).not.toBeChecked();
  expect(await saved(page)).toBeNull();
  await expectPressed(page, ["All"]);
  await expect(category(page, "All").locator("span").first()).toHaveText("All");
  await expect(heading(page)).toHaveText("Your watchlist.");
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator("#game-ordinary-next")).toHaveCount(0);
  await expectCount(page, "All", 2, 3);

  await allFbs(page).check();
  await expectPressed(page, ["All"]);
  await expect(category(page, "All FBS").locator("span").first()).toHaveText("All FBS");
  await expectCount(page, "All FBS", 2, 5);
  await expect(heading(page)).toHaveText("All FBS games.");
  await expect(page.locator("#game-ordinary-next")).toBeVisible(); await expect(page.locator("#game-fbs-fcs")).toBeVisible();
  await expect(cards(page)).toHaveCount(5);
  await expect(shown(page)).toHaveText("5 games shown.");
  expect(await saved(page)).toBe("true");
  // Categories keep their counts and narrow the scope; the checkbox stays checked.
  for (const [name, current, total] of [["ACC", 0, 1], ["Top 25", 1, 1], ["One score", 2, 2]]) await expectCount(page, name, current, total);
  await expectUpsetCount(page, 1, 1);
  await category(page, "ACC").tap();
  await expectPressed(page, ["ACC"]);
  await expect(page.locator("#game-ordinary-next")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(1); await expect(heading(page)).toHaveText("ACC.");
  await expect(allFbs(page)).toBeChecked();
  await expectCount(page, "All FBS", 2, 5);
  await screenshot(page, testInfo, "all-fbs-day-acc-390");
  // Four manual categories are their union, not every FBS game.
  for (const name of ["Top 25", "One score", "Upsets"]) await category(page, name).tap();
  await expectPressed(page, ["ACC", "Top 25", "One score", "Upsets"]);
  await expect(cards(page)).toHaveCount(3); await expect(page.locator("#game-ordinary-next")).toHaveCount(0);
  // The reset clears categories without changing the checkbox.
  await category(page, "All FBS").tap();
  await expectPressed(page, ["All"]);
  await expect(page.locator("#game-ordinary-next")).toBeVisible();
  await expect(allFbs(page)).toBeChecked();
  // Unchecking while narrowed returns at once to the curated watchlist's All.
  await category(page, "Top 25").tap();
  await allFbs(page).uncheck();
  await expectPressed(page, ["All"]);
  await expect(heading(page)).toHaveText("Your watchlist.");
  await expect(cards(page)).toHaveCount(3); await expect(page.locator("#game-ordinary-next")).toHaveCount(0);
  await expectCount(page, "All", 2, 3);
  expect(await saved(page)).toBe("false");
  // Checking while narrowed opens the All FBS view at once.
  await category(page, "ACC").tap();
  await allFbs(page).check();
  await expectPressed(page, ["All"]); await expect(cards(page)).toHaveCount(5);

  // Week: the same scope over the football week; checking keeps the period.
  await period(page, "Week").tap();
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expectCount(page, "All FBS", 2, 9);
  await expect(heading(page)).toHaveText("All FBS games this week.");
  await expect(page.locator("#game-ordinary-sunday")).toBeVisible();
  for (const [name, current, total] of [["ACC", 0, 2], ["Top 25", 1, 3], ["One score", 2, 2]]) await expectCount(page, name, current, total);
  await category(page, "ACC").tap();
  await expect(page.locator("#game-ordinary-sunday")).toHaveCount(0); await expect(cards(page)).toHaveCount(2);
  await category(page, "All FBS").tap();
  await expect(page.locator("#game-ordinary-sunday")).toBeVisible(); await expect(cards(page)).toHaveCount(9);
  await screenshot(page, testInfo, "all-fbs-week-390", true);
  await allFbs(page).uncheck();
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page)).toHaveCount(6); await expectCount(page, "All", 2, 6);
  await expect(heading(page)).toHaveText("Your watchlist this week.");
  await allFbs(page).check();
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");

  // Hide finals excludes finals from both scopes in both periods.
  await hideFinals(page).check();
  await expectCount(page, "All FBS", 2, 7);
  await expect(page.locator("#game-acc-final")).toHaveCount(0); await expect(page.locator("#game-friday-ranked")).toHaveCount(0);
  await period(page, "Day").tap();
  await expectCount(page, "All FBS", 2, 4);
  await expect(page.locator("#game-acc-final")).toHaveCount(0);
  await allFbs(page).uncheck();
  await expectCount(page, "All", 2, 2);
  expect(harness.state.alertRequests.filter(request => request.method !== "GET")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a protected Duke game stays absent and uncounted under All FBS in Day and Week, with its control visible at 320px", async ({ page, harness }, testInfo) => {
  harness.state.events = [...harness.state.events, ...outsideWatchlist(), dukeAway()];
  await page.setViewportSize({ width: 320, height: 760 });
  await harness.open({ path: "/?date=2026-09-05" });
  await expect(page.locator("#game-duke-away")).toHaveCount(0);
  await expectCount(page, "All", 2, 3);
  await allFbs(page).check();
  await expectCount(page, "All FBS", 2, 5);
  await expect(page.locator("#game-duke-away")).toHaveCount(0);
  await expectCount(page, "ACC", 0, 1);
  const control = page.getByRole("button", { name: "Show Duke game on Sep 5", exact: true });
  await expect(control).toBeVisible();
  await expect(allFbs(page)).toBeVisible(); await expect(hideFinals(page)).toBeVisible();
  // The realistic header: feed status, the Duke control and both checkboxes, without overlap or overflow.
  const boxes = await page.evaluate(() => [".feed-status", ".watch-header .duke-controls", ".scope-toggles"].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
  for (const box of boxes) { expect(box.left, box.selector).toBeGreaterThanOrEqual(-.5); expect(box.right, box.selector).toBeLessThanOrEqual(320.5); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.right <= b.left + .5 || b.right <= a.left + .5 || a.bottom <= b.top + .5 || b.bottom <= a.top + .5, `${a.selector} clear of ${b.selector}`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, testInfo, "all-fbs-duke-controls-320");
  await period(page, "Week").tap();
  await expectCount(page, "All FBS", 2, 9);
  await expect(page.locator("#game-duke-away")).toHaveCount(0);
  await screenshot(page, testInfo, "all-fbs-duke-week-320");
});

test("the saved preference survives reload, date and period changes; Home returns to Day and All FBS; ordinary links follow it", async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, ...outsideWatchlist()];
  await harness.open();
  await allFbs(page).check();
  await page.reload();
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(allFbs(page)).toBeChecked();
  await expectCount(page, "All FBS", 2, 5);
  await page.getByRole("button", { name: "Next day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  await expect(allFbs(page)).toBeChecked(); await expect(page.locator("#game-ordinary-sunday")).toBeVisible();
  await period(page, "Week").tap();
  await category(page, "Top 25").tap();
  await expect(allFbs(page)).toBeChecked();
  await page.getByRole("link", { name: "Saturday Signal home" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expectPressed(page, ["All"]);
  await expectCount(page, "All FBS", 2, 5);
  // The scope is never written to the address; ordinary links keep their date, categories and period.
  expect(page.url()).not.toMatch(/fbs/i);
  await page.goto("/?cats=acc&period=week&date=2026-09-04");
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expectPressed(page, ["ACC"]); await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(allFbs(page)).toBeChecked();
  await expect(cards(page)).toHaveCount(2);
  await category(page, "ACC").tap();
  await expect(cards(page)).toHaveCount(9);
  await page.goto("/?tab=upset");
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expectPressed(page, ["Upsets"]); await expect(allFbs(page)).toBeChecked();
  // Unchecked is remembered too, and a link without scope then opens the watchlist.
  await allFbs(page).uncheck();
  await page.goto("/?date=2026-09-05");
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(allFbs(page)).not.toBeChecked(); await expect(cards(page)).toHaveCount(3);
});

test("update restoration links: an explicit scope overrides the opposite saved preference; an older link uses it", async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, ...outsideWatchlist()];
  await harness.open();
  await allFbs(page).check();
  await page.goto(`/?keep=yes&_ss_update=${UPDATE}&_ss_hide_finals=0&_ss_all_fbs=0&_ss_open=0`);
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(allFbs(page)).not.toBeChecked(); await expect(cards(page)).toHaveCount(3);
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=yes");
  expect(await saved(page), "restoring a view never rewrites the preference").toBe("true");
  // Home returns to the saved scope, not the restored one.
  await page.getByRole("link", { name: "Saturday Signal home" }).tap();
  await expect(allFbs(page)).toBeChecked(); await expectCount(page, "All FBS", 2, 5);
  await allFbs(page).uncheck();
  await page.goto(`/?_ss_update=${UPDATE}&_ss_hide_finals=1&_ss_all_fbs=1&_ss_open=0`);
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(allFbs(page)).toBeChecked(); await expect(hideFinals(page)).toBeChecked();
  await expectCount(page, "All FBS", 2, 4);
  expect(await saved(page)).toBe("false");
  await expect.poll(() => page.url()).not.toContain("_ss_");
  // A link from before this change has no scope: the saved preference applies.
  for (const [preference, checked] of [["true", true], ["false", false]]) {
    await page.evaluate(value => localStorage.setItem("ss:all-fbs", value), preference);
    await page.goto(`/?_ss_update=${UPDATE}&_ss_hide_finals=0&_ss_open=0`);
    await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
    if (checked) await expect(allFbs(page)).toBeChecked(); else await expect(allFbs(page)).not.toBeChecked();
    await expect(cards(page)).toHaveCount(checked ? 5 : 3);
  }
});

test("checking All FBS games while the first empty daily schedule is loading keeps Day", async ({ page, harness }) => {
  harness.state.events = [];
  harness.state.holdAfterInitialProbe = true;
  await harness.open({ waitForScores: false });
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect.poll(() => harness.state.heldScoreReleases.length).toBeGreaterThan(0);
  await allFbs(page).check();
  harness.state.releaseScores();
  await expect(emptyTitle(page)).toHaveText("No FBS games on this day.");
  await expect(page.locator(".empty-card")).toContainText("Choose another date to check the schedule. New games appear automatically.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expectCount(page, "All FBS", 0, 0);
});

test("unchecking while the first empty daily schedule is loading also keeps Day", async ({ page, harness }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("ss:all-fbs", "true"); sessionStorage.setItem("seeded", "1"); } });
  harness.state.events = [];
  harness.state.holdAfterInitialProbe = true;
  await harness.open({ waitForScores: false });
  await expect.poll(() => harness.state.heldScoreReleases.length).toBeGreaterThan(0);
  await expect(allFbs(page)).toBeChecked();
  await allFbs(page).uncheck();
  harness.state.releaseScores();
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
});

test("the Guide keeps its own All games and Watchlist choice in either Scores scope", async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, ...outsideWatchlist()];
  await harness.open();
  await allFbs(page).check();
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await expect(page.getByRole("button", { name: "All games", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Watchlist only", exact: true }).click();
  await expect(page.getByRole("button", { name: "Watchlist only", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.has("_ss_all_fbs")).toBe(false);
  await page.getByRole("link", { name: "Scores", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(allFbs(page)).toBeChecked(); await expectCount(page, "All FBS", 2, 5);
  expect(await saved(page)).toBe("true");
  await allFbs(page).uncheck();
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await expect(page.getByRole("button", { name: "All games", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(allFbs(page)).not.toBeChecked(); await expect(cards(page)).toHaveCount(3);
});

test("keyboard: Space toggles the labeled checkbox, keeps focus and announces the shown count", async ({ page, harness, browserName }, testInfo) => {
  harness.state.events = [...harness.state.events, ...outsideWatchlist()];
  await page.setViewportSize({ width: 390, height: 844 });
  await harness.open();
  await expect(allFbs(page)).toHaveAccessibleName("All FBS games");
  await expect(shown(page)).toHaveText("3 games shown.");
  // Chromium tabs to checkboxes; WebKit's tab order follows a platform preference, so focus is set directly there.
  if (browserName === "chromium") { await hideFinals(page).focus(); await page.keyboard.press("Tab"); } else await allFbs(page).focus();
  await expect(allFbs(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(allFbs(page)).toBeChecked(); await expect(allFbs(page)).toBeFocused();
  await expect(shown(page)).toHaveText("5 games shown.");
  await screenshot(page, testInfo, "all-fbs-keyboard-focus-390");
  await page.keyboard.press("Space");
  await expect(allFbs(page)).not.toBeChecked(); await expect(allFbs(page)).toBeFocused();
  await expect(shown(page)).toHaveText("3 games shown.");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press("Space");
  await expect(allFbs(page)).toBeFocused();
  await screenshot(page, testInfo, "all-fbs-keyboard-focus-1280");
});

test("in-document game Back and Forward restore the All FBS view and focus", async ({ page, harness }) => {
  harness.state.events = [...harness.state.events, ...outsideWatchlist()];
  await page.setViewportSize({ width: 393, height: 640 });
  await harness.open();
  await allFbs(page).check();
  await page.locator("#game-ordinary-next a.game-summary").tap();
  await expect(page.locator(".game-screen")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("event")).toBe("ordinary-next");
  expect(page.url()).not.toMatch(/fbs/i);
  await page.goBack();
  await expect(page.locator(".game-screen")).toHaveCount(0);
  await expect(allFbs(page)).toBeChecked();
  await expect(page.locator("#game-ordinary-next a.game-summary")).toBeFocused();
  await page.goForward();
  await expect(page.locator(".game-screen")).toBeVisible();
  await page.locator(".game-screen .game-bar").getByRole("button", { name: /^Back to scores/ }).tap();
  await expect(page.locator("#game-ordinary-next a.game-summary")).toBeFocused();
  await expectCount(page, "All FBS", 2, 5);
});
