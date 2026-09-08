import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { classify, sortGames, accWeek, easternDate, gameDay, retainFinalCategories } = await bundle("lib/football.ts");
const { normalizeScoreboard, scoreboardCdnUrl, scoreboardUrl } = await bundle("lib/espn-data.ts");

test("one-score classification includes ties and eight points in every live quarter", () => {
  for (const period of [1, 2, 3, 4, 5]) for (const margin of [0, 8, 9]) {
    const g = game({ period }); g.teams[1].score = g.teams[0].score + margin;
    assert.equal(classify(g).close, margin <= 8);
  }
  for (const state of ["upcoming", "delayed", "other"]) assert.equal(classify(game({ state })).close, false);
});
test("ACC and Top 25 include either team; upset requires the ranked favorite to trail", () => {
  const g = game(); g.teams[0].conferenceId = "1"; g.teams[0].rank = 7;
  assert.equal(classify(g).acc, true); assert.equal(classify(g).top25, true); assert.equal(classify(g).upset, true);
  g.teams[1].rank = null; assert.equal(classify(g).upset, true);
  g.teams[1].rankKnown = false; assert.equal(classify(g).upset, false);
  g.teams[1].rankKnown = true; g.teams[1].score = 14; assert.equal(classify(g).upset, false);
  g.teams[0].rank = null; assert.equal(classify(g).top25, false);
});
test("live games combine interest and drama, use stable finish bands, and keep finals last", () => {
  const g = (id, acc, ranked, period, margin, clock, state = "live") => {
    const x = game({ id, period, clock, state }); x.teams[0].conferenceId = acc ? "1" : "2"; x.teams[0].score = 0; x.teams[1].score = margin; x.teams[1].rank = ranked ? 5 : null; return x;
  };
  const games = [g("other", false, false, 5, 0, 0), g("ranked", false, true, 4, 0, 0), g("acc-q3", true, false, 3, 0, 0), g("acc-big", true, false, 4, 21, 0), g("acc-clock", true, false, 4, 7, 120), g("acc-first", true, false, 4, 7, 10), g("final", true, true, 5, 0, 0, "final"), g("upcoming", true, true, 0, 0, 0, "upcoming")];
  assert.deepEqual(sortGames(games).map(g => g.id), ["ranked", "acc-first", "acc-clock", "other", "acc-q3", "acc-big", "upcoming", "final"]);
});
test("finals retain their last live category through a reload", () => {
  const live = game(); live.teams[0].rank = 5;
  const final = structuredClone(live); final.state = "final"; final.teams[0].score = 35;
  const retained = retainFinalCategories(scoreboard([final]), scoreboard([live]));
  assert.equal(classify(retained.games[0]).close, true); assert.equal(classify(retained.games[0]).upset, true);
  assert.equal(classify(retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(retained))).games[0]).close, true);
  assert.equal(classify(final).close, false); assert.equal(classify(final).upset, false);
});
test("ACC week spans Thursday to Monday including Sunday and Monday boundaries", () => {
  for (const date of ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]) assert.deepEqual(accWeek(date), { start: "2026-09-03", end: "2026-09-07" });
  for (const date of ["2026-09-08", "2026-09-09", "2026-09-10"]) assert.deepEqual(accWeek(date), { start: "2026-09-10", end: "2026-09-14" });
});
test("ET midnight holds Saturday for Cal, then advances only when every game is finished", () => {
  const before = new Date("2026-09-06T03:59:59Z"), after = new Date("2026-09-06T04:00:01Z");
  assert.equal(easternDate(before), "2026-09-05"); assert.equal(easternDate(after), "2026-09-06");
  const cal = game(), late = game({ id: "late", state: "delayed" });
  assert.equal(gameDay(before, scoreboard([], "2026-09-04")), "2026-09-05");
  assert.equal(gameDay(after, scoreboard([cal])), "2026-09-05");
  cal.state = "final";
  assert.equal(gameDay(after, scoreboard([cal, late])), "2026-09-05");
  late.state = "final";
  assert.equal(gameDay(after, scoreboard([cal, late])), "2026-09-06");
  assert.equal(gameDay(after, scoreboard([])), "2026-09-06");
});
test("reused Eastern formatter follows winter, summer, DST and year boundaries", () => {
  const cases = [
    ["2026-01-01T04:59:59Z", "2025-12-31"], ["2026-01-01T05:00:00Z", "2026-01-01"],
    ["2026-03-08T06:59:59Z", "2026-03-08"], ["2026-03-08T07:00:00Z", "2026-03-08"],
    ["2026-07-01T03:59:59Z", "2026-06-30"], ["2026-07-01T04:00:00Z", "2026-07-01"],
    ["2026-11-01T05:59:59Z", "2026-11-01"], ["2026-11-01T06:00:00Z", "2026-11-01"],
    ["2026-11-02T04:59:59Z", "2026-11-01"], ["2026-11-02T05:00:00Z", "2026-11-02"],
  ];
  for (const [instant, expected] of [...cases, ...cases.toReversed()]) assert.equal(easternDate(new Date(instant)), expected, instant);
});
test("failed, stale or partial overnight feeds cannot release an already held day", () => {
  const now = new Date("2026-09-06T04:05:00Z");
  for (const prior of [null, scoreboard([], "2026-09-05", { stale: true }), scoreboard([], "2026-09-05", { warnings: ["incomplete"] })]) assert.equal(gameDay(now, prior, "2026-09-05"), "2026-09-05");
});
test("ESPN date ranges retain the 10:30pm ET Cal game and parse curatedRank 99", () => {
  const event = { id: "1", date: "2026-09-06T02:30:00Z", status: { period: 1, clock: 50, type: { name: "STATUS_IN_PROGRESS", state: "in" } }, competitions: [{ competitors: [{ id: "1", homeAway: "away", score: "0", curatedRank: { current: 99 }, team: { id: "1", conferenceId: "2" } }, { id: "2", homeAway: "home", score: "7", curatedRank: { current: 24 }, team: { id: "2", conferenceId: 1 } }] }] };
  const board = normalizeScoreboard({ events: [event] }, "2026-09-03", undefined, "2026-09-07");
  assert.equal(board.games.length, 1); assert.equal(board.games[0].teams[0].rank, null); assert.equal(board.games[0].teams[0].rankKnown, true);
  const monday = { ...event, id: "monday", date: "2026-09-08T00:00:00Z" };
  const tuesday = { ...event, id: "tuesday", date: "2026-09-08T20:00:00Z" };
  assert.deepEqual(normalizeScoreboard({ events: [event, monday, tuesday] }, "2026-09-03", undefined, "2026-09-07").games.map(g => g.id), ["1", "monday"]);
  assert.equal(normalizeScoreboard({ events: [event] }, "2026-09-06").games.length, 0);
  const url = new URL(scoreboardUrl("2026-09-03", "2026-09-07", true));
  assert.equal(url.searchParams.get("dates"), "20260903-20260908"); assert.equal(url.searchParams.get("groups"), "1"); assert.equal(url.searchParams.get("limit"), "200");
  assert.equal(new URL(scoreboardUrl("2026-09-05")).searchParams.get("dates"), "20260905");
  assert.equal(new URL(scoreboardUrl("2026-12-30", "2026-12-31")).searchParams.get("dates"), "20261230-20270101");
  const cdn = new URL(scoreboardCdnUrl());
  assert.equal(cdn.hostname, "cdn.espn.com"); assert.equal(cdn.searchParams.get("group"), "80"); assert.equal(cdn.searchParams.get("groups"), null);
  assert.equal(normalizeScoreboard({ content: { sbData: { events: [event] } } }, "2026-09-03", undefined, "2026-09-07").games.length, 1);
});

