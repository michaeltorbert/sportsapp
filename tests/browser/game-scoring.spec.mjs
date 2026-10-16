import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, event, NOW } from "./fixtures.mjs";
import { bundle } from "../helpers.mjs";

// Scoring section (issue #149). Responses are the real normalizer's output, served through the
// intercepted same-origin route as the Worker would: scoring only when the request asks for it.
// COMPOSED: the genuine scoring header/scoringPlays fixture joined to the existing genuine boxscore
// fixture for the same event (live); header-and-scoring only where no boxscore fixture exists.
const { normalizeGameStats, withoutScoring } = await bundle("lib/game-stats.ts");
const read = name => JSON.parse(readFileSync(new URL(`../fixtures/espn-summary-${name}.json`, import.meta.url), "utf8"));
const LIVE = { id: "401856717", teams: ["251", "201"] }, OT = { id: "401856715", teams: ["99", "96"] }, PREGAME = { id: "401862800", teams: ["151", "5"] };
const DUKE = { id: "401999150", teams: ["251", "150"] };
function summary(id) {
  if (id === LIVE.id) { const s = read("scoring-live"); return { ...read("live"), header: s.header, scoringPlays: s.scoringPlays }; }
  if (id === OT.id) return read("scoring-final-ot");
  if (id === PREGAME.id) return read("scoring-pregame");
  // SYNTHETIC: the genuine live boxscore re-identified as a Duke home game, as in game-screen.spec.mjs.
  const raw = read("live"), swap = team => { if (String(team?.id) === "201") team.id = "150"; };
  raw.header.id = DUKE.id;
  for (const c of raw.header.competitions[0].competitors) swap(c.team);
  for (const t of [...raw.boxscore.teams, ...raw.boxscore.players]) swap(t.team);
  return raw;
}
function serve(harness, { legacy = false } = {}) {
  harness.state.stats = async (url, route) => {
    const id = url.searchParams.get("event"), stats = normalizeGameStats(summary(id), id, new Date(Date.parse(NOW) - 5000).toISOString());
    // `legacy`: a Worker from before scoring, which ignores the parameter.
    const body = !legacy && url.searchParams.get("scoring") === "1" ? stats : withoutScoring(stats);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  };
}
// Genuine team identities from the scoring fixtures' own headers. The harness event() supplies
// generic labels (AWAY/HOME); scores, status, rank and conference stay the synthetic scoreboard's.
const HEADERS = { [LIVE.id]: read("scoring-live").header, [OT.id]: read("scoring-final-ot").header, [PREGAME.id]: read("scoring-pregame").header };
function matchup({ id, teams }, options) {
  const e = event(id, options), header = HEADERS[id];
  e.competitions[0].competitors.forEach((c, i) => {
    c.id = teams[i]; c.team.id = teams[i];
    const source = header?.competitions[0].competitors.find(s => s.homeAway === c.homeAway);
    if (!source) return;
    // The fixture's home/away team must be the one this side was given, never matched by position alone.
    if (source.team.id !== teams[i]) throw new Error(`Fixture ${id} ${c.homeAway} team ${source.team.id} is not ${teams[i]}`);
    c.team.abbreviation = source.team.abbreviation;
    c.team.shortDisplayName = source.team.displayName.replace(/\s+\S+$/, "");
  });
  return e;
}
const screen = page => page.locator(".game-screen");
const view = (page, name) => screen(page).getByRole("button", { name, exact: true });
const cardLink = (page, id) => page.locator(`#game-${id} a.game-summary`);
const panel = page => screen(page).locator("#panel-scoring");
const periodRows = page => page.locator(".scoring-periods tbody tr").evaluateAll(rows => rows.map(r => [...r.querySelectorAll("th > span:first-child, td")].map(c => c.textContent.trim())));
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// Section buttons: their boxes, and whether every label line stays inside its own button.
const sections = page => page.locator(".view-switch button").evaluateAll(buttons => buttons.map(b => {
  const range = document.createRange(); range.selectNodeContents(b);
  const box = b.getBoundingClientRect(), text = range.getBoundingClientRect();
  return { name: b.textContent, top: Math.round(box.top), height: box.height, width: box.width, inside: text.left >= box.left - 0.5 && text.right <= box.right + 0.5 };
}));

