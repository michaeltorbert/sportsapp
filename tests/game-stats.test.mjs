import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { bundle, game } from "./helpers.mjs";
const stats = await bundle("lib/game-stats.ts");
const { normalizeGameStats, parseGameStats, statsDisplay, expectedPhase, snapshotBytes, STATS_MAX_BYTES, LIVE_STATS_ENABLED, DIRECT_STATS_FALLBACK } = stats;

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-summary-${name}.json`, import.meta.url), "utf8"));
const CHECKED = "2026-10-10T20:40:00.000Z";
const normalize = (raw, id = raw.header.id) => normalizeGameStats(raw, id, CHECKED);
const category = (snapshot, side, name) => snapshot.players.teams[side].categories[name];
const passingOf = (raw, teamIndex = 0) => raw.boxscore.players[teamIndex].statistics.find(s => s.name === "passing");

test("fixtures match their recorded provenance and contain no betting, media or person metadata", () => {
  const provenance = JSON.parse(readFileSync(new URL("./fixtures/espn-summary-provenance.json", import.meta.url), "utf8"));
  for (const [file, entry] of Object.entries(provenance.fixtures)) {
    const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(text).digest("hex"), entry.fixtureSha256, file);
    assert.match(entry.captureSha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(text.toString(), /pickcenter|odds|againstTheSpread|predictor|winprobability|headshot|jersey|guid/i, file);
  }
});

test("genuine final capture: teams map by ID despite header home-first and boxscore away-first order", () => {
  const raw = fixture("final"), s = normalize(raw);
  assert.equal(raw.header.competitions[0].competitors[0].homeAway, "home");
  assert.equal(raw.boxscore.teams[0].homeAway, "away");
  assert.deepEqual(s.teamIds, ["84", "158"]);
  assert.equal(s.sourcePhase, "final");
  assert.equal(s.team.kind, "game");
  assert.deepEqual(s.team.rows.totalYards, ["328", "391"]);
  // displayValue composites are preserved even though their raw `value` is "-".
  assert.deepEqual(s.team.rows.totalPenaltiesYards, ["3-35", "7-59"]);
  assert.deepEqual(s.team.rows.completionAttempts, ["12/22", "25/44"]);
  assert.deepEqual(s.team.rows.possessionTime, ["20:27", "39:33"]);
  // Real zeros stay zero.
  assert.deepEqual(s.team.rows.turnovers, ["0", "1"]);
  assert.equal(s.checkedAt, CHECKED);
  assert.equal(s.sourceStatus.detail, "Final");
  // Six keys, six labels: passing maps; the negative team-attributed row is kept with its source name.
  const passing = category(s, 1, "passing");
  assert.deepEqual(passing.rows.map(r => [r.athleteId, r.name, r.values]), [
    [passing.rows[0].athleteId, passing.rows[0].name, { "C/ATT": "25/43", YDS: "263", TD: "0", INT: "1" }],
    ["-6842", "Team", { "C/ATT": "0/1", YDS: "0", TD: "0", INT: "0" }],
  ]);
  assert.deepEqual(statsDisplay(s, "final"), { mode: "stats", kind: "game" });
  assert.ok(parseGameStats(JSON.parse(JSON.stringify(s))));
});

test("genuine live capture: 6 keys / 5 labels passing is accepted only through the trailing adjQBR rule", () => {
  const raw = fixture("live"), passing = passingOf(raw);
  assert.equal(passing.keys.length, 6); assert.equal(passing.labels.length, 5); assert.equal(passing.keys.at(-1), "adjQBR");
  const s = normalize(raw);
  assert.equal(s.sourcePhase, "started");
  assert.deepEqual(s.sourceStatus, { state: "in", name: "STATUS_IN_PROGRESS", detail: "3:48 - 3rd", period: 3, displayClock: "3:48" });
  assert.deepEqual(s.teamIds, ["251", "201"]);
  // 0-0 is real data, never a calculated rate.
  assert.deepEqual(s.team.rows.fourthDownEff, ["1-1", "0-0"]);
  assert.deepEqual(category(s, 0, "passing").rows[0].values, { "C/ATT": "11/18", YDS: "156", TD: "2", INT: "0" });
  // Negative yardage is legitimate.
  const rushing = category(s, 0, "rushing").rows;
  assert.ok(rushing.some(r => r.values.YDS === "-2"));
  assert.ok(category(s, 1, "rushing").rows.some(r => r.athleteId === "-7026" && r.name === "Team"));
  // All supplied participants: no truncation.
  assert.equal(category(s, 1, "receiving").rows.length, raw.boxscore.players[1].statistics.find(c => c.name === "receiving").athletes.length);
  assert.deepEqual(statsDisplay(s, "started"), { mode: "stats", kind: "game" });
});

test("genuine pregame capture: season family, per-game rows, no players section", () => {
  const s = normalize(fixture("pregame"));
  assert.equal(s.sourcePhase, "pregame");
  assert.equal(s.team.kind, "season");
  assert.deepEqual(Object.keys(s.team.rows), ["totalPointsPerGame", "totalPointsPerGameAllowed", "yardsPerGame", "yardsPerGameAllowed", "passingYardsPerGame", "passingYardsPerGameAllowed", "rushingYardsPerGame", "rushingYardsPerGameAllowed"]);
  assert.deepEqual(s.team.rows.yardsPerGame, ["547.8", "416.8"]);
  assert.deepEqual(s.players, { unavailable: "missing" });
  assert.deepEqual(statsDisplay(s, "pregame"), { mode: "stats", kind: "season" });
  // Once the scoreboard has started, season averages are never shown as game totals.
  assert.deepEqual(statsDisplay(s, "started"), { mode: "catching-up", reason: "season-only" });
  assert.deepEqual(statsDisplay(s, "final"), { mode: "catching-up", reason: "season-only" });
});

test("SYNTHETIC: a started source still supplying season metrics is never relabeled", () => {
  const raw = fixture("pregame");
  raw.header.competitions[0].status = { period: 1, displayClock: "14:10", type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "14:10 - 1st" } };
  const s = normalize(raw);
  assert.equal(s.sourcePhase, "started"); assert.equal(s.team.kind, "season");
  assert.deepEqual(statsDisplay(s, "started"), { mode: "catching-up", reason: "season-only" });
  // A game-family response on a pregame scoreboard is also a mismatch, never shown as season data.
  const live = normalize(fixture("live"));
  assert.equal(statsDisplay(live, "pregame").mode, "catching-up");
});

test("SYNTHETIC halftime/overtime/delay/suspension/exceptional statuses map to source phases", () => {
  const cases = [
    [{ period: 2, displayClock: "0:00", type: { name: "STATUS_HALFTIME", state: "in", completed: false, shortDetail: "Halftime" } }, "started"],
    [{ period: 5, displayClock: "0:00", type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "OT" } }, "started"],
    [{ period: 0, type: { name: "STATUS_DELAYED", state: "pre", completed: false, shortDetail: "Delayed" } }, "pregame"],
    [{ period: 3, type: { name: "STATUS_SUSPENDED", state: "in", completed: false, shortDetail: "Suspended" } }, "started"],
    [{ period: 5, type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final/OT" } }, "final"],
    [{ type: { name: "STATUS_POSTPONED", state: "post", completed: false, shortDetail: "Postponed" } }, "other"],
    [{ type: { name: "STATUS_FORFEIT", state: "post", completed: true, shortDetail: "Forfeit" } }, "other"],
  ];
  for (const [status, phase] of cases) {
    const raw = fixture("live"); raw.header.competitions[0].status = status;
    assert.equal(normalize(raw).sourcePhase, phase, status.type.name);
  }
  assert.equal(expectedPhase({ state: "other", started: false }), null);
  assert.equal(expectedPhase({ state: "delayed", started: true }), "started");
  assert.equal(expectedPhase({ state: "delayed", started: false }), "pregame");
  assert.equal(expectedPhase({ state: "live", started: true, halftime: true }), "started");
  assert.equal(expectedPhase({ state: "final", started: true }), "final");
  assert.equal(expectedPhase({ state: "upcoming", started: false }), "pregame");
});

test("event or team identity mismatch is rejected; a date-only source difference is not", () => {
  assert.throws(() => normalize(fixture("final"), "401858482"));
  const swapped = fixture("final");
  swapped.header.competitions[0].competitors.forEach(c => { c.homeAway = c.homeAway === "home" ? "away" : "home"; });
  // The header still names a matchup; the reversed sides are what the client compares.
  assert.deepEqual(normalize(swapped).teamIds, ["158", "84"]);
  const missing = fixture("final"); delete missing.header.competitions[0].competitors[0].team.id;
  assert.throws(() => normalize(missing));
  const date = fixture("final"); date.header.competitions[0].date = "2026-10-10T16:00:30Z";
  assert.equal(normalize(date).sourceDate, "2026-10-10T16:00:30Z");
});

test("a boxscore team without a trustworthy identity invalidates that section only", () => {
  const raw = fixture("final"); delete raw.boxscore.teams[1].team.id;
  const s = normalize(raw);
  assert.deepEqual(s.team, { unavailable: "identity" });
  assert.ok("teams" in s.players);
  assert.deepEqual(statsDisplay(s, "final"), { mode: "players-only" });
  const players = fixture("final"); players.boxscore.players[0].team.id = "999";
  const p = normalize(players);
  assert.deepEqual(p.players, { unavailable: "identity" });
  assert.equal(p.team.kind, "game");
  const side = fixture("final"); side.boxscore.teams[0].homeAway = "home";
  assert.deepEqual(normalize(side).team, { unavailable: "identity" });
});

test("reordered metrics and teams map by name/ID; missing is unavailable, not zero; malformed values are not shown", () => {
  const raw = fixture("final");
  raw.boxscore.teams.reverse(); raw.boxscore.teams.forEach(t => t.statistics.reverse());
  raw.boxscore.teams[0].statistics = raw.boxscore.teams[0].statistics.filter(s => s.name !== "firstDowns");
  raw.boxscore.teams[1].statistics.find(s => s.name === "rushingYards").displayValue = "<b>65</b>";
  const s = normalize(raw);
  assert.deepEqual(s.team.rows.totalYards, ["328", "391"]);
  assert.deepEqual(s.team.rows.firstDowns, ["13", null]);
  assert.deepEqual(s.team.rows.rushingYards, [null, "128"]);
  const json = JSON.stringify(s);
  assert.doesNotMatch(json, /<b>/);
});

test("a mixed metric family makes the team section unavailable rather than guessed", () => {
  const raw = fixture("final");
  raw.boxscore.teams[1].statistics.push({ name: "yardsPerGame", displayValue: "400.1" });
  assert.deepEqual(normalize(raw).team, { unavailable: "mixed" });
  const unknown = fixture("final");
  unknown.boxscore.teams.forEach(t => { t.statistics = [{ name: "somethingNew", displayValue: "5" }]; });
  assert.deepEqual(normalize(unknown).team, { unavailable: "missing" });
});

test("SYNTHETIC alignment: dropped middle value, reordered keys, extra stats and non-adjQBR trailing keys", () => {
  // An unconfirmed alignment keeps identifiable participants listed with every value unavailable.
  const unaligned = (raw, side, name, source = raw.boxscore.players[side].statistics.find(c => c.name === name)) => {
    const result = category(normalize(raw), side, name);
    assert.equal(result.unaligned, true);
    assert.deepEqual(result.rows.map(row => row.athleteId), source.athletes.map(a => a.athlete.id));
    assert.ok(result.rows.every(row => Object.values(row.values).every(value => value === null)));
  };
  // Dropped middle label/value: never shift columns. Team stats and other categories survive.
  const dropped = fixture("final"), p = passingOf(dropped);
  p.labels.splice(2, 1); p.descriptions.splice(2, 1); p.athletes.forEach(a => a.stats.splice(2, 1));
  let s = normalize(dropped);
  unaligned(dropped, 0, "passing");
  assert.ok("rows" in category(s, 0, "rushing")); assert.ok("rows" in category(s, 1, "passing")); assert.equal(s.team.kind, "game");
  // Consistently reordered keys/labels/values remain mappable by key and confirming label.
  const reordered = fixture("final"), q = passingOf(reordered), order = [1, 0, 2, 4, 3, 5];
  for (const field of ["keys", "labels", "descriptions"]) q[field] = order.map(i => q[field][i]);
  q.athletes.forEach(a => { a.stats = order.map(i => a.stats[i]); });
  s = normalize(reordered);
  assert.deepEqual(category(s, 0, "passing").rows[0].values, { "C/ATT": "12/22", YDS: "263", TD: "2", INT: "0" });
  // Keys reordered without their labels: label check fails.
  const keysOnly = fixture("final"), k = passingOf(keysOnly); [k.keys[1], k.keys[3]] = [k.keys[3], k.keys[1]];
  unaligned(keysOnly, 0, "passing");
  // More labels than keys, or a trailing omission other than adjQBR.
  const extra = fixture("final"), e = passingOf(extra); e.labels.push("X"); e.descriptions.push("x");
  unaligned(extra, 0, "passing");
  const rushing = fixture("final"), r = rushing.boxscore.players[0].statistics.find(c => c.name === "rushing");
  r.labels.pop(); r.descriptions.pop(); r.athletes.forEach(a => a.stats.pop());
  unaligned(rushing, 0, "rushing");
  // Descriptions present with the wrong length.
  const desc = fixture("final"); passingOf(desc).descriptions.pop();
  unaligned(desc, 0, "passing");
  // Non-string or duplicate keys are equally unconfirmed.
  const dup = fixture("final"); passingOf(dup).keys[1] = passingOf(dup).keys[0];
  unaligned(dup, 0, "passing");
  // The contract validator accepts the unaligned marker and nothing else on a category.
  assert.ok(parseGameStats(JSON.parse(JSON.stringify(normalize(dup)))));
});

test("SYNTHETIC malformed identifiable row stays listed with unavailable values; other rows are unaffected", () => {
  const raw = fixture("final"), receiving = raw.boxscore.players[1].statistics.find(c => c.name === "receiving");
  receiving.athletes[1].stats = receiving.athletes[1].stats.slice(0, 3);
  receiving.athletes[2].stats[1] = "lots";
  const rows = category(normalize(raw), 1, "receiving").rows;
  assert.equal(rows.length, receiving.athletes.length);
  assert.deepEqual(rows[1].values, { REC: null, YDS: null, TD: null });
  assert.deepEqual(rows[2].values, { REC: receiving.athletes[2].stats[0], YDS: null, TD: receiving.athletes[2].stats[3] });
  assert.equal(rows[0].values.YDS, receiving.athletes[0].stats[1]);
  // An unidentifiable row would silently shorten the list, so the category is unavailable.
  const anonymous = fixture("final"); delete anonymous.boxscore.players[1].statistics.find(c => c.name === "receiving").athletes[0].athlete.id;
  assert.deepEqual(category(normalize(anonymous), 1, "receiving"), { unavailable: "malformed" });
  // Over-long names are unavailable, never shortened.
  const long = fixture("final"); long.boxscore.players[0].statistics[0].athletes[0].athlete.displayName = "N".repeat(65);
  assert.equal(category(normalize(long), 0, "passing").rows[0].name, null);
});

test("bounds: >256 rows makes the category unavailable; an oversized Players section is omitted whole while team data survives", () => {
  const many = fixture("final"), rec = many.boxscore.players[0].statistics.find(c => c.name === "receiving");
  rec.athletes = Array.from({ length: 257 }, (_, i) => ({ athlete: { id: String(100 + i), displayName: `P${i}` }, stats: ["1", "2", "2.0", "0", "2"] }));
  let s = normalize(many);
  assert.deepEqual(category(s, 0, "receiving"), { unavailable: "too-many" });
  // 256 rows fit and are all kept.
  rec.athletes.pop(); s = normalize(many);
  assert.equal(category(s, 0, "receiving").rows.length, 256);
  const huge = fixture("final");
  for (const team of huge.boxscore.players) for (const c of team.statistics) c.athletes = Array.from({ length: 250 }, (_, i) => ({ athlete: { id: String(1e6 + i), displayName: `Participant with a long name ${i}` }, stats: c.athletes[0].stats }));
  s = normalize(huge);
  assert.deepEqual(s.players, { unavailable: "too-large" });
  assert.equal(s.team.kind, "game");
  assert.ok(snapshotBytes(s) <= STATS_MAX_BYTES);
});

test("betting boundary: injected odds, pickcenter, predictor, win probability and ATS never enter the contract", () => {
  const raw = fixture("final");
  Object.assign(raw, { odds: [{ spread: -3.5, overUnder: 51.5, moneyline: -150 }], pickcenter: [{ details: "IU -3.5", overUnder: 51.5 }], predictor: { homeTeam: { gameProjection: "60.1" } }, winprobability: [{ homeWinPercentage: 0.6 }], againstTheSpread: [{ records: [] }] });
  raw.header.competitions[0].odds = [{ spread: 3 }];
  raw.boxscore.teams[0].statistics.push({ name: "moneyline", displayValue: "-150" }, { name: "overUnder", displayValue: "51.5" });
  raw.boxscore.teams[0].odds = { spread: 1 };
  const s = normalize(raw), json = JSON.stringify(s);
  assert.doesNotMatch(json, /odds|pickcenter|predictor|winprob|againstTheSpread|moneyline|overUnder|51\.5|-150|spread/i);
  assert.deepEqual(Object.keys(s).sort(), ["checkedAt", "eventId", "players", "sourceDate", "sourcePhase", "sourceStatus", "team", "teamIds", "v"]);
  // The public validator rejects extra keys added after normalization.
  assert.equal(parseGameStats({ ...JSON.parse(json), odds: [] }), null);
  assert.equal(parseGameStats({ ...JSON.parse(json), team: { ...s.team, moneyline: 1 } }), null);
});

test("prototype-named provider fields are ignored without losing valid team stats", () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    const raw = fixture("final");
    raw.boxscore.teams.forEach(t => t.statistics.unshift({ name, displayValue: "7" }));
    const s = normalize(raw);
    assert.equal(s.team.kind, "game", name);
    assert.deepEqual(s.team.rows.totalYards, ["328", "391"], name);
    assert.equal(Object.hasOwn(s.team.rows, name), false, name);
    // Same for a pregame (season) source.
    const pre = fixture("pregame"); pre.boxscore.teams[0].statistics.push({ name, displayValue: "1" });
    assert.equal(normalize(pre).team.kind, "season", name);
  }
});

test("unsupported summaries: empty boxscore and unreadable status", () => {
  const empty = fixture("final"); empty.boxscore = {};
  const s = normalize(empty);
  assert.deepEqual([s.team, s.players], [{ unavailable: "missing" }, { unavailable: "missing" }]);
  assert.deepEqual(statsDisplay(s, "final"), { mode: "empty" });
  const status = fixture("final"); status.header.competitions[0].status = { type: { name: "STATUS_UNKNOWN", state: "??" } };
  assert.throws(() => normalize(status));
});

test("gates: live stats enabled on genuine-capture + actual probe evidence; direct fallback stays disabled", () => {
  assert.equal(LIVE_STATS_ENABLED, true);
  assert.equal(DIRECT_STATS_FALLBACK, false);
  assert.equal(expectedPhase(game({ state: "live" })), "started");
});
