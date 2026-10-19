import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./helpers.mjs";

// Minimized genuine public captures; see fixtures/team-season-provenance.json. Every variation
// below is constructed here and labeled SYNTHETIC.
const { scheduleSection, seasonStats, activeSeason, overallRecord } = await bundle("lib/team-season-server.ts");
const { seasonAggregates, parseTeamSeason, findScheduleGame, withBoardGames, TEAM_STAT_ROWS } = await bundle("lib/team-season.ts");
const { defaultDukePreferences, dukeHidden } = await bundle("lib/duke-visibility.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-team-season-${name}.json`, import.meta.url), "utf8"));
const DUKE = fixture("duke-2026"), UNC = fixture("unc-2026"), BOWL = fixture("postseason-2025");
const CHECKED = "2026-10-19T05:04:44.000Z";
const clone = value => structuredClone(value);
const SHARED = "401858266"; // Duke vs North Carolina, on both captured schedules.

test("the current Duke regular season: all 12 captured events, adapted and read by the existing scoreboard normalizer", () => {
  assert.deepEqual(activeSeason(DUKE.default, "150"), { year: 2026, type: 2 });
  assert.equal(overallRecord(DUKE.regular), "4-2");
  const section = scheduleSection(DUKE.regular, "150", 2026, 2, CHECKED);
  assert.equal(section.status, "complete");
  assert.equal(section.entries.length, 12);
  assert.equal(new Set(section.entries.map(e => e.game.id)).size, 12);
  const dates = section.entries.map(e => Date.parse(e.game.date));
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b), "chronological");
  for (const entry of section.entries) {
    const raw = DUKE.regular.events.find(e => e.id === entry.game.id), competition = raw.competitions[0];
    assert.equal(entry.seasonType, 2);
    assert.ok(entry.game.teams.some(t => t.id === "150"));
    // Sides, scores, TV and full opponent names come straight from the source event.
    for (const side of ["away", "home"]) {
      const source = competition.competitors.find(c => c.homeAway === side), team = entry.game.teams[side === "away" ? 0 : 1];
      assert.equal(team.id, source.team.id);
      assert.equal(team.score, source.score ? Number(source.score.displayValue) : null, `${entry.game.id} ${side} score`);
      if (source.team.id !== "150") assert.equal(entry.opponent.name, source.team.displayName);
    }
    assert.deepEqual(entry.game.broadcasts, [...new Set((competition.broadcasts ?? []).map(b => b.media.shortName))]);
    assert.equal(entry.game.timeValid, raw.timeValid !== false && competition.timeValid !== false);
    // No odds are invented for schedule games, so no line and no invalid-line evidence.
    assert.equal(entry.game.pregameLine, undefined);
    assert.notEqual(entry.game.pregameEvidenceInvalid, true);
  }
  const first = section.entries[0];
  assert.equal(first.game.id, "401858209");
  assert.equal(first.opponent.name, "Tulane Green Wave");
  assert.equal(first.game.state, "final");
  assert.equal(first.game.teams[1].id, "150"); assert.equal(first.game.teams[1].score, 17);
  // The captured unconfirmed kickoff keeps its placeholder midnight date and is never a kickoff time.
  const tbd = section.entries.filter(e => !e.game.timeValid);
  assert.ok(tbd.some(e => e.game.date.startsWith("2026-10-31T04:00")), JSON.stringify(tbd.map(e => e.game.date)));
  for (const e of tbd) assert.equal(e.game.state, "upcoming");
  // Four finals and two losses add up to the source record of 4-2.
  const finals = section.entries.filter(e => e.game.state === "final").map(e => { const own = e.game.teams.find(t => t.id === "150"), other = e.game.teams.find(t => t.id !== "150"); return own.score > other.score ? "W" : "L"; });
  assert.deepEqual([finals.filter(r => r === "W").length, finals.filter(r => r === "L").length], [4, 2]);
  assert.ok(section.entries.some(e => e.game.id === SHARED));
});