test("latest live close survives repeated started delays, reload and schedule correction without changing delayed upset", () => {
  const live = game(); live.teams[0].rank = 5;
  const delay = { ...structuredClone(live), state: "delayed", date: "2026-09-06T03:00:00Z" };
  delay.teams[0].score = 35; // Favorite recovered during delay; do not preserve its earlier upset.
  let saved = retainFinalCategories(scoreboard([delay]), scoreboard([live]));
  assert.equal(classify(saved.games[0]).close, false);
  assert.equal(classify(saved.games[0]).upset, false);
  saved = retainFinalCategories(scoreboard([delay]), JSON.parse(JSON.stringify(saved)));
  const final = { ...delay, state: "final" };
  const result = retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(saved)));
  assert.equal(classify(result.games[0]).close, true);
  assert.equal(classify(result.games[0]).upset, false);
  assert.equal(classify(retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(result))).games[0]).close, true);
  const resumed = retainFinalCategories(scoreboard([{ ...delay, state: "live" }]), saved);
  assert.equal(classify(retainFinalCategories(scoreboard([final]), resumed).games[0]).close, false);
  const unknown = structuredClone(delay); unknown.state = "live"; unknown.teams[0].score = null;
  assert.equal(classify(retainFinalCategories(scoreboard([final]), retainFinalCategories(scoreboard([unknown]), saved)).games[0]).close, false);
});

