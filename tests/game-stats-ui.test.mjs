import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { game } from "./helpers.mjs";

// The view bundle imports this test's own React, so one instance renders it.
const shared = { name: "shared-react", setup(b) { b.onResolve({ filter: /^(?:react(?:\/jsx-runtime)?|lucide-react)$/ }, args => ({ path: import.meta.resolve(args.path), external: true })); } };
const output = await build({
  stdin: { contents: "export * from './components/game-stats.tsx'; export { normalizeGameStats } from './lib/game-stats.ts'; export { statsGeneration, rememberedStats, createStatsMemory, StatsController } from './lib/use-game-stats.ts';", resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "ts" },
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)), bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false, plugins: [shared],
});
const ui = { ...await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`), renderToStaticMarkup, createElement };
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-summary-${name}.json`, import.meta.url), "utf8"));
const CHECKED = "2026-10-10T19:18:05.000Z"; // 3:18:05 PM ET.

function card(name, changes = {}) {
  const raw = fixture(name), [away, home] = ["away", "home"].map(side => raw.header.competitions[0].competitors.find(c => c.homeAway === side));
  const g = game({ id: raw.header.id, ...changes });
  g.teams[0] = { ...g.teams[0], id: away.team.id, abbreviation: away.team.abbreviation, name: `${away.team.abbreviation} name` };
  g.teams[1] = { ...g.teams[1], id: home.team.id, abbreviation: home.team.abbreviation, name: `${home.team.abbreviation} name` };
  return { g, stats: ui.normalizeGameStats(raw, raw.header.id, CHECKED) };
}
const state = (expected, snapshot, extra = {}) => ({ mode: "active", expected, snapshot, pending: null, failure: null, retryAt: 0, ...extra });
// A state belongs to the rendered game's generation unless a test supplies another.
function render(g, s, { now = Date.parse(CHECKED) + 5000, online = true, section = "team" } = {}) {
  const bound = s && !("generation" in s) ? { ...s, generation: ui.statsGeneration(g) } : s;
  return ui.renderToStaticMarkup(ui.createElement(ui.GameStatsView, { game: g, state: bound, now, online, retry() {}, section }));
}
const liveRegions = html => [...html.matchAll(/role="status"[^>]*>(.*?)<\/div>/g)].map(m => text(m[1]).trim());
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
// Mirrored comparison rows: [stat, away, home], cell markup as rendered.
const teamRows = html => [...html.matchAll(/<tr><td class="c-away"[^>]*>(.*?)<\/td><th scope="row"[^>]*><span class="row-label">([^<]+).*?<\/th><td class="c-home"[^>]*>(.*?)<\/td><\/tr>/g)].map(m => [m[2], m[1], m[3]]);
const playerRows = html => (html.match(/<tr(?: class="team-entry")?><th scope="row">/g) || []).length;

test("the screen's stats wrapper starts with a finite polite loading state; queued work says waiting", () => {
  const { g } = card("final", { state: "final" });
  const html = ui.renderToStaticMarkup(ui.createElement(ui.GameStatsScreen, { game: g, section: "team", onSection() {} }));
  assert.match(html, /role="status"><p>Loading team stats…<\/p>/);
  assert.match(render(g, state("final", null, { pending: "waiting" })), /Waiting to load team stats…/);
});