test("postseason: an empty current list is 'none listed'; the published 2025 bowl is read only as 2025 postseason", () => {
  assert.deepEqual(scheduleSection(DUKE.postseason, "150", 2026, 3, CHECKED), { status: "complete", entries: [] });
  const bowl = scheduleSection(BOWL, "150", 2025, 3, CHECKED);
  assert.equal(bowl.status, "complete");
  assert.equal(bowl.entries.length, 1);
  const [entry] = bowl.entries;
  assert.equal(entry.game.id, "401778329"); assert.equal(entry.seasonType, 3);
  assert.equal(entry.opponent.name, "Arizona State Sun Devils");
  assert.equal(entry.game.neutralSite, true); assert.deepEqual(entry.game.broadcasts, ["CBS"]); assert.equal(entry.game.state, "final");
  assert.equal(entry.game.teams.find(t => t.id === "9").score, 39);
  // Its active season metadata stays 2026 and its record is the current one, so neither is a 2025 claim.
  assert.equal(BOWL.season.year, 2026); assert.equal(overallRecord(BOWL), "4-2");
  // Never relabeled as the current postseason.
  assert.deepEqual(scheduleSection(BOWL, "150", 2026, 3, CHECKED), { status: "unavailable" });
  assert.deepEqual(scheduleSection(BOWL, "150", 2025, 2, CHECKED), { status: "unavailable" });
  // SYNTHETIC: the same events without a requested season cannot be attributed to any season.
  const unverified = clone(BOWL); delete unverified.requestedSeason;
  assert.deepEqual(scheduleSection(unverified, "150", 2025, 3, CHECKED), { status: "unavailable" });
});

test("any doubt about a schedule makes the whole section unavailable rather than silently shorter (SYNTHETIC variations)", () => {
  const variants = {
    wrongTeam: raw => { raw.team.id = "153"; },
    duplicate: raw => { raw.events.push(clone(raw.events[0])); },
    otherYear: raw => { raw.events[3].season.year = 2025; },
    otherType: raw => { raw.events[3].seasonType.type = 3; },
    missingTeam: raw => { for (const c of raw.events[2].competitions[0].competitors) if (c.team.id === "150") c.team.id = "999"; },
    oneSide: raw => { raw.events[2].competitions[0].competitors.pop(); },
    sameSides: raw => { const [a, b] = raw.events[2].competitions[0].competitors; b.homeAway = a.homeAway; },
    noStatus: raw => { delete raw.events[5].competitions[0].status; },
    badDate: raw => { raw.events[5].date = "soon"; raw.events[5].competitions[0].date = "soon"; },
    badId: raw => { raw.events[1].id = "<x>"; },
    noName: raw => { for (const c of raw.events[1].competitions[0].competitors) if (c.team.id !== "150") { delete c.team.displayName; delete c.team.shortDisplayName; } },
    otherRequested: raw => { raw.requestedSeason.year = 2025; },
    tooMany: raw => { raw.events = Array.from({ length: 31 }, (_, i) => ({ ...clone(raw.events[0]), id: String(401000000 + i) })); },
    notArray: raw => { raw.events = {}; },
  };
  for (const [name, change] of Object.entries(variants)) {
    const raw = clone(DUKE.regular); change(raw);
    assert.deepEqual(scheduleSection(raw, "150", 2026, 2, CHECKED), { status: "unavailable" }, name);
  }
  // Either level reporting an unconfirmed time wins.
  const raw = clone(DUKE.regular), event = raw.events.find(e => e.timeValid !== false);
  event.competitions[0].timeValid = false;
  assert.equal(scheduleSection(raw, "150", 2026, 2, CHECKED).entries.find(e => e.game.id === event.id).game.timeValid, false);
});

test("the four regular-season pairs are read by category and name for the team and the opponent list", () => {
  assert.deepEqual(seasonStats(DUKE.stats, "150", 2026), { points: ["31.7", "16.0"], totalYards: ["442.7", "292.7"], passingYards: ["233.2", "200.2"], rushingYards: ["209.5", "92.5"] });
  assert.deepEqual(TEAM_STAT_ROWS.map(r => r[1]), ["Points", "Total yards", "Passing yards", "Rushing yards"]);
  // Total yards is passing plus rushing in the captured values.
  assert.equal((233.2 + 209.5).toFixed(1), "442.7"); assert.equal((200.2 + 92.5).toFixed(1), "292.7");
  const unc = seasonStats(UNC.stats, "153", 2026);
  for (const [key, pair] of Object.entries(unc)) for (const value of pair) assert.match(value, /^-?\d{1,5}(?:\.\d{1,2})?$/, key);
  // Identity: another team's or another season's statistics are never used.
  assert.equal(seasonStats(DUKE.stats, "153", 2026), null);
  assert.equal(seasonStats(DUKE.stats, "150", 2025), null);
  const post = clone(DUKE.stats); post.requestedSeason.type = 3;
  assert.equal(seasonStats(post, "150", 2026), null);
  const unrequested = clone(DUKE.stats); delete unrequested.requestedSeason;
  assert.equal(seasonStats(unrequested, "150", 2026), null);
});

