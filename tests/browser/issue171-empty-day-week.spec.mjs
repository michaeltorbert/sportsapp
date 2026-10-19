import { test, expect, event, dateInput, period } from "./fixtures.mjs";

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function emptyTitle(page) {
  return page.locator('.empty-card [data-slot="empty-title"]');
}

async function assertFixtureMediaIsMuted(page) {
  const muted = await page.evaluate(() => {
    const media = document.createElement("video");
    media.muted = false;
    document.body.append(media);
    // This real event reaches the fixture's capture listener without starting playback.
    media.dispatchEvent(new Event("play", { bubbles: true }));
    const result = media.muted;
    media.remove();
    return result;
  });
  expect(muted, "the browser fixture mutes media before interaction").toBe(true);
}

test("ordinary empty Today opens the existing Thursday–Monday week and preserves deliberate Day", async ({ page, harness }, testInfo) => {
  harness.state.events = [];
  await harness.open();
  await assertFixtureMediaIsMuted(page);

  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".week-label")).toContainText("Sep 3 – Sep 7");
  await expect(page.locator(".week-note")).toHaveText("THU–MON");
  await expect(emptyTitle(page)).toHaveText("A quiet football week.");
  await screenshot(page, testInfo, "empty-today-default-week-mobile");

  await page.setViewportSize({ width: 1280, height: 900 });
  await screenshot(page, testInfo, "empty-today-default-week-desktop");
  await page.setViewportSize({ width: 390, height: 844 });

  await period(page, "Day").tap();
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
  await screenshot(page, testInfo, "retained-day-after-empty-default");

  await period(page, "Week").tap();
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(emptyTitle(page)).toHaveText("A quiet football week.");
});

test("empty Today opens a nonempty existing football week", async ({ page, harness }) => {
  harness.state.events = [event("sunday-in-week", { date: "2026-09-06T21:00:00Z", acc: true, state: "upcoming" })];
  await harness.open();
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#game-sunday-in-week")).toBeVisible();
  await expect(page.locator("#game-sunday-in-week .game-day-label")).toContainText("Sun, Sep 6");
});

test("an explicit empty Day link keeps Day selected", async ({ page, harness }) => {
  harness.state.events = [];
  await harness.open({ path: "/?period=day" });
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
});

test("an explicit empty Week link keeps Week selected", async ({ page, harness }) => {
  harness.state.events = [];
  await harness.open({ path: "/?period=week" });
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "true");
  await expect(emptyTitle(page)).toHaveText("A quiet football week.");
});

test("an explicit empty date link keeps its requested date and Day selected", async ({ page, harness }) => {
  harness.state.events = [];
  await harness.open({ path: "/?date=2026-09-04" });
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(dateInput(page)).toHaveValue("2026-09-04");
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
});

test("first real daily games keep Day through an empty category and a later empty refresh", async ({ page, harness }) => {
  harness.state.events = [event("unranked-day", { state: "upcoming", acc: false, rank: null })];
  harness.state.holdAfterInitialProbe = true;
  await harness.open({ waitForScores: false });
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect.poll(() => harness.state.heldScoreReleases.length).toBeGreaterThan(0);

  // Filtering can make the visible list empty before the successful daily feed arrives.
  await page.getByRole("button", { name: /^ACC,/ }).tap();
  harness.state.releaseScores();
  await expect(emptyTitle(page)).toHaveText("No ACC games on this day.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#game-unranked-day")).toHaveCount(0);

  // A later empty refresh cannot turn an already resolved Day choice into Week.
  harness.state.events = [];
  await page.getByRole("button", { name: "Refresh scores" }).tap();
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(emptyTitle(page)).toHaveText("No ACC games on this day.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
});

test("an explicit Day choice made while the initial empty schedule is loading wins", async ({ page, harness }) => {
  harness.state.events = [];
  harness.state.holdAfterInitialProbe = true;
  await harness.open({ waitForScores: false });
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect.poll(() => harness.state.heldScoreReleases.length).toBeGreaterThan(0);
  await period(page, "Day").tap();
  harness.state.releaseScores();
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
});

test("a manual date chosen while the initial empty schedule is loading wins", async ({ page, harness }) => {
  harness.state.events = [];
  harness.state.holdAfterInitialProbe = true;
  await harness.open({ waitForScores: false });
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expect.poll(() => harness.state.heldScoreReleases.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Next day" }).tap();
  await expect(dateInput(page)).toHaveValue("2026-09-06");
  harness.state.releaseScores();
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(dateInput(page)).toHaveValue("2026-09-06");
});

test("an app-update restoration link keeps its saved Day view on an empty schedule", async ({ page, harness }) => {
  harness.state.events = [];
  await harness.open({ path: "/?_ss_update=0123456789abcdef0123456789abcdef01234567&_ss_hide_finals=0&_ss_open=0" });
  await expect(emptyTitle(page)).toHaveText("A quiet scoreboard.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
});

test("a failed initial score feed does not count as an empty schedule", async ({ page, harness }) => {
  harness.state.events = [];
  harness.state.failAfterInitialProbe = true;
  await harness.open();
  await expect(page.getByRole("alert")).toContainText("Could not refresh scores");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "false");
  await expect(emptyTitle(page)).toHaveText("Scores are temporarily unavailable");
});

test("a stale hosted empty board stays on Day without claiming the schedule is empty", async ({ page, harness }) => {
  harness.state.events = [];
  harness.state.failScores = true;
  harness.state.hostedScoreResponse = url => ({
    date: url.searchParams.get("date"), endDate: url.searchParams.get("end"),
    fetchedAt: "2026-09-06T03:59:00.000Z", games: [], stale: true,
  });
  await harness.open();
  await expect(page.getByRole("alert")).toContainText("ESPN is unavailable. Showing the last successful scores.");
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  await expect(period(page, "Week")).toHaveAttribute("aria-pressed", "false");
});