test("Team stats is the default: caption, real headers, fixed away/home order and all 15 metrics continuous", () => {
  const { g, stats } = card("final", { state: "final" });
  const html = render(g, state("final", stats));
  assert.match(html, /<button type="button" data-focus-key="view-team" aria-controls="panel-team" aria-pressed="true">Team stats<\/button><button type="button" data-focus-key="view-scoring" aria-controls="panel-scoring" aria-pressed="false">Scoring<\/button><button type="button" data-focus-key="view-players" aria-controls="panel-players" aria-pressed="false">Player stats<\/button>/);
  assert.match(html, /<section class="panel" id="panel-scoring" aria-label="Scoring" hidden=""><\/section>/);
  assert.match(html, /<h2 id="team-h" tabindex="-1">Team stats<\/h2><span class="stats-phase">Final<\/span>/);
  assert.match(html, /<caption class="sr-only">Team stats · IU name, away; NEB name, home<\/caption>/);
  assert.match(html, /<th scope="col" id="cmp-core-away" class="c-away"><span>IU<\/span><small>away<\/small><span class="sr-only"> · IU name<\/span><\/th><th scope="col" class="c-label">Team stat<\/th><th scope="col" id="cmp-core-home" class="c-home"><span>NEB<\/span><small>home<\/small>/);
  assert.match(html, /Stats checked at 3:18:05 PM ET/);
  assert.match(html, /Source reports Final/);
  const rows = teamRows(html);
  assert.deepEqual(rows.slice(0, 8), [["Total yards", "328", "391"], ["Passing yards", "263", "263"], ["Rushing yards", "65", "128"], ["First downs", "13", "25"], ["Third-down conversions", "1-10", "10-19"], ["Turnovers", "0", "1"], ["Penalties / yards", "3-35", "7-59"], ["Time of possession", "20:27", "39:33"]]);
  assert.equal(rows.length, 15, "all 15 game metrics, with no accordion");
  assert.deepEqual(rows.slice(8).map(r => r[0]), ["Fourth-down conversions", "Completions / attempts", "Yards per pass", "Rush attempts", "Yards per rush", "Interceptions thrown", "Fumbles lost"]);
  assert.match(html, /<h3 class="group-title">Headline stats<\/h3>.*<h3 class="group-title">Attempts, efficiency and ball security<\/h3>/);
  // Each value names its row and column headers explicitly.
  assert.match(html, /<td class="c-away" headers="cmp-core-totalYards cmp-core-away">328<\/td><th scope="row" id="cmp-core-totalYards"/);
  assert.doesNotMatch(html, /<summary|<details|aria-expanded/);
  // Neutral, decorative share bars only on the three plain yardage rows; no winner or leader highlighting.
  assert.equal((html.match(/<span class="share" aria-hidden="true">/g) || []).length, 3);
  assert.match(html, /Total yards<\/span><span class="share" aria-hidden="true"><span style="flex-grow:328"><\/span><span style="flex-grow:391"><\/span><\/span>/);
  assert.doesNotMatch(html, /leader|winner/);
  // The player document is a separate section; the handoff leads there.
  assert.match(html, /<section class="panel" id="panel-players" aria-label="Player stats" hidden=""><\/section>/);
  assert.match(html, /data-focus-key="to-players"><span>Player stats<\/span><small>Passing · rushing · receiving<\/small>/);
  assert.match(html, /0-0 means no attempts; it is not a calculated percentage/);
});

test("Player stats: one continuous document with every participant, legends and contained keyboard-scrollable tables", () => {
  const { g, stats } = card("live", { state: "live" });
  const team = render(g, state("started", stats));
  assert.deepEqual(teamRows(team).find(r => r[0] === "Fourth-down conversions"), ["Fourth-down conversions", "1-1", "0-0"]);
  const html = render(g, state("started", stats), { section: "players" });
  assert.match(html, /aria-pressed="true">Player stats<\/button>/);
  assert.match(html, /<div class="jump-links" role="group" aria-label="Jump to player category"><button type="button" data-jump="passing" data-focus-key="jump-passing" aria-current="true">Passing<\/button><button type="button" data-jump="rushing" data-focus-key="jump-rushing">Rushing<\/button>/);
  assert.match(html, /<section class="panel" id="panel-team" aria-label="Team stats" hidden=""><\/section>/);
  assert.match(html, /<h2 id="players-h" tabindex="-1">Player stats<\/h2><span class="stats-phase">This game<\/span>/);
  for (const name of ["passing", "rushing", "receiving"]) {
    assert.match(html, new RegExp(`class="player-table-wrap" role="region" aria-label="TEX name ${name} statistics" tabindex="0"`));
    assert.match(html, new RegExp(`aria-label="OU name ${name} statistics" tabindex="0"`));
    assert.match(html, new RegExp(`<section class="category" id="cat-${name}" data-category="${name}" aria-labelledby="cat-${name}-h">`));
  }
  assert.match(html, /<abbr title="completions\/attempts">C\/A<\/abbr>/);
  assert.match(html, /C\/A: completions\/attempts · YDS: yards · TD: touchdowns · INT: interceptions/);
  const supplied = fixture("live").boxscore.players.flatMap(t => t.statistics).reduce((n, c) => n + c.athletes.length, 0);
  assert.equal(playerRows(html), supplied, "every participant row renders: no ranking, top-N or Show all");
  assert.doesNotMatch(html, /Show all|Show more/);
  assert.match(html, /<tr(?: class="team-entry")?><th scope="row">Team<\/th><td>1<\/td><td>-1<\/td>/);
  assert.match(html, /<tr class="team-entry"><th scope="row">/, "source team-attributed rows are marked");
  assert.match(html, /“Team” is a team-attributed entry from the source/);
  assert.match(html, /Source reports 3:48 - 3rd/);
  assert.equal(teamRows(html).length, 0, "the team comparison is not repeated in Player stats");
});