test("delays cannot invent close history or carry it across identity, board range or unstarted boundaries", () => {
  const live = game(), delay = { ...live, state: "delayed" }, final = structuredClone(live);
  final.state = "final"; final.teams[1].score = 35;
  assert.equal(classify(retainFinalCategories(scoreboard([final]), scoreboard([delay])).games[0]).close, false);
  const held = retainFinalCategories(scoreboard([delay]), scoreboard([live]));
  const variations = [
    { ...delay, started: false }, { ...delay, id: "other" },
    { ...delay, teams: [...delay.teams].reverse() },
    { ...delay, teams: [{ ...delay.teams[0], id: "replacement" }, delay.teams[1]] },
  ];
  for (const changed of variations) {
    const paused = retainFinalCategories(scoreboard([changed]), held);
    assert.equal(classify(retainFinalCategories(scoreboard([final]), paused).games[0]).close, false);
  }
  for (const different of [scoreboard([delay], "2026-09-06"), scoreboard([delay], "2026-09-05", { endDate: "2026-09-07" })]) {
    const paused = retainFinalCategories(different, held);
    assert.equal(classify(retainFinalCategories(scoreboard([final], different.date, { endDate: different.endDate }), paused).games[0]).close, false);
  }
  assert.equal(classify(retainFinalCategories(scoreboard([final]), null).games[0]).close, false);
});


test("resumed live play and inactive states end the earlier delay history", () => {
  const saved = retainFinalCategories(scoreboard([game({ state: "delayed" })]), scoreboard([game()]));
  for (const state of ["live", "upcoming", "other", "delayed"]) {
    const resumed = { ...saved.games[0], state, started: state !== "delayed" }; resumed.teams = structuredClone(resumed.teams); resumed.teams[1].score = 42;
    const next = retainFinalCategories(scoreboard([resumed]), saved);
    assert.equal(next.games[0].lastActiveClose, undefined, state);
    const paused = retainFinalCategories(scoreboard([{ ...resumed, state: "delayed", started: true }]), JSON.parse(JSON.stringify(next)));
    const final = retainFinalCategories(scoreboard([{ ...resumed, state: "final" }]), paused);
    assert.equal(classify(final.games[0]).close, false, state);
  }
});


test("pregame betting evidence shares the board-range guard with category history", () => {
  const pregameLine = { favoriteId: "a", spread: 7, source: "ESPN" };
  const previous = scoreboard([game({ state: "upcoming", started: false, pregameLine })]);
  const live = game();
  assert.deepEqual(retainFinalCategories(scoreboard([live]), previous).games[0].pregameLine, pregameLine);
  assert.deepEqual(retainFinalCategories({ ...scoreboard([live]), endDate: undefined }, previous).games[0].pregameLine, pregameLine);
  for (const next of [scoreboard([live], "2026-09-06"), scoreboard([live], previous.date, { endDate: "2026-09-07" })]) {
    assert.equal(retainFinalCategories(next, previous).games[0].pregameLine, undefined, "a matching event and kickoff cannot import betting evidence from another board range");
  }
});