test("Scoring: genuine live scoring in the third section, on the one stats request and poll, with its own URL, Back, Forward and reload", async ({ page, harness }, info) => {
  serve(harness);
  harness.state.events = [matchup(LIVE, { state: "live" })];
  await page.setViewportSize({ width: 390, height: 844 });
  await harness.open();
  await cardLink(page, LIVE.id).tap();
  // Team stats stays the default.
  await expect(view(page, "Team stats")).toHaveAttribute("aria-pressed", "true");
  await expect(screen(page).getByRole("row", { name: /Total yards/ })).toContainText("235");
  const scoring = view(page, "Scoring");
  await scoring.tap();
  await expect(scoring).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/[?&]section=scoring(&|$)/);
  expect(await page.evaluate(() => history.state?.ss)).toMatchObject({ kind: "game", id: LIVE.id, section: "scoring" });
  await expect(panel(page).getByRole("heading", { name: "Scoring", level: 2 })).toBeVisible();
  await expect(screen(page).locator("#panel-team")).toBeHidden();
  expect(await periodRows(page)).toEqual([["TEX", "7", "10", "0", "17"], ["OU", "0", "7", "3", "10"]]);
  await expect(panel(page).locator(".scoring-play")).toHaveCount(5);
  await expect(panel(page).locator(".scoring-play").first()).toContainText("A. Manning pass to C. Coleman for 41 yds");
  await expect(panel(page).getByText("Source reports 3:48 - 3rd")).toBeVisible();
  // The masthead keeps the scoreboard's score; scoring never rewrites it.
  await expect(screen(page).locator(".mh-score")).toHaveText(["14", "21"]);
  // One request served Team stats and Scoring; switching sections fetched nothing.
  expect(harness.state.statsRequests).toEqual([`?event=${LIVE.id}&phase=started&refresh=0&scoring=1`]);
  for (const b of await sections(page)) expect(b.height).toBeGreaterThanOrEqual(44);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: info.outputPath("scoring-live-390.png"), animations: "disabled" });
  // The started poll keeps running on Scoring, still one stream.
  await page.clock.fastForward(31_000);
  await expect.poll(() => harness.state.statsRequests.length).toBe(2);
  await expect(scoring).toHaveAttribute("aria-pressed", "true");
  // Keyboard: Enter and Space switch sections without moving focus.
  await view(page, "Team stats").focus(); await page.keyboard.press("Enter");
  await expect(view(page, "Team stats")).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/section=/);
  await scoring.focus(); await page.keyboard.press("Space");
  await expect(scoring).toHaveAttribute("aria-pressed", "true");
  await expect(scoring).toBeFocused();
  // No player category jumps outside Player stats.
  await expect(screen(page).locator(".jump-links")).toHaveCount(0);
  // Section switches replace the entry: Back returns straight to the scoreboard; Forward restores Scoring.
  await page.goBack();
  await expect(page.locator(".scores-view")).toBeVisible();
  await expect(cardLink(page, LIVE.id)).toBeFocused();
  await page.goForward();
  await expect(view(page, "Scoring")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).locator(".scoring-play")).toHaveCount(5);
  // Reload keeps the section from the URL.
  await page.reload();
  await expect(view(page, "Scoring")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).locator(".scoring-play")).toHaveCount(5);
  // Leaving the screen stops polling.
  await screen(page).getByRole("button", { name: /^Back to scores/ }).tap();
  await expect(screen(page)).toHaveCount(0);
  const requests = harness.state.statsRequests.length;
  await page.clock.fastForward(61_000);
  expect(harness.state.statsRequests).toHaveLength(requests);
});

