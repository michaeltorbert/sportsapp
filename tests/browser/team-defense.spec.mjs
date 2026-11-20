// #181 Defensive leaders, browser. GENUINE Nov 20 GT rows (tests/fixtures/team-defense-source.json) are
// SYNTHETICALLY relabeled onto the existing genuine Texas team-season fixture (team 251) so the real page,
// gates and navigation run offline. Every API is intercepted before the Worker; this is not hosted proof.
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.mjs";
import { bundle } from "../helpers.mjs";

const S = await bundle("lib/player-season-server.ts");
const F = JSON.parse(readFileSync(new URL("../fixtures/team-defense-source.json", import.meta.url), "utf8"));
const TEXAS_BASE = JSON.parse(readFileSync(new URL("../fixtures/espn-team-season-texas-2026-normalized.json", import.meta.url), "utf8"));
const TEAM = { id: "251", name: "Texas" }, DUKE_GAME = "401858255", CHECKED = "2026-11-20T17:57:45.000Z";
const swap = v => v === "Georgia Tech" ? "Texas" : v === 59 ? 251 : v;
const relabel = rows => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ["team", "homeTeam", "awayTeam", "homeId", "awayId"].includes(k) ? swap(v) : v])));
const boxes = F.boxes["59"].map(b => ({ ...b, teams: b.teams.map(t => ({ ...t, team: swap(t.team) })) }));
const pack = (dropDuke = false) => S.createPlayerPack(TEAM, 2026, relabel(F.stats["59"]), relabel(F.games["59"]).filter(g => !dropDuke || String(g.id) !== DUKE_GAME), boxes, CHECKED);
const NAMES = ["Tae Harris", "Taje Mccoy", "Noah Carter", "Kealan Jones", "Trae Stevenson Jr.", "C.J. Gamble"];
// Rendered order: tackles, then sacks and interceptions ties by name.
const LINKS = ["Tae Harris", "Noah Carter", "Taje Mccoy", "C.J. Gamble", "Kealan Jones", "Trae Stevenson Jr."];
const CUE = "Stats: CFBD. Totals may differ from school reports. Source update time unknown.";
const teamScreen = page => page.locator(".team-screen:not(.player-screen)");
const playerScreen = page => page.locator(".player-screen");
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
async function verifyFixtureMute(page) {
  expect(await page.evaluate(() => { const audio = document.createElement("audio"); document.body.append(audio); audio.dispatchEvent(new Event("loadstart", { bubbles: true })); const muted = audio.muted; audio.remove(); return muted; })).toBe(true);
}
function serve(harness, { dropDuke = true } = {}) {
  const p = pack(dropDuke), body = JSON.stringify(S.teamDefenseFromPack(p, false));
  harness.state.team = (_url, route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(TEXAS_BASE) });
  harness.state.defense = (_url, route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body });
  harness.state.player = (url, route) => {
    const id = url.searchParams.get("id");
    return p.people[id] ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(S.playerFromPack(p, id, null, false, [], 2026, "251")) }) : route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  };
}
for (const [width, zoom] of [[320, false], [390, false], [390, true]]) {
  test(`every tied defensive leader is a full-name link at ${width}px${zoom ? " and 200% zoom" : ""}`, async ({ page, harness }, info) => {
    serve(harness);
    await page.setViewportSize({ width, height: 900 });
    await harness.open({ path: "/?team=251", waitForScores: false });
    await verifyFixtureMute(page);
    if (zoom) await page.addStyleTag({ content: "html { zoom: 2; }" });
    const block = teamScreen(page).locator(".team-defense");
    await expect(block.locator(".team-defense-category")).toHaveText(["Total tackles", "Sacks", "Interceptions"]);
    await expect(block.locator(".team-defense-row dd strong")).toHaveText(["63", "3", "1"]);
    await expect(block.locator("a")).toHaveText(LINKS);
    await expect(block.locator(".team-defense-tie")).toHaveText(["Tied · 2 players", "Tied · 3 players"]);
    await expect(block).toContainText("35 solo");
    await expect(block.locator(".team-defense-source")).toHaveText(CUE);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: info.outputPath(`defense-${width}${zoom ? "-zoom200" : ""}.png`), fullPage: true, animations: "disabled" });
    expect([...new Set(harness.state.defenseRequests)]).toEqual(["?team=251&year=2026"]);
    expect(harness.state.playerRequests, "no identity prefetch at render").toEqual([]);
  });
}
for (const [width, zoom] of [[320, false], [390, false], [390, true]]) test(`a tied leader opens the matching profile; cue sits under totals before the game log; Back returns at ${width}px${zoom ? " and 200% zoom" : ""}`, async ({ page, harness }, info) => {
  serve(harness);
  await page.setViewportSize({ width, height: 900 });
  await harness.open({ path: "/?team=251", waitForScores: false });
  await verifyFixtureMute(page);
  if (zoom) await page.addStyleTag({ content: "html { zoom: 2; }" });
  await teamScreen(page).locator(".team-defense a", { hasText: "C.J. Gamble" }).click();
  await expect(playerScreen(page).locator(".player-title")).toHaveText("C.J. Gamble");
  const totals = playerScreen(page).locator('[aria-labelledby="player-totals-h"]');
  await expect(totals.locator(".player-category h3")).toHaveText(["Defense", "Interceptions"]);
  await expect(totals.locator(".player-metrics dt")).toHaveText(["Total tackles", "Solo tackles", "Interceptions made", "Interception return yards", "Interception return touchdowns"]);
  await expect(totals.locator(".player-metrics dd")).toHaveText(["5", "2", "1", "1", "0"]);
  await expect(totals.locator(".player-defense-source")).toHaveText(CUE);
  const cue = await totals.locator(".player-defense-source").boundingBox(), log = await playerScreen(page).locator("#player-log-h").boundingBox();
  expect(cue.y).toBeLessThan(log.y);
  expect(await playerScreen(page).textContent()).not.toMatch(/Passes defended|QB hurries|Assisted/);
  expect(await noOverflow(page)).toBe(true);
  // Profile pixels (SYNTHETIC relabel of genuine GT rows onto Texas; not hosted proof).
  await page.screenshot({ path: info.outputPath(`defense-profile-${width}${zoom ? "-zoom200" : ""}.png`), fullPage: true, animations: "disabled" });
  await playerScreen(page).locator(".back-button").click();
  await expect(teamScreen(page).locator(".team-defense a")).toHaveText(LINKS);
  await page.reload();
  await expect(teamScreen(page).locator(".team-defense a")).toHaveText(LINKS);
});
// PV3-01: a delayed failed revisit (team → schedule game → Back) keeps the defense section's layout steady.
test("Back to a team whose defense failed keeps the failure layout while the reload is pending", async ({ page, harness }) => {
  serve(harness);
  let calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  harness.state.defense = async (_url, route) => {
    calls++;
    if (calls >= 2) await held;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "simulated" }) });
  };
  await page.setViewportSize({ width: 390, height: 900 });
  await harness.open({ path: "/?team=251", waitForScores: false });
  await verifyFixtureMute(page);
  const block = teamScreen(page).locator(".team-defense");
  await expect(block.getByRole("button", { name: "Retry" })).toBeEnabled();
  const before = await block.boundingBox();
  await teamScreen(page).locator("a.sched-row").first().click();
  await page.getByRole("button", { name: "Back to Texas schedule" }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(block).toContainText("Defensive leaders couldn’t be loaded.");
  await expect(block.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  await expect(block).not.toContainText("Loading defensive leaders");
  const pending = await block.boundingBox();
  release();
  await expect(block.getByRole("button", { name: "Retry" })).toBeEnabled();
  const after = await block.boundingBox();
  expect(Math.abs(pending.height - before.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - pending.height)).toBeLessThanOrEqual(1);
});
test("the pack's own hidden Duke contribution withholds every new name, number and tie from DOM and accessibility", async ({ page, harness }) => {
  serve(harness, { dropDuke: false });
  await page.setViewportSize({ width: 320, height: 900 });
  await harness.open({ path: "/?team=251", waitForScores: false });
  await verifyFixtureMute(page);
  await page.evaluate(id => {
    const key = "ss:duke-visibility:v2", stored = JSON.parse(localStorage.getItem(key)) ?? { version: 2, rules: [{ from: 0, mode: "away" }], manual: {}, remembered: {}, waiting: {} };
    const value = JSON.stringify({ ...stored, manual: { ...stored.manual, [id]: true } });
    localStorage.setItem(key, value); dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }, DUKE_GAME);
  await expect(teamScreen(page).locator(".team-defense-status")).toContainText("Defensive leaders are hidden");
  const leak = new RegExp([...NAMES, "Tied ·", "35 solo", "Defense checked"].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
  expect(await teamScreen(page).textContent()).not.toMatch(leak);
  expect(await teamScreen(page).ariaSnapshot()).not.toMatch(leak);
  await expect(teamScreen(page).locator(".team-defense a")).toHaveCount(0);
});
// PV2-01: a load restarted by reconnecting owns its own pending state (local fixtures only; requests held).
test("reconnect: the restarted team-defense load is pending until it settles, then shows leaders", async ({ page, harness }) => {
  serve(harness);
  const body = JSON.stringify(S.teamDefenseFromPack(pack(true), false));
  let calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  harness.state.defense = async (_url, route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "simulated" }) });
    await held;
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body });
  };
  await page.setViewportSize({ width: 390, height: 900 });
  await harness.open({ path: "/?team=251", waitForScores: false });
  await verifyFixtureMute(page);
  const status = teamScreen(page).locator(".team-defense-status");
  await expect(status).toContainText("Defensive leaders couldn’t be loaded.");
  await page.context().setOffline(true);
  await expect(status.getByRole("button", { name: "Retry" })).toBeDisabled();
  await page.context().setOffline(false);
  await expect.poll(() => calls).toBe(2);
  // Known failure stays in force while the restarted load is pending (PV3-01): Retry disabled as "Retrying…", no identities.
  await expect(status).toContainText("Defensive leaders couldn’t be loaded.");
  await expect(status.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  await expect(teamScreen(page).locator(".team-defense a")).toHaveCount(0);
  release();
  await expect(teamScreen(page).locator(".team-defense a")).toHaveText(LINKS);
  await expect(teamScreen(page).locator(".team-defense-status")).toHaveCount(0);
});
test("reconnect: the restarted profile load is pending (Retry disabled) until it settles, data retained", async ({ page, harness }) => {
  serve(harness);
  const p = pack(true);
  let calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  harness.state.player = async (_url, route) => {
    calls++;
    if (calls >= 2) await held;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(S.playerFromPack(p, "5222695", null, false, [], 2026, "251")) });
  };
  await page.setViewportSize({ width: 390, height: 900 });
  await harness.open({ path: "/?team=251", waitForScores: false });
  await verifyFixtureMute(page);
  await teamScreen(page).locator(".team-defense a", { hasText: "C.J. Gamble" }).click();
  await expect(playerScreen(page).locator(".player-title")).toHaveText("C.J. Gamble");
  // Identity is null in this fixture, so the existing "Previous seasons" notice offers Retry (disabled while pending).
  const retry = playerScreen(page).getByRole("button", { name: "Retry" });
  await expect(retry).toBeEnabled();
  await page.context().setOffline(true);
  await expect(retry).toBeDisabled();
  await page.context().setOffline(false);
  await expect.poll(() => calls).toBe(2);
  await expect(retry).toBeDisabled();
  await expect(playerScreen(page).locator('[aria-labelledby="player-totals-h"] .player-metrics dd')).toHaveText(["5", "2", "1", "1", "0"]);
  release();
  await expect(retry).toBeEnabled();
  await expect(playerScreen(page).locator(".player-title")).toHaveText("C.J. Gamble");
});
test("default intercepted outage is honest and never reaches the Worker or a provider", async ({ page, harness }) => {
  harness.state.team = (_url, route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TEXAS_BASE) });
  await page.setViewportSize({ width: 390, height: 900 });
  await harness.open({ path: "/?team=251", waitForScores: false });
  await verifyFixtureMute(page);
  await expect(teamScreen(page).locator(".team-defense-status")).toContainText("Defensive leaders couldn’t be loaded.");
  expect(harness.state.defenseRequests.length).toBeGreaterThan(0);
  expect(harness.state.unexpectedExternal).toEqual([]);
});