test("pregame: season averages labeled per game, existing-only line boundary, no player data or zero-filled totals", () => {
  const { g, stats } = card("pregame", { state: "upcoming", started: false });
  const html = render(g, state("pregame", stats));
  assert.match(html, /<h2 id="team-h" tabindex="-1">Season averages<\/h2><span class="stats-phase">Pregame<\/span>/);
  assert.equal((html.match(/<span class="stat-unit">per game<\/span>/g) || []).length, 8);
  assert.equal(teamRows(html).length, 8);
  assert.deepEqual(teamRows(html)[0], ["Points scored", "43.6", "34.6"]);
  assert.match(html, /<th scope="col" class="c-label">Season average<\/th>/);
  assert.match(html, /Season averages supplied before kickoff. These are not game totals./);
  assert.doesNotMatch(html, /player-table|Source reports|class="share"|data-focus-key="to-players"/);
  const players = render(g, state("pregame", stats), { section: "players" });
  assert.match(players, /Player stats start after kickoff/);
  assert.doesNotMatch(players, /player-table|per game|Source reports/);
  for (const out of [html, players]) assert.doesNotMatch(text(out), /\b(?:spread|over\/under|moneyline|odds|bet|betting|ATS|win probability|sportsbook)\b/i);
});

test("started scoreboard with season-only source: catching up, averages removed", () => {
  const { g, stats } = card("pregame", { state: "live", started: true });
  for (const section of ["team", "players"]) {
    const html = render(g, state("started", stats), { section });
    assert.match(html, /Stats catching up/);
    assert.match(html, /Game stats are not available yet/);
    assert.doesNotMatch(html, /compare-table|per game|player-table/);
  }
});

test("live gate: enabled live games render game stats; the off path still shows a static message with no spinner; exceptional states are status-first", () => {
  const { g, stats } = card("live", { state: "live" });
  const live = render(g, state("started", stats));
  assert.match(live, /<h2 id="team-h" tabindex="-1">Team stats<\/h2><span class="stats-phase">This game<\/span>/);
  assert.match(live, /Source reports 3:48 - 3rd/);
  assert.deepEqual(teamRows(live)[0], ["Total yards", "235", "142"]);
  assert.match(render(g, null), /Loading team stats…/, "enabled: the first open loads");
  for (const section of ["team", "players"]) {
    const html = render(g, state("started", null, { mode: "disabled" }), { section });
    assert.match(html, /Live stats are not available yet/); assert.match(html, /Stats for games in progress are not shown here\. The score and game details are still available\./);
    assert.doesNotMatch(html, /Gamecast/);
    assert.doesNotMatch(html, /Loading|skeleton/);
  }
  const postponed = render(card("final", { state: "other", status: "Postponed", started: false }).g, null);
  assert.match(postponed, /<h2>Postponed<\/h2><p>This game is reported as postponed\. Stats are not shown for this status\.<\/p>/);
  assert.doesNotMatch(postponed, /Gamecast/);
  assert.doesNotMatch(postponed, /view-nav|Team stats|Player stats|Loading/, "status-first: no sections or stats work");
  assert.match(render(card("final", { state: "other", status: "Forfeit" }).g, null), /A played final is not implied/);
  assert.match(render(card("final", { state: "other", status: "Canceled" }).g, null), /will not be played as scheduled/);
});