test("Scoring: genuine Final/OT via a direct link, current pregame via its direct link, and an older Worker without scoring", async ({ page, harness }) => {
  serve(harness);
  harness.state.events = [matchup(OT, { state: "final", scores: [34, 35] }), matchup(PREGAME, { state: "upcoming", date: "2026-09-06T01:00:00Z" })];
  await harness.open({ path: `/?event=${OT.id}&section=scoring&date=2026-09-05`, waitForScores: false });
  await expect(view(page, "Scoring")).toHaveAttribute("aria-pressed", "true");
  expect(await periodRows(page)).toEqual([["LSU", "10", "7", "3", "7", "7", "34"], ["UK", "7", "14", "0", "6", "8", "35"]]);
  await expect(panel(page).locator("thead abbr[title='Overtime']")).toHaveText("OT");
  const plays = panel(page).locator(".scoring-play");
  await expect(plays).toHaveCount(12);
  await expect(plays.nth(10)).toContainText("Sam Leavitt 15 Yd Run");
  await expect(plays.nth(11)).toContainText("CJ Baxter 1 Yd Run (Kenny Minchey Run for Two-Point Conversion)");
  for (const i of [10, 11]) await expect(plays.nth(i).locator(".scoring-when")).toHaveText(/OT\s*0:00/);
  // This source has no boxscore: Team stats says so independently.
  await view(page, "Team stats").tap();
  await expect(screen(page).getByText("No stats available yet")).toBeVisible();
  // The unranked, non-ACC pregame game is not in the Scores watchlist; its supported direct link opens it.
  await page.goto(`/?event=${PREGAME.id}&section=scoring&date=2026-09-05`);
  await expect(view(page, "Scoring")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByText("Scoring starts after kickoff")).toBeVisible();
  await expect(panel(page).locator(".scoring-periods, .scoring-play")).toHaveCount(0);
  // New client, older Worker: Team stats as released and an explicit Scoring state.
  serve(harness, { legacy: true });
  await page.goto(`/?event=${OT.id}&section=scoring&date=2026-09-05`);
  await expect(panel(page).getByText("Scoring unavailable")).toBeVisible();
  await expect(panel(page).getByText("Scoring was not supplied for this game. Team stats and Player stats remain available.")).toBeVisible();
});