test("a missing or malformed value is unavailable, never zero; zero and signed values survive (SYNTHETIC values)", () => {
  const stat = (raw, list, category, name) => (list === "team" ? raw.results.stats.categories : raw.results.opponent).find(c => c.name === category).stats.filter(s => s.name === name);
  const raw = clone(DUKE.stats);
  stat(raw, "opponent", "rushing", "rushingYardsPerGame").forEach(s => { s.displayValue = "0"; });
  for (const s of stat(raw, "team", "scoring", "totalPointsPerGame")) s.displayValue = "-1.5";
  raw.results.stats.categories.find(c => c.name === "passing").stats = raw.results.stats.categories.find(c => c.name === "passing").stats.filter(s => s.name !== "passingYardsPerGame");
  stat(raw, "opponent", "passing", "yardsPerGame").forEach(s => { s.displayValue = "1,234"; });
  const rows = seasonStats(raw, "150", 2026);
  assert.deepEqual(rows.rushingYards, ["209.5", "0"]);
  assert.deepEqual(rows.points, ["-1.5", "16.0"]);
  assert.deepEqual(rows.passingYards, [null, "200.2"]);
  assert.deepEqual(rows.totalYards, ["442.7", null]);
  // The same name repeated with a different value is ambiguous.
  const conflict = clone(DUKE.stats);
  conflict.results.stats.categories.find(c => c.name === "rushing").stats.push({ name: "rushingYardsPerGame", displayValue: "1.0" });
  assert.equal(seasonStats(conflict, "150", 2026).rushingYards[0], null);
  const empty = clone(DUKE.stats); empty.results = {};
  assert.equal(seasonStats(empty, "150", 2026), null);
});

test("UNC: a non-Duke team reads the same way and shares the Duke event", () => {
  assert.deepEqual(activeSeason(UNC.schedule, "153"), { year: 2026, type: 2 });
  const section = scheduleSection(UNC.schedule, "153", 2026, 2, CHECKED);
  assert.equal(section.status, "complete");
  const shared = section.entries.find(e => e.game.id === SHARED);
  assert.equal(shared.opponent.id, "150");
  assert.equal(shared.opponent.name, "Duke Blue Devils");
  assert.throws(() => activeSeason(UNC.schedule, "150"), /identity/);
});

function season({ team = "150", regular, postseason = { status: "complete", entries: [] }, stats = null } = {}) {
  return { v: 1, team: { id: team, name: team === "150" ? "Duke Blue Devils" : "North Carolina Tar Heels", shortName: team === "150" ? "Duke" : "North Carolina", abbreviation: team === "150" ? "DUKE" : "UNC", logo: null }, season: { year: 2026 }, record: "4-2", stats, regular, postseason, checkedAt: CHECKED };
}
const prefs = (changes = {}) => ({ ...defaultDukePreferences(), ...changes });

test("aggregates are withheld exactly when a protected started Duke game, or unknown coverage, could reveal a result", () => {
  const duke = season({ regular: scheduleSection(DUKE.regular, "150", 2026, 2, CHECKED) });
  const finalId = duke.regular.entries.find(e => e.game.state === "final").game.id;
  const upcomingId = duke.regular.entries.find(e => e.game.state === "upcoming").game.id;
  // The default setting shows finals, so the complete page is fully useful.
  assert.deepEqual(seasonAggregates(duke, prefs()), { shown: true });
  assert.deepEqual(seasonAggregates(duke, prefs({ manual: { [finalId]: true } })), { shown: false, reason: "hidden" });
  // A hidden game that hasn't started contributes nothing yet.
  assert.deepEqual(seasonAggregates(duke, prefs({ manual: { [upcomingId]: true } })), { shown: true });
  assert.deepEqual(seasonAggregates(duke, prefs({ rules: [{ from: 0, mode: "hide" }] })), { shown: false, reason: "hidden" });
  // Before preferences load, Duke games count as protected, as on the scoreboard.
  assert.deepEqual(seasonAggregates(duke, null), { shown: false, reason: "checking" });
  assert.deepEqual(seasonAggregates({ ...duke, postseason: { status: "unavailable" } }, prefs()), { shown: false, reason: "incomplete" });
  assert.deepEqual(seasonAggregates({ ...duke, regular: { status: "unavailable" } }, prefs()), { shown: false, reason: "incomplete" });
});

test("the opponent's page withholds too when its schedule contains a protected started Duke game (SYNTHETIC states)", () => {
  const unc = season({ team: "153", regular: scheduleSection(UNC.schedule, "153", 2026, 2, CHECKED) });
  const at = state => { const copy = clone(unc); const entry = copy.regular.entries.find(e => e.game.id === SHARED); Object.assign(entry.game, state); return copy; };
  const hide = prefs({ manual: { [SHARED]: true } });
  assert.deepEqual(seasonAggregates(at({ state: "final", started: true }), hide), { shown: false, reason: "hidden" });
  // A live 0-0 game at period 0 counts as under way through the existing helper.
  assert.deepEqual(seasonAggregates(at({ state: "live", started: false, period: 0 }), hide), { shown: false, reason: "hidden" });
  assert.deepEqual(seasonAggregates(at({ state: "upcoming", started: false, period: 0 }), hide), { shown: true });
  assert.deepEqual(seasonAggregates(at({ state: "final", started: true }), prefs()), { shown: true });
  // The row itself is protected by the same rule; non-Duke games never are, even before preferences load.
  const nonDuke = unc.regular.entries.find(e => !e.game.teams.some(t => t.id === "150")).game;
  assert.equal(dukeHidden(nonDuke, null), false);
});