test("failure, stale age, offline and partial states stay explicit and keep valid sections", () => {
  const { g, stats } = card("final", { state: "final" });
  const error = render(g, state("final", null, { failure: "upstream" }));
  assert.match(error, /Stats could not be loaded/); assert.match(error, /<button type="button" data-focus-key="stats-retry">.*Retry<\/button>/);
  // During backoff the control is disabled with an honest wait, not an immediate retry.
  const waiting = render(g, state("final", null, { failure: "busy", retryAt: Date.parse(CHECKED) + 5000 + 272_000 }));
  assert.match(waiting, /<button type="button" data-focus-key="stats-retry" disabled="">.*Retry in 5m<\/button>/);
  assert.match(render(g, state("final", null, { failure: "busy", retryAt: Date.parse(CHECKED) + 5000 + 42_000 })), /Retry in 42s/);
  // Failed refresh keeps the old snapshot with its retrieval age and an explicit warning, in both sections.
  for (const section of ["team", "players"]) {
    const stale = render(g, state("final", stats, { failure: "network" }), { now: Date.parse(CHECKED) + 4 * 60_000, section });
    assert.match(stale, /Stats may be out of date/); assert.match(stale, /checked 4 minutes ago/);
    assert.match(stale, section === "team" ? /Total yards/ : /player-table/);
    assert.match(render(g, state("final", stats), { online: false, section }), /Offline · saved stats/);
    assert.match(render(g, state("final", null), { online: false, section }), /You’re offline/);
  }
  // Past TTL without failure: subtle factual age and a manual check, no failure wording.
  const aged = render(g, state("final", stats), { now: Date.parse(CHECKED) + 6 * 60_000 });
  assert.match(aged, /class="stats-age">Checked 6m ago/); assert.match(aged, /Check again/);
  assert.doesNotMatch(aged, /out of date|failed/i);
  // Started TTL (15s) passes at an expected 30s poll gap: factual age, no warning.
  const live = card("live", { state: "live" });
  assert.match(render(live.g, state("started", live.stats), { now: Date.parse(CHECKED) + 22_000 }), /Checked 22s ago/);
  // Missing values show a dash; supplied zeros remain zero.
  const partialRaw = fixture("final"); partialRaw.boxscore.teams[0].statistics = partialRaw.boxscore.teams[0].statistics.filter(s => s.name !== "firstDowns");
  const partial = render(g, state("final", ui.normalizeGameStats(partialRaw, "401858481", CHECKED)));
  assert.deepEqual(teamRows(partial).find(r => r[0] === "First downs"), ["First downs", '<span class="stat-missing" aria-label="Unavailable">—</span>', "25"]);
  assert.deepEqual(teamRows(partial).find(r => r[0] === "Turnovers"), ["Turnovers", "0", "1"]);
  assert.match(partial, /Supplied zeros remain zero/);
  // A missing yardage value never gets a share bar.
  const noBar = fixture("final"); noBar.boxscore.teams[0].statistics = noBar.boxscore.teams[0].statistics.filter(s => s.name !== "totalYards");
  assert.doesNotMatch(render(g, state("final", ui.normalizeGameStats(noBar, "401858481", CHECKED))), /Total yards<\/span><span class="share"/);
  // A misaligned category keeps its identifiable participants with unavailable values and a note.
  const playersRaw = fixture("final"), receiving = playersRaw.boxscore.players[1].statistics.find(c => c.name === "receiving"); receiving.labels.reverse();
  const misaligned = ui.normalizeGameStats(playersRaw, "401858481", CHECKED);
  const players = render(g, state("final", misaligned), { section: "players" });
  assert.match(players, /aria-label="NEB name receiving statistics"/);
  for (const athlete of receiving.athletes) assert.match(players, new RegExp(`<th scope="row">${athlete.athlete.displayName}</th><td><span class="stat-missing"`));
  assert.match(players, /These receiving values could not be matched to their columns/);
  assert.match(players, /NEB name passing statistics/);
  assert.match(render(g, state("final", misaligned)), /Total yards/, "team stats stay available");
  assert.match(players, /All participants supplied for these categories are shown/);
  // Whole Players too large: explicit, team data intact.
  const big = { ...stats, players: { unavailable: "too-large" } };
  const tooLarge = render(g, state("final", big), { section: "players" });
  assert.match(tooLarge, /too large to show here\. Team stats remain available\./); assert.doesNotMatch(tooLarge, /Gamecast/);
  const missingPlayers = render(g, state("final", { ...stats, players: { unavailable: "missing" } }), { section: "players" });
  assert.match(missingPlayers, /Player stats were not supplied for this game\. Team stats remain available\./); assert.doesNotMatch(missingPlayers, /Gamecast/);
  assert.match(render(g, state("final", big)), /Total yards/);
  // Team stats unavailable: the players remain reachable.
  const noTeam = render(g, state("final", { ...stats, team: { unavailable: "identity" } }));
  assert.match(noTeam, /Team stats unavailable/); assert.match(noTeam, /Player stats remain available/); assert.match(noTeam, /data-focus-key="notice-players">View player stats/);
  // No data at all.
  const empty = render(g, state("final", { ...stats, team: { unavailable: "missing" }, players: { unavailable: "missing" } }));
  assert.match(empty, /No stats available yet<\/h3><p>The source has not supplied stats for this game yet\.<\/p>/); assert.doesNotMatch(empty, /Gamecast/);
});

