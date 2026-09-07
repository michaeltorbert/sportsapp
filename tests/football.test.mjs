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
test("one-score history survives a started delay and reload; resumed play, unstarted delays and other matchups reset it", () => {
  const live = game(); live.teams[0].score = 7; live.teams[1].score = 14;
  const paused = { ...structuredClone(live), state: "delayed", status: "Delayed" };
  const final = { ...structuredClone(live), state: "final", status: "Final" }; final.teams[1].score = 28;
  const carry = (next, previous) => retainFinalCategories(scoreboard([next]), previous).games[0];
  const delayed = carry(paused, scoreboard([live]));
  assert.equal(classify(delayed).close, false, "a paused game is not a live one-score game");
  assert.equal(classify(delayed).upset, false);
  const reloaded = JSON.parse(JSON.stringify(scoreboard([delayed])));
  assert.equal(classify(carry(final, reloaded)).close, true, "live → delayed → reload → final keeps one-score history");
  assert.equal(classify(carry(final, scoreboard([live]))).close, true, "control: direct live → final");
  const again = carry(paused, reloaded);
  assert.equal(classify(again).close, false);
  assert.equal(classify(carry(final, scoreboard([again]))).close, true, "repeated started delays keep carrying the history");
  const wide = structuredClone(live); wide.teams[1].score = 28;
  const resumed = carry(wide, scoreboard([delayed]));
  assert.equal(resumed.retainedCategories, undefined, "a live snapshot carries nothing; it is the observation");
  assert.equal(classify(carry(final, scoreboard([resumed]))).close, false, "play resumed at a wide margin supersedes the earlier one-score observation");
  assert.equal(classify(carry(final, scoreboard([carry(paused, scoreboard([resumed]))]))).close, false);
  const unstarted = { ...structuredClone(paused), started: false, period: 0 };
  assert.equal(carry(unstarted, scoreboard([live])).retainedCategories, undefined, "an unstarted delay is not a game in progress");
  assert.equal(carry(final, scoreboard([unstarted])).retainedCategories, undefined);
  assert.equal(classify(carry(final, scoreboard([carry(paused, null)]))).close, false, "a delay never observed live invents no history");
  const otherEvent = { ...structuredClone(final), id: "other-event" };
  assert.equal(carry(otherEvent, reloaded).retainedCategories, undefined);
  const swapped = structuredClone(final); swapped.teams.reverse();
  assert.equal(carry(swapped, reloaded).retainedCategories, undefined, "competitor order is part of the event identity");
  const rescheduled = { ...structuredClone(final), date: "2026-09-06T21:00:00Z" };
  assert.equal(classify(carry(rescheduled, reloaded)).close, true, "a corrected kickoff during the delay does not erase same-event history");
  const upsetLive = structuredClone(live); upsetLive.teams[0].rank = 5; upsetLive.teams[1].score = 21; upsetLive.teams[0].score = 14;
  assert.equal(classify(upsetLive).upset, true); assert.equal(classify(upsetLive).close, true);
  const recovered = { ...structuredClone(upsetLive), state: "delayed" }; recovered.teams[0].score = 24;
  const recoveredDelay = carry(recovered, scoreboard([upsetLive]));
  const recoveredFinal = { ...structuredClone(recovered), state: "final" }; recoveredFinal.teams[0].score = 31;
  const outcome = classify(carry(recoveredFinal, JSON.parse(JSON.stringify(scoreboard([recoveredDelay])))));
  assert.equal(outcome.upset, false, "upset history follows the paused snapshot's own score, as before");
  assert.equal(outcome.close, true, "while the earlier one-score observation still survives the delay");
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