test("the scoreboard's fresher copy replaces a schedule game only for the same matchup, and protection follows it (SYNTHETIC board copies)", () => {
  const duke = season({ regular: scheduleSection(DUKE.regular, "150", 2026, 2, CHECKED) });
  const upcoming = duke.regular.entries.find(e => e.game.state === "upcoming" && e.game.teams[0].id === "150").game;
  const live = { ...clone(upcoming), state: "live", started: true, period: 2, neutralSite: false, teams: upcoming.teams.map(t => ({ ...t, score: 7 })) };
  const merged = withBoardGames(duke, [live]);
  assert.equal(findScheduleGame(merged, upcoming.id).game.state, "live");
  assert.equal(findScheduleGame(merged, upcoming.id).opponent.name, findScheduleGame(duke, upcoming.id).opponent.name);
  // The default setting hides an away Duke game in play: the board copy decides, not the older schedule copy.
  assert.equal(dukeHidden(findScheduleGame(duke, upcoming.id).game, prefs()), false);
  assert.equal(dukeHidden(findScheduleGame(merged, upcoming.id).game, prefs()), true);
  assert.deepEqual(seasonAggregates(merged, prefs()), { shown: false, reason: "hidden" });
  // A different matchup under the same event id is not the same game.
  const swapped = { ...live, teams: [live.teams[1], live.teams[0]] };
  assert.equal(findScheduleGame(withBoardGames(duke, [swapped]), upcoming.id).game.state, "upcoming");
  assert.deepEqual(withBoardGames({ ...duke, postseason: { status: "unavailable" } }, [live]).postseason, { status: "unavailable" });
});

test("schedule rows use the existing rule on the source's own state only: no prediction from the clock", () => {
  const entries = scheduleSection(DUKE.regular, "150", 2026, 2, CHECKED).entries;
  const away = entries.find(e => e.game.id === "401858271").game;
  assert.deepEqual([away.state, away.teams[0].id, away.date.startsWith("2026-10-23T23:00")], ["upcoming", "150", true]);
  // Upcoming away games stay visible under the default whatever the time, including unconfirmed (TBD) kickoffs.
  for (const e of entries.filter(e => e.game.state === "upcoming")) assert.equal(dukeHidden(e.game, prefs()), false, e.game.id);
  // Only an actual in-play state from the source (or the fresher board) protects it.
  assert.equal(dukeHidden({ ...away, state: "live", started: true }, prefs()), true);
  assert.equal(dukeHidden(away, null), true);
  assert.equal(dukeHidden(away, prefs({ rules: [{ from: 0, mode: "show" }] })), false);
});

test("the browser validates a team-season response for the requested team only", () => {
  const value = season({ regular: scheduleSection(DUKE.regular, "150", 2026, 2, CHECKED), stats: seasonStats(DUKE.stats, "150", 2026) });
  const body = JSON.parse(JSON.stringify(value));
  const parsed = parseTeamSeason(body, "150");
  assert.equal(parsed.regular.entries.length, 12);
  assert.equal(findScheduleGame(parsed, "401858209").opponent.name, "Tulane Green Wave");
  assert.equal(findScheduleGame(parsed, "999999999"), null);
  assert.equal(parseTeamSeason(body, "153"), null);
  const bad = [
    b => { b.v = 2; }, b => { b.stats.points[0] = "0x1"; }, b => { b.record = "four-two"; },
    b => { b.regular.entries[0].seasonType = 3; }, b => { b.postseason = { status: "complete", entries: [b.regular.entries[0]] }; },
    b => { b.regular.entries[0].game.teams[0].id = "1"; b.regular.entries[0].game.teams[1].id = "2"; },
    b => { b.regular.entries[0].opponent.id = "150"; }, b => { b.checkedAt = "yesterday"; }, b => { b.regular.entries[0].game.state = "halftime"; },
  ];
  for (const [i, change] of bad.entries()) { const copy = clone(body); change(copy); assert.equal(parseTeamSeason(copy, "150"), null, String(i)); }
  // A logo outside the image host is dropped, never trusted.
  const logo = clone(body); logo.team.logo = "https://example.com/x.png";
  assert.equal(parseTeamSeason(logo, "150").team.logo, null);
});