test("paused play keeps game totals with honest age and source status, without claiming when they were recorded", () => {
  // Retrieved before the pause and 13 minutes old.
  const { g, stats } = card("live", { state: "delayed", started: true });
  const html = render(g, state("started", stats), { now: Date.parse(CHECKED) + 13 * 60_000 });
  assert.match(html, /Play is paused/); assert.match(html, /Stats checked 13 minutes ago/); assert.match(html, /Total yards/);
  // SYNTHETIC: a suspended summary retrieved after the pause is described the same truthful way.
  const raw = fixture("live"); raw.header.competitions[0].status = { period: 3, displayClock: "3:48", type: { name: "STATUS_SUSPENDED", state: "in", completed: false, shortDetail: "Suspended" } };
  const after = render(g, state("started", ui.normalizeGameStats(raw, raw.header.id, CHECKED)), { now: Date.parse(CHECKED) + 4000 });
  assert.match(after, /Source reports Suspended/); assert.match(after, /Stats checked 4 seconds ago/);
  for (const out of [html, after]) assert.doesNotMatch(out, /before play paused|Recorded before/i);
});

test("live regions announce stable state only: age and countdown text never tick inside them", () => {
  const { g, stats } = card("final", { state: "final" });
  for (const [label, s, options] of [["failed", state("final", stats, { failure: "network" }), {}], ["offline", state("final", stats), { online: false }], ["paused", state("started", card("live").stats), {}], ["error-wait", state("final", null, { failure: "busy", retryAt: Date.parse(CHECKED) + 400_000 }), {}]]) {
    const screenGame = label === "paused" ? card("live", { state: "delayed", started: true }).g : g;
    const ages = [10_000, 15_000, 65_000, 4 * 60_000].map(ms => render(screenGame, s, { ...options, now: Date.parse(CHECKED) + ms }));
    const regions = ages.map(liveRegions);
    if (label !== "paused") assert.ok(regions[0].length > 0, `${label} announces its state`);
    for (const r of regions) assert.deepEqual(r, regions[0], label);
    assert.ok(regions[0].every(t => !/\d+\s*(?:s|m|seconds?|minutes?)\b|ago/.test(t)), `${label}: ${regions[0]}`);
    // The visible age/countdown does change, outside the live region.
    assert.notEqual(text(ages[0]), text(ages[3]), label);
  }
});

test("Players footer only claims completeness when every category is listed", () => {
  const { g } = card("final", { state: "final" });
  const over = fixture("final"); over.boxscore.players[0].statistics.find(c => c.name === "receiving").athletes = Array.from({ length: 257 }, (_, i) => ({ athlete: { id: String(500 + i), displayName: `P${i}` }, stats: ["1", "2", "2.0", "0", "2"] }));
  const overflowStats = ui.normalizeGameStats(over, "401858481", CHECKED);
  const overflow = render(g, state("final", overflowStats), { section: "players" });
  assert.match(overflow, /IU name receiving unavailable/);
  assert.doesNotMatch(overflow, /All participants supplied for these categories are shown/);
  assert.match(overflow, /Categories marked unavailable are not shown/);
  assert.match(overflow, /IU name passing statistics/); assert.match(render(g, state("final", overflowStats)), /Total yards/);
  const anon = fixture("final"); delete anon.boxscore.players[1].statistics.find(c => c.name === "rushing").athletes[0].athlete.id;
  const malformed = render(g, state("final", ui.normalizeGameStats(anon, "401858481", CHECKED)), { section: "players" });
  assert.match(malformed, /NEB name rushing unavailable/);
  assert.doesNotMatch(malformed, /All participants supplied for these categories are shown/);
});

test("rendered state is bound to the game's full generation and identity", () => {
  const { g, stats } = card("final", { state: "final" });
  // A same-phase date or matchup change before the hook updates must not show the old snapshot.
  for (const changed of [{ ...g, date: "2026-10-11T00:00Z" }, { ...g, teams: [g.teams[1], g.teams[0]] }]) {
    for (const section of ["team", "players"]) {
      const html = render(changed, { ...state("final", stats), generation: ui.statsGeneration(g) }, { section });
      assert.doesNotMatch(html, /Total yards|player-table/); assert.match(html, /Loading team stats…/);
    }
  }
  // A snapshot whose identity disagrees is never shown, even under a matching generation.
  assert.doesNotMatch(render(g, state("final", { ...stats, teamIds: ["158", "84"] })), /Total yards/);
  assert.doesNotMatch(render(g, state("final", { ...stats, eventId: "401858482" })), /Total yards/);
  assert.doesNotMatch(render(g, state("final", { ...stats, eventId: "401858482" }), { section: "players" }), /player-table/);
});