test("hiding a Duke game while Scoring is open leaves only the generic screen and stops its stats work", async ({ page, harness }) => {
  serve(harness);
  const duke = matchup(DUKE, { acc: true });
  duke.competitions[0].neutralSite = false;
  const team = duke.competitions[0].competitors[1].team; team.shortDisplayName = "Duke"; team.abbreviation = "DUKE";
  harness.state.events = [duke];
  await harness.open({ path: "/?date=2026-09-05" });
  await cardLink(page, DUKE.id).tap();
  await view(page, "Scoring").tap();
  await expect(page).toHaveURL(/section=scoring/);
  const requests = harness.state.statsRequests.length;
  await page.evaluate(id => {
    const key = "ss:duke-visibility:v2", stored = JSON.parse(localStorage.getItem(key)) ?? { version: 2, rules: [{ from: 0, mode: "away" }], manual: {}, remembered: {}, waiting: {} };
    const value = JSON.stringify({ ...stored, manual: { [id]: true } });
    localStorage.setItem(key, value); dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }, DUKE.id);
  await expect(screen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  await expect(screen(page)).not.toContainText(/Duke|DUKE/);
  await expect(screen(page).locator(".masthead, .view-nav, table, .scoring-play")).toHaveCount(0);
  await page.clock.fastForward(61_000);
  expect(harness.state.statsRequests).toHaveLength(requests);
});

// The chosen three-button row at normal sizes; words stay whole and the row stacks only when a word can't fit.
for (const [width, height, zoom] of [[390, 844, false], [320, 740, false], [1280, 900, false], [393, 852, true]]) {
  test(`section buttons and scoring layout at ${width}×${height}${zoom ? " with actual 200% CSS zoom" : ""}`, async ({ page, harness }, info) => {
    serve(harness);
    harness.state.events = [matchup(OT, { state: "final", scores: [34, 35] })];
    await page.setViewportSize({ width, height });
    await harness.open();
    if (zoom) await page.addStyleTag({ content: "html { zoom: 2; }" });
    await cardLink(page, OT.id).tap();
    await view(page, "Scoring").tap();
    await expect(panel(page).locator(".scoring-play")).toHaveCount(12);
    const buttons = await sections(page);
    expect(buttons.map(b => b.name)).toEqual(["Team stats", "Scoring", "Player stats"]);
    for (const b of buttons) { expect(b.height).toBeGreaterThanOrEqual(44); expect(b.inside, `${b.name} label stays inside its button`).toBe(true); }
    const stacked = await screen(page).locator(".view-switch").evaluate(el => el.hasAttribute("data-stacked"));
    if (zoom) expect(stacked, "a whole word cannot fit three columns at 200%: the buttons stack").toBe(true);
    else { expect(stacked).toBe(false); expect(new Set(buttons.map(b => b.top)).size, "one row").toBe(1); }
    expect(await noOverflow(page)).toBe(true);
    const region = panel(page).getByRole("region", { name: "Score by quarter" });
    expect(await region.evaluate(el => getComputedStyle(el).overflowX)).toBe("auto");
    expect(await region.getAttribute("tabindex")).toBe("0");
    await page.screenshot({ path: info.outputPath(`scoring-ot-${width}x${height}${zoom ? "-zoom200" : ""}.png`), fullPage: true, animations: "disabled" });
    if (zoom) {
      // Undoing the zoom (no resize event) refits to one row.
      await page.evaluate(() => { for (const s of document.querySelectorAll("style")) if (s.textContent.includes("zoom: 2")) s.remove(); });
      await expect.poll(() => screen(page).locator(".view-switch").evaluate(el => el.hasAttribute("data-stacked"))).toBe(false);
      expect(await noOverflow(page)).toBe(true);
    }
  });
}

// Hardware-keyboard scrolling of the quarter table, in desktop (non-touch) contexts, as for player tables.
test.describe("desktop hardware keyboard", () => {
  test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: async ({ browserName }, provide) => provide(devices[browserName === "webkit" ? "Desktop Safari" : "Desktop Chrome"].userAgent) });
  test("Tab reaches the quarter-table region and arrow keys scroll only it at 200% CSS zoom", async ({ page, harness, browserName }, info) => {
    serve(harness);
    harness.state.events = [matchup(OT, { state: "final", scores: [34, 35] })];
    await page.setViewportSize({ width: 393, height: 852 });
    await harness.open();
    await page.addStyleTag({ content: "html { zoom: 2; }" });
    await cardLink(page, OT.id).focus(); await page.keyboard.press("Enter");
    const scoring = view(page, "Scoring");
    await scoring.focus(); await page.keyboard.press("Space");
    await expect(scoring).toHaveAttribute("aria-pressed", "true");
    const region = panel(page).getByRole("region", { name: "Score by quarter" });
    for (let i = 0; i < 8 && !(await region.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(region).toBeFocused();
    const metrics = await region.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    await info.attach("quarter-table-metrics", { contentType: "application/json", body: JSON.stringify({ browserName, ...metrics }) });
    const pageX = await page.evaluate(() => scrollX);
    if (metrics.scroll > metrics.client) {
      let presses = 0;
      for (; presses < 3 && (await region.evaluate(el => el.scrollLeft)) <= 0; presses++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(600); }
      expect(await region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      console.log(`keyboard-scroll ${browserName} quarter table: ArrowRight presses to first scroll = ${presses}`);
    }
    expect(await page.evaluate(() => scrollX)).toBe(pageX);
    expect(await noOverflow(page)).toBe(true);
  });
});
