import { test, expect, event, cards, dateInput, expectCount, expectUpsetCount, expectPressed, category, period } from "./fixtures.mjs";

test("mobile touch navigation toggles categories, resets with All, and keeps Day and Week counts period-relative", async ({ page, harness }, testInfo) => {
  await harness.open();
  await expect(dateInput(page)).toHaveValue("2026-09-05");
  await expectPressed(page, ["All"]);
  await expect(period(page, "Day")).toHaveAttribute("aria-pressed", "true");
  for (const [name, current, total] of [["All", 2, 3], ["ACC", 0, 1], ["Top 25", 1, 1], ["One score", 2, 2]]) await expectCount(page, name, current, total);
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
  for (const [name, current, total] of [["All", 2, 6], ["ACC", 0, 2], ["Top 25", 1, 3], ["One score", 2, 2]]) await expectCount(page, name, current, total);
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
  await expectCount(page, "All", 0, 1);
  await expectCount(page, "ACC", 0, 1);
  await expectCount(page, "Top 25", 0, 0);
  await period(page, "Week").tap();
  await expect(page.locator("#game-monday-ranked")).toBeVisible();
  await expectCount(page, "Top 25", 1, 3);
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
  // The All chip uses its own pair markup, never the Upsets count classes.
  await expectCount(page, "All", 1, 2);
  await expect(category(page, "All").locator(".upset-count, .upset-total")).toHaveCount(0);
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

test("September 26 ranked deficits enter Day Upsets after retaining contrary pregame lines", async ({ page, harness }) => {
  const scenarios = [
    ["401856699", 4, 21, [3, 10]],
    ["401858463", 17, 18, [7, 10]],
  ];
  const makeEvent = ([id, higherRank, lowerRank, scores], state) => {
    const result = event(id, { date: "2026-09-26T19:30:00Z", state, rank: higherRank, scores });
    const competitors = result.competitions[0].competitors;
    competitors[1].curatedRank.current = lowerRank;
    if (state === "upcoming") result.competitions[0].odds = [{
      spread: -3, provider: { id: "100", name: "ESPN pregame", priority: 1 },
      awayTeamOdds: { favorite: false, team: { id: competitors[0].id } },
      homeTeamOdds: { favorite: true, team: { id: competitors[1].id } },
    }];
    return result;
  };
  harness.state.events = scenarios.map(scenario => makeEvent(scenario, "upcoming"));
  await harness.open({ now: "2026-09-26T21:06:00Z", path: "/?date=2026-09-26&cats=upset&period=day" });
  await expectUpsetCount(page, 0, 0);
  const retainedFavorites = () => page.evaluate(() => Object.fromEntries(
    JSON.parse(localStorage.getItem("ss:board:2026-09-26:2026-09-26") || "{}").games?.map(game => [game.id, game.pregameLine?.favoriteId]) || []));
  expect(await retainedFavorites()).toEqual({
    "401856699": "401856699-home", "401858463": "401858463-home",
  });
  harness.state.events = scenarios.map(scenario => makeEvent(scenario, "live"));
  await page.getByRole("button", { name: "Refresh scores" }).tap();
  await expectUpsetCount(page, 2, 2);
  expect(await retainedFavorites()).toEqual({
    "401856699": "401856699-home", "401858463": "401858463-home",
  });
  for (const [id] of scenarios) {
    const card = page.locator(`#game-${id}`);
    await expect(card).toBeVisible();
    await card.locator("a.game-summary").tap();
    await expect(page.locator(".game-screen .upset-reason")).toContainText("rank-based upset");
    await page.locator(".game-screen").getByRole("button", { name: /^Back to scores/ }).tap();
    await expect(page.locator(".game-screen")).toHaveCount(0);
  }
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
  await expectCount(page, "All", 2, 2);
  await expectCount(page, "ACC", 0, 0);
  await expectCount(page, "Top 25", 1, 1);
  await expectUpsetCount(page, 1, 1);
  await page.reload();
  await expect(page.getByLabel("Hide finals")).toBeChecked();
  await expectCount(page, "All", 2, 2);
  await expectUpsetCount(page, 1, 1);
  await period(page, "Week").tap();
  await expectCount(page, "All", 2, 4); await expectCount(page, "ACC", 0, 1); await expectCount(page, "Top 25", 1, 2);
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
  await expect(category(page, "Upsets")).toHaveAttribute("aria-label", "Upsets, counts unavailable while scores are stale");
  for (const label of ["All", "ACC", "Top 25", "One score"]) {
    await expect(category(page, label).locator(".tab-count")).toHaveText("– (–)");
    await expect(category(page, label)).toHaveAttribute("aria-label", `${label}, counts unavailable while scores are stale`);
  }
  await expect(category(page, "Upsets").locator(".tab-count")).toHaveText("– (–)");
  await period(page, "Week").tap();
  await category(page, "Top 25").tap();
  await expect(page.locator("#game-monday-ranked")).toBeVisible();
  harness.state.events.push(event("recovered-rank-watch", { rank: 17, scores: [7, 10] }));
  harness.state.failScores = false;
  await page.getByRole("button", { name: "Retry", exact: true }).tap();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await period(page, "Day").tap();
  await expectCount(page, "All", 3, 4);
  await expectUpsetCount(page, 2, 2);
  await category(page, "Upsets").tap();
  await expect(page.locator("#game-recovered-rank-watch")).toBeVisible();
  await page.getByRole("button", { name: "How this scoreboard works" }).tap();
  await expect(page.locator(".help-body")).toContainText("When scores are stale, offline, or more than 90 seconds old");
  await expect(page.locator(".help-body")).toContainText("category counts show dashes instead of fresh numbers");
  await expect(page.locator(".help-body")).toContainText("Counts return after a successful refresh");
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


// A busy simulated ESPN week below the 200-game response limit: two-digit in-progress counts and three-digit totals.
function busyWeek() {
  const many = (prefix, n, options) => Array.from({ length: n }, (_, i) => event(`${prefix}-${i}`, options));
  return [
    ...many("acc-upset", 4, { acc: true, rank: 5 }), // live: ACC, Top 25, One score and Upsets
    ...many("tied", 6, { scores: [10, 10] }), // live: One score
    ...many("ranked-lead", 8, { rank: 10, scores: [28, 7] }), // live: Top 25
    ...many("acc-next", 40, { acc: true, state: "upcoming", date: "2026-09-06T21:00:00Z" }),
    ...many("ranked-next", 60, { rank: 15, state: "upcoming", date: "2026-09-07T23:00:00Z" }),
    ...many("acc-final", 20, { acc: true, state: "final", scores: [28, 7] }),
    ...many("ranked-close-final", 50, { rank: 20, state: "final", scores: [21, 14] }), // Top 25 and One score
    ...many("ranked-upset-final", 8, { rank: 8, state: "final" }), // completed upset, Top 25 and One score
  ];
}

// The rendered category row: geometry, fonts and line counts of each label and count pair.
function chipLayout(page) {
  return page.evaluate(() => {
    const group = document.querySelector(".filter-tabs"), groupBox = group.getBoundingClientRect(), viewport = document.documentElement.clientWidth;
    const outsideViewport = box => box.left < -.5 || box.right > viewport + .5;
    // Distinct line positions within an element; one line has (almost) no spread.
    const spread = element => { const range = document.createRange(); range.selectNodeContents(element); const tops = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => r.top); return tops.length ? Math.max(...tops) - Math.min(...tops) : Infinity; };
    const inside = (inner, outer) => inner.left >= outer.left - .5 && inner.right <= outer.right + .5 && inner.top >= outer.top - .5 && inner.bottom <= outer.bottom + .5;
    return {
      documentFits: document.documentElement.scrollWidth <= innerWidth,
      groupFits: group.scrollWidth <= group.clientWidth,
      groupInViewport: !outsideViewport(groupBox),
      // Every visible element outside the Scores header that extends past the viewport.
      overflowOutsideHeader: [...document.body.querySelectorAll("*")].filter(el => {
        if (el.closest("[hidden], .app-header")) return false;
        const style = getComputedStyle(el), box = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && (box.width > 0 || box.height > 0) && outsideViewport(box);
      }).map(el => `${el.tagName.toLowerCase()}.${el.getAttribute("class") || ""}`),
      chips: [...group.querySelectorAll(".filter-tab")].map(button => {
        const [label, count] = button.children, total = count.querySelector(".count-total, .upset-total");
        const box = button.getBoundingClientRect(), labelBox = label.getBoundingClientRect(), countBox = count.getBoundingClientRect();
        return {
          label: label.textContent, count: count.textContent, top: box.top, height: box.height,
          // Subpixel content widths round differently, so text clipping is checked by the boxes below.
          fits: button.scrollWidth <= button.clientWidth, inGroup: inside(box, groupBox),
          labelInside: inside(labelBox, box), countInside: inside(countBox, box), countBelow: countBox.top >= labelBox.bottom - .5,
          labelSpread: spread(label), countSpread: spread(count),
          labelSize: getComputedStyle(label).fontSize, countSize: getComputedStyle(count).fontSize, countOpacity: getComputedStyle(count).opacity,
          totalSize: total ? getComputedStyle(total).fontSize : null, totalOpacity: total ? getComputedStyle(total).opacity : null,
        };
      }),
    };
  });
}

// At normal text sizes the five chips share one row. Enlarged text or zoom may wrap whole chips,
// but never shrinks, clips or splits a label or count pair, or overflows the row, viewport or page.
// headerOverflowControl is used only where the documented base control shows the Scores header
// itself overflowing; the page check then covers everything outside that header.
async function expectCompactChips(page, expected, { oneRow = true, labelSize = "12px", countSize = "11px", headerOverflowControl = false } = {}) {
  const layout = await chipLayout(page);
  if (headerOverflowControl) expect(layout.overflowOutsideHeader, "nothing outside the Scores header extends past the viewport").toEqual([]);
  else expect(layout.documentFits, "no document overflow").toBe(true);
  expect(layout.groupInViewport, "the category row stays inside the viewport").toBe(true);
  expect(layout.groupFits, "no category row overflow").toBe(true);
  expect(layout.chips.map(chip => [chip.label, chip.count])).toEqual(expected);
  for (const chip of layout.chips) {
    if (oneRow) expect(Math.abs(chip.top - layout.chips[0].top), `${chip.label} shares the one row`).toBeLessThan(1);
    expect(chip.height, `${chip.label} height`).toBeGreaterThanOrEqual(44);
    expect(chip, chip.label).toMatchObject({ fits: true, inGroup: true, labelInside: true, countInside: true, countBelow: true, labelSize, countSize, countOpacity: "1" });
    expect(chip.labelSpread, `${chip.label} label stays on one line`).toBeLessThan(4);
    expect(chip.countSpread, `${chip.label} count pair stays on one line`).toBeLessThan(4);
    if (chip.totalSize !== null) expect(chip, `${chip.label} total`).toMatchObject({ totalSize: countSize, totalOpacity: "0.62" });
  }
}

async function attachScreenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

for (const width of [320, 390, 1280]) test(`category chips keep one row of one-line labels and count pairs at ${width}px, normal, busy, unavailable and empty`, async ({ page, harness }, testInfo) => {
  await page.setViewportSize({ width, height: 800 });
  await harness.open();
  await expectCount(page, "All", 2, 3);
  await expectCompactChips(page, [["All", "2 (3)"], ["ACC", "0 (1)"], ["Top 25", "1 (1)"], ["One score", "2 (2)"], ["Upsets", "1 (1)"]]);
  await attachScreenshot(page, testInfo, `chips-normal-${width}`);
  await period(page, "Week").click();
  harness.state.events = busyWeek();
  await page.getByRole("button", { name: "Refresh scores" }).click();
  for (const [name, current, total] of [["All", 18, 196], ["ACC", 4, 64], ["Top 25", 12, 130], ["One score", 10, 68]]) await expectCount(page, name, current, total);
  await expectUpsetCount(page, 4, 12);
  await expectCompactChips(page, [["All", "18 (196)"], ["ACC", "4 (64)"], ["Top 25", "12 (130)"], ["One score", "10 (68)"], ["Upsets", "4 (12)"]]);
  await attachScreenshot(page, testInfo, `chips-busy-${width}`);
  // Unavailable counts are dashes, never fresh numbers or zeros.
  harness.state.failScores = true;
  await page.getByRole("button", { name: "Refresh scores" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not refresh scores");
  for (const label of ["All", "ACC", "Top 25", "One score"]) await expect(category(page, label)).toHaveAttribute("aria-label", `${label}, counts unavailable while scores are stale`);
  await expectCompactChips(page, ["All", "ACC", "Top 25", "One score", "Upsets"].map(label => [label, "– (–)"]));
  // A loaded empty week is a real zero.
  harness.state.failScores = false; harness.state.events = [];
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const label of ["All", "ACC", "Top 25", "One score"]) await expectCount(page, label, 0, 0);
  await expectUpsetCount(page, 0, 0);
  await expectCompactChips(page, ["All", "ACC", "Top 25", "One score", "Upsets"].map(label => [label, "0 (0)"]));
});

// The preserved 200 percent flows: doubled root text, and actual CSS zoom with and without wide
// fallback fonts (Linux CI WebKit's wider metrics), on a busy week's multidigit counts.
const BUSY_CHIPS = [["All", "18 (196)"], ["ACC", "4 (64)"], ["Top 25", "12 (130)"], ["One score", "10 (68)"], ["Upsets", "4 (12)"]];
const WIDE_FONT = "*, *::before, *::after { font-family: Verdana, 'DejaVu Sans', sans-serif !important; }";
// Base control (4a666106, identical external diagnostic harness, WebKit): with actual 2x CSS zoom the
// Scores header's four 44px controls (88px each when zoomed) already extend past the viewport: Settings
// ends at 376px of 320 (busy week, normal and wide fonts), at 392px of 375 (busy week, normal and wide
// fonts) and at 392px of 390 (Day, Week and busy week, normal and wide fonts), whether or not the category
// row is shown or reset; hiding only the header removes the page overflow, and the candidate measures
// the same in all 10 cases. That existing header overflow is a separate follow-up, so only WebKit's zoom cases below 393px
// replace the whole-page check with: nothing outside the header may extend past the viewport, and the
// category row stays inside it. Chromium, doubled root text, 393px and 430px keep the whole-page check.
for (const width of [320, 375, 390, 393, 430]) for (const [mode, style, sizes] of [
  ["text", "html { font-size: 200%; }", { labelSize: "24px", countSize: "22px" }],
  ["zoom", "html { zoom: 2; }", {}],
  ["zoom-wide", `html { zoom: 2; } ${WIDE_FONT}`, {}],
]) test(`enlarged ${mode} at ${width}px wraps whole category chips without overflow, clipping or smaller text`, async ({ page, harness, browserName }, testInfo) => {
  const headerOverflowControl = browserName === "webkit" && mode !== "text" && width < 393;
  await page.setViewportSize({ width, height: 844 });
  await harness.open();
  await period(page, "Week").click();
  harness.state.events = busyWeek();
  await page.getByRole("button", { name: "Refresh scores" }).click();
  await expectCount(page, "All", 18, 196);
  await expectCompactChips(page, BUSY_CHIPS);
  await page.addStyleTag({ content: style });
  if (mode !== "text") expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("2");
  await expectCompactChips(page, BUSY_CHIPS, { oneRow: false, ...sizes, headerOverflowControl });
  // Counts and their spoken meaning are unchanged by the enlarged layout.
  await expectCount(page, "All", 18, 196); await expectUpsetCount(page, 4, 12);
  await attachScreenshot(page, testInfo, `chips-enlarged-${mode}-${width}`);
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