// Scoring (issue #149). COMPOSED: a scoring fixture's genuine header and scoringPlays joined to the
// existing genuine boxscore fixture for the same event; header-only where no boxscore fixture exists.
const scoringFixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-summary-scoring-${name}.json`, import.meta.url), "utf8"));
function composed(name, boxscore) {
  const scoring = scoringFixture(name);
  return boxscore ? { ...fixture(boxscore), header: scoring.header, scoringPlays: scoring.scoringPlays } : scoring;
}
function scoringCard(raw, changes) {
  const [away, home] = ["away", "home"].map(side => raw.header.competitions[0].competitors.find(c => c.homeAway === side));
  const g = game({ id: raw.header.id, ...changes });
  g.teams[0] = { ...g.teams[0], id: away.team.id, abbreviation: away.team.abbreviation, name: away.team.displayName };
  g.teams[1] = { ...g.teams[1], id: home.team.id, abbreviation: home.team.abbreviation, name: home.team.displayName };
  return { g, stats: ui.normalizeGameStats(raw, raw.header.id, CHECKED) };
}
const periodRows = html => [...html.matchAll(/<tr><th scope="row" class="scoring-team"><span>([^<]+)<\/span>.*?<\/th>(.*?)<\/tr>/g)].map(m => [m[1], ...[...m[2].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(c => text(c[1]).trim())]);
const plays = html => [...html.matchAll(/<li class="scoring-play">(.*?)<\/li>/g)].map(m => text(m[1].replace(/<span class="sr-only">.*?<\/span>/g, "")).trim());

test("Scoring section: COMPOSED live game shows supplied quarters only and the source's plays in order with running scores", () => {
  const { g, stats } = scoringCard(composed("live", "live"), { state: "live" });
  const html = render(g, state("started", stats), { section: "scoring" });
  assert.match(html, /aria-pressed="false">Team stats<\/button><button type="button" data-focus-key="view-scoring" aria-controls="panel-scoring" aria-pressed="true">Scoring<\/button>/);
  assert.match(html, /<section class="panel" id="panel-team" aria-label="Team stats" hidden=""><\/section>/);
  assert.match(html, /<h2 id="scoring-h" tabindex="-1">Scoring<\/h2><span class="stats-phase">This game<\/span>/);
  // Shared retrieval time and source status, then scores by quarter.
  assert.match(html, /Stats checked at 3:18:05 PM ET.*Source reports 3:48 - 3rd.*Score by quarter/);
  // Live in the 3rd: three supplied quarters, no future Q4 column; real zeros stay zero.
  assert.match(html, /<abbr title="1st quarter">Q1<\/abbr><\/th><th scope="col"><abbr title="2nd quarter">Q2<\/abbr><\/th><th scope="col"><abbr title="3rd quarter">Q3<\/abbr><\/th><th scope="col" class="scoring-total">/);
  assert.doesNotMatch(html, /Q4/);
  assert.deepEqual(periodRows(html), [["TEX", "7", "10", "0", "17"], ["OU", "0", "7", "3", "10"]]);
  assert.match(html, /Score after each play: TEX–OU/);
  assert.deepEqual(plays(html), [
    "Q1 6:56 TEX Passing Touchdown A. Manning pass to C. Coleman for 41 yds, for a TD (G. Spetic KICK) 7 – 0",
    "Q2 14:11 OU Blocked Punt Touchdown Punt blocked by D. Okoye, recovered by D. Fields for a TD (T. Sandell KICK) 7 – 7",
    "Q2 10:09 TEX Passing Touchdown A. Manning pass to R. Wingo for 34 yds, for a TD (G. Spetic KICK) 14 – 7",
    "Q2 0:12 TEX Field Goal Good G. Spetic 23 yd FG GOOD 17 – 7",
    "Q3 10:56 OU Field Goal Good T. Sandell 53 yd FG GOOD 17 – 10",
  ]);
  assert.match(html, /Score after this play: Texas Longhorns 17, Oklahoma Sooners 10/);
  // Complete, consistent source data carries no caveats and no completeness claim.
  assert.doesNotMatch(html, /incomplete|don’t add up|don’t fully match|isn’t shown|aren’t shown|unavailable|All scoring plays|complete list/i);
  assert.doesNotMatch(html, /compare-table|player-table/);
  assert.doesNotMatch(text(html), /\b(?:spread|odds|bet|betting|win probability)\b/i);
});

test("Scoring section: genuine Final/OT keeps the fifth period, supplied zeros and two OT 0:00 plays in source order; Team stats stays independent", () => {
  const { g, stats } = scoringCard(composed("final-ot"), { state: "final" });
  const html = render(g, state("final", stats), { section: "scoring" });
  assert.match(html, /<abbr title="Overtime">OT<\/abbr>/);
  assert.deepEqual(periodRows(html), [["LSU", "10", "7", "3", "7", "7", "34"], ["UK", "7", "14", "0", "6", "8", "35"]]);
  const list = plays(html);
  assert.equal(list.length, 12);
  assert.deepEqual(list.slice(-2), ["OT 0:00 LSU Rushing Touchdown Sam Leavitt 15 Yd Run (Scott Starzyk Kick) 34 – 27", "OT 0:00 UK Rushing Touchdown CJ Baxter 1 Yd Run (Kenny Minchey Run for Two-Point Conversion) 34 – 35"]);
  // No inferred touchdown or conversion points anywhere.
  assert.doesNotMatch(html, /\+6|\+7|\+8|\bPAT\b/);
  // This header-only source has no boxscore: Team stats says so, and scoring is unaffected.
  assert.match(render(g, state("final", stats)), /No stats available yet/);
  assert.doesNotMatch(html, /No stats available yet/);
});

test("Scoring section: pregame waits for kickoff; a started source without scoring, a behind source and an oversized summary are explicit", () => {
  const pre = scoringCard(scoringFixture("pregame"), { state: "upcoming", started: false });
  const pregame = render(pre.g, state("pregame", pre.stats), { section: "scoring" });
  assert.match(pregame, /Scoring starts after kickoff/);
  assert.doesNotMatch(pregame, /scoring-periods|scoring-play|Source reports/);
  assert.equal(pre.stats.scoring, undefined, "a pregame source carries no scoring");
  // An older Worker (no scoring key) or a source that supplies none.
  const { g, stats } = card("live", { state: "live" });
  assert.equal(stats.scoring, undefined);
  const legacy = render(g, state("started", stats), { section: "scoring" });
  assert.match(legacy, /Scoring unavailable/); assert.match(legacy, /Scoring isn’t available for this game\. Team stats and Player stats remain available\./);
  assert.match(legacy, /Source reports 3:48 - 3rd/);
  // The scoreboard has started but the source still reports pregame: catching up, not "no scoring".
  const behind = card("pregame", { state: "live", started: true });
  const catching = render(behind.g, state("started", behind.stats), { section: "scoring" });
  assert.match(catching, /Scoring catching up/); assert.match(catching, /still reporting pregame information/);
  assert.doesNotMatch(catching, /Stats catching up|scoring-periods/);
  const live = scoringCard(composed("live", "live"), { state: "live" });
  const big = render(live.g, state("started", { ...live.stats, scoring: { unavailable: "too-large" } }), { section: "scoring" });
  assert.match(big, /The scoring summary is too large to show here\. Team stats and Player stats remain available\./);
});

test("Scoring survives empty Team stats; failure and offline notices are shared; nothing renders for another game", () => {
  const raw = composed("live", "live"); raw.boxscore = {};
  const { g, stats } = scoringCard(raw, { state: "live" });
  assert.match(render(g, state("started", stats)), /No stats available yet/);
  const html = render(g, state("started", stats), { section: "scoring" });
  assert.equal(plays(html).length, 5);
  const stale = render(g, state("started", stats, { failure: "network" }), { section: "scoring", now: Date.parse(CHECKED) + 4 * 60_000 });
  assert.match(stale, /Stats may be out of date/); assert.match(stale, /checked 4 minutes ago/); assert.equal(plays(stale).length, 5);
  assert.match(render(g, state("started", stats), { section: "scoring", online: false }), /Offline · saved stats/);
  assert.match(render(g, state("started", null), { section: "scoring", online: false }), /You’re offline/);
  assert.match(render(g, state("started", null)), /Loading team stats…/);
  assert.match(render(g, state("started", null), { section: "scoring" }), /Loading scoring…/);
  assert.match(render(g, state("started", null, { failure: "upstream" }), { section: "scoring" }), /Stats could not be loaded/);
  // Identity disagreement: no scoring either.
  assert.equal(plays(render(g, state("started", { ...stats, teamIds: [stats.teamIds[1], stats.teamIds[0]] }), { section: "scoring" })).length, 0);
});

test("SYNTHETIC partial scoring: unequal quarters get the whole-table warning, unknown teams are omitted, missing fields show a dash", () => {
  const raw = composed("live", "live"), competitors = raw.header.competitions[0].competitors;
  competitors.find(c => c.homeAway === "home").linescores.pop();
  delete raw.scoringPlays[1].clock;
  delete raw.scoringPlays[4].homeScore;
  raw.scoringPlays.splice(2, 0, { ...raw.scoringPlays[2], id: "999", team: { id: "999" } });
  const { g, stats } = scoringCard(raw, { state: "live" });
  const html = render(g, state("started", stats), { section: "scoring" });
  assert.deepEqual(periodRows(html), [["TEX", "7", "10", "0", "17"], ["OU", "0", "7", "—", "10"]]);
  assert.match(html, /Quarter scores are incomplete and may not align correctly\./);
  assert.equal(plays(html).length, 5);
  assert.match(plays(html)[1], /^Q2 — OU /);
  assert.match(plays(html)[4], /17 – —$/);
  assert.match(html, /1 supplied scoring play isn’t shown because its details couldn’t be matched to this game\./);
  assert.match(html, /— means this value is unavailable\. Supplied zeros remain zero\./);
  // The unmatched copy is not attributed to either team: its text appears once.
  assert.equal(plays(html).filter(p => p.includes("pass to R. Wingo")).length, 1);
  // The shared legend follows any rendered dash: one missing play field with a complete table is enough;
  // an unavailable list with a complete table shows none. Every unavailable reason except order reads the same.
  const live = scoringCard(composed("live", "live"), { state: "live" }), complete = live.stats.scoring;
  const oneMissing = { ...complete, plays: { items: complete.plays.items.map((p, i) => i === 2 ? { ...p, clock: null } : p) } };
  assert.match(render(live.g, state("started", { ...live.stats, scoring: oneMissing }), { section: "scoring" }), /— means this value is unavailable/);
  for (const reason of ["too-many", "missing", "malformed"]) {
    const out = render(live.g, state("started", { ...live.stats, scoring: { ...complete, plays: { unavailable: reason } } }), { section: "scoring" });
    assert.match(out, /Scoring plays are unavailable for this game\./, reason);
    assert.doesNotMatch(out, /— means this value is unavailable|too many/, reason);
  }
  assert.match(render(live.g, state("started", { ...live.stats, scoring: { ...complete, plays: { unavailable: "order" } } }), { section: "scoring" }), /source’s order couldn’t be confirmed/);
});

test("a remounted screen's first paint shows the remembered failed-refresh warning and backoff wait", async () => {
  const { g, stats } = card("live", { state: "live", started: true });
  const memory = ui.createStatsMemory();
  let now = Date.parse(CHECKED), result = { kind: "ok", stats };
  const clock = { now: () => now, setTimeout: () => 1, clearTimeout() {} };
  const scheduler = { cancel() {}, enqueue(owner, run, settle) { run(now + 8000, new AbortController().signal).then(settle); } };
  const first = new ui.StatsController("first", scheduler, async () => result, clock, memory, true);
  first.update({ game: g, expanded: true, visible: true, online: true }); await new Promise(setImmediate);
  now += 1000; result = { kind: "failed", reason: "network" }; first.retry(); await new Promise(setImmediate);
  first.dispose();
  // Live → suspended: a remount's first paint is seeded from memory.
  const paused = { ...g, state: "delayed" }, seeded = ui.rememberedStats(paused, memory, true);
  assert.equal(seeded.failure, "network"); assert.equal(seeded.snapshot, stats);
  const html = render(paused, seeded, { now: now + 2000 });
  assert.match(html, /Stats may be out of date/);
  assert.match(html, /Retry in 58s/);
  assert.match(html, /data-focus-key="stats-retry"/, "stats controls exist in the first paint for focus");
  // A different generation is never seeded.
  assert.equal(ui.rememberedStats({ ...g, date: "2026-10-11T00:00Z" }, memory, true), null);
  assert.equal(ui.rememberedStats({ ...g, state: "other" }, memory, true), null);
});
