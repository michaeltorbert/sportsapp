import { test, expect, cards, expectCount } from "./fixtures.mjs";

test("primary failure renders browser CDN games without the hosted scoreboard", async ({ page, harness }) => {
  harness.state.failScores = true;
  harness.state.cdnFeed = { content: { sbData: {
    season: { year: 2026, type: 2 }, week: { number: 1 },
    leagues: [{ calendar: [{ value: "2", entries: [
      { value: "1", startDate: "2026-08-22T07:00Z", endDate: "2026-09-08T06:59Z" },
    ] }] }], events: harness.state.events,
  } } };
  await harness.open();
  await expect(cards(page).filter({ hasText: "ranked-live away" })).toBeVisible();
  await expectCount(page, "Top 25", 3);
  await page.getByRole("tab", { name: /^ACC/ }).click();
  await expect(cards(page).filter({ hasText: "sunday-acc away" })).toBeVisible();
  expect(harness.state.scoreRequests.length).toBeGreaterThan(0);
  expect(harness.state.cdnRequests.length).toBeGreaterThan(0);
  expect(harness.state.hostedScoreRequests).toEqual([]);
});
