import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { classify, sortGames, retainFinalCategories } = await bundle("lib/football.ts");
const { gamePriority, urgencyStage } = await bundle("lib/watch-priority.ts");
const { gameExpectation, upsetExplanation } = await bundle("lib/upset.ts");
const { viewGames } = await bundle("lib/scoreboard-views.ts");
const { conditions, transitions } = await bundle("services/alerts/rules.ts");

function match(id, { acc = false, bothAcc = false, sec = false, rank = null, otherRank = null, period = 4, clock = 120, score = 21, otherScore = 24, ...rest } = {}) {
  const g = game({ id, period, clock, ...rest });
  Object.assign(g.teams[0], { name: "Favorite", rank, score, conferenceId: acc || bothAcc ? "1" : sec ? "8" : "4" });
  Object.assign(g.teams[1], { name: "Opponent", rank: otherRank, score: otherScore, conferenceId: bothAcc ? "1" : "151" });
  return g;
}

test("confirmed viewing preferences hold for concrete games in either input order", () => {
  const pairs = [
    [match("top10-tie", { rank: 10, score: 24 }), match("acc-tie", { bothAcc: true, score: 24 })],
    [match("ranked-acc-upset", { rank: 15, acc: true }), match("acc-close", { bothAcc: true, score: 24 })],
    [match("major-upset", { rank: 3 }), match("acc-blowout", { acc: true, score: 42, otherScore: 7 })],
    [match("acc-ranked", { rank: 15, acc: true }), match("similar-ranked", { rank: 15 })],
    [match("acc-finish", { bothAcc: true, score: 24 }), match("ranked-acc-early", { rank: 3, acc: true, period: 1, clock: 900, score: 7, otherScore: 0 })],
    [match("major", { rank: 3 }), match("minor", { rank: 24, otherRank: 25 })],
    [match("other-ot", { period: 5, score: 24 }), match("ranked-acc-blowout", { rank: 3, acc: true, score: 7, otherScore: 37 })],
    [match("ranked-early", { rank: 15, acc: true, period: 1, score: 0, otherScore: 0 }), match("other-early", { period: 1, score: 0, otherScore: 0 })],
  ];
  for (const clock of [360, 120]) pairs.push([
    match(`close-${clock}`, { clock, score: 21, otherScore: 28 }),
    match(`down30-${clock}`, { clock, acc: true, rank: 3, otherRank: 20, score: 7, otherScore: 37 }),
  ]);
  for (const [higher, lower] of pairs) {
    for (const order of [[higher, lower], [lower, higher]])
      assert.equal(sortGames(order)[0].id, higher.id, `${higher.id} should beat ${lower.id}: ${JSON.stringify([gamePriority(higher), gamePriority(lower)])}`);
  }
  assert.ok(gamePriority(match("early", { period: 1, score: 0, otherScore: 0 })).drama <= 6);
});

test("Florida–ECU can qualify without ranks, while absent or contrary evidence stays honest", () => {
  const g = match("florida-ecu", { sec: true, score: 7, otherScore: 21 });
  g.teams[0].name = "Florida"; g.teams[1].name = "ECU";
  assert.equal(classify(g).top25, false); assert.equal(classify(g).close, false); assert.equal(classify(g).upset, true);
  assert.deepEqual(viewGames(scoreboard([g]), "watch").map(g => g.id), [g.id]);
  assert.match(upsetExplanation(g), /ECU leads Florida · SEC conference watch/);
  g.pregameLine = { favoriteId: "a", spread: 10.5, source: "ESPN" };
  assert.equal(gameExpectation(g).basis, "line"); assert.match(upsetExplanation(g), /pregame favorite/);
  g.teams.forEach(t => { t.rankKnown = false; });
  assert.equal(classify(g).upset, true, "a valid line does not need rankings");
  g.pregameLine.favoriteId = "b";
  assert.equal(classify(g).upset, false, "ECU was favored, so Florida trailing is not an upset");
  g.pregameLine = { favoriteId: null, spread: 0, source: "ESPN" };
  assert.equal(gameExpectation(g), null);
  delete g.pregameLine; g.teams.forEach(t => { t.rankKnown = true; });
  for (const conferenceId of [null, "unknown", "18", "4", "8"]) {
    g.teams[1].conferenceId = conferenceId;
    assert.equal(classify(g).upset, false, `no invented favorite for conference ${conferenceId}`);
  }
});

test("intraconference unranked SEC favorites are supported; unrelated unranked favorites stay out", () => {
  const g = match("sec", { sec: true, score: 7, otherScore: 21, pregameLine: { favoriteId: "a", spread: 3, source: "ESPN" } });
  g.teams[1].conferenceId = "8";
  assert.equal(classify(g).upset, true);
  g.teams[0].conferenceId = "15"; g.teams[1].conferenceId = "17";
  assert.equal(classify(g).upset, false);
  g.teams[0].rank = 20;
  assert.equal(classify(g).upset, true, "ranked teams get credit regardless of conference");
});

test("clock validity, intermissions, ties and finishing bands limit misleading urgency and churn", () => {
  const base = match("g", { rank: 5, score: 24 });
  assert.equal(classify(base).upset, false); assert.ok(gamePriority(base).upset > 0);
  for (const clockKnown of [false, undefined]) assert.equal(urgencyStage({ ...base, clock: 0, clockKnown }), 4);
  assert.equal(urgencyStage({ ...base, clock: 0, clockKnown: true }), 5);
  assert.equal(urgencyStage({ ...base, clock: -1 }), 4);
  assert.equal(urgencyStage({ ...base, intermission: true, clock: 0 }), 4);
  assert.equal(urgencyStage({ ...base, period: 2, intermission: true, clock: 0 }), 2);
  assert.equal(urgencyStage({ ...base, period: 5, clockKnown: false }), 6);
  for (const state of ["upcoming", "final", "delayed", "other"]) assert.equal(urgencyStage({ ...base, state }), 0);
  const a = match("a", { clock: 100 }), b = match("b", { clock: 90 });
  assert.deepEqual(sortGames([b, a]).map(g => g.id), ["a", "b"]);
  assert.deepEqual(sortGames([b, { ...a, clock: 99 }]).map(g => g.id), ["a", "b"]);
  assert.equal(sortGames([{ ...b, clock: 10 }, a])[0].id, "b");
});

test("every filter preserves shared relative order, chronology and immutable inputs", () => {
  const games = [match("acc", { acc: true }), match("top", { rank: 10 }), match("sec", { sec: true }), match("other", { score: 24 }),
    match("earlier", { rank: 25, state: "upcoming", date: "2026-09-06T17:00:00Z" }), match("later", { rank: 1, state: "upcoming", date: "2026-09-06T20:00:00Z" }), match("final", { rank: 1, acc: true, state: "final" })];
  const before = structuredClone(games), ordered = sortGames(games).map(g => g.id);
  assert.deepEqual(sortGames([...games].reverse()).map(g => g.id), ordered); assert.deepEqual(games, before);
  for (const filter of ["acc", "top25", "upset", "close", "watch"]) {
    const filtered = viewGames(scoreboard(games), filter).map(g => g.id);
    assert.deepEqual(filtered, ordered.filter(id => filtered.includes(id)));
  }
  assert.ok(ordered.indexOf("earlier") < ordered.indexOf("later")); assert.equal(ordered.at(-1), "final");
  assert.equal(viewGames(scoreboard(games), "watch", true).some(g => g.state === "final"), false);
});

test("pregame lines survive kickoff and reload, but cannot migrate to a different matchup", () => {
  const pre = match("sec", { sec: true, state: "upcoming", started: false, pregameLine: { favoriteId: "a", spread: 7, source: "ESPN" } });
  const live = match("sec", { sec: true });
  for (const state of ["upcoming", "live", "delayed"]) {
    const transition = { ...live, state, started: false, period: 0 };
    assert.equal(retainFinalCategories(scoreboard([transition]), scoreboard([pre])).games[0].pregameLine.favoriteId, "a");
  }
  let board = retainFinalCategories(scoreboard([live]), scoreboard([pre]));
  assert.equal(board.games[0].pregameLine.favoriteId, "a");
  board = retainFinalCategories(scoreboard([{ ...live, state: "final" }]), JSON.parse(JSON.stringify(board)));
  assert.equal(board.games[0].pregameLine.favoriteId, "a");
  const replacement = structuredClone(live); replacement.teams[0].id = "different";
  assert.equal(retainFinalCategories(scoreboard([replacement]), board).games[0].pregameLine, undefined);
  const comeback = match("sec", { sec: true, state: "final", score: 35, otherScore: 24 });
  const retained = retainFinalCategories(scoreboard([comeback]), board).games[0];
  assert.equal(classify(retained).upset, true); assert.equal(upsetExplanation(retained), null);
  const rescheduled = { ...comeback, date: "2026-09-06T21:00:00Z" };
  const moved = retainFinalCategories(scoreboard([rescheduled]), board).games[0];
  assert.equal(classify(moved).upset, true, "same-event categories survive schedule updates");
  assert.equal(moved.pregameLine, undefined, "a reschedule must not assert the original betting baseline still applies");
  const ranked = match("both-ranked", { rank: 24, otherRank: 25 });
  assert.match(upsetExplanation(ranked), /No\. 25 Opponent leads No\. 24 Favorite/);
});

test("expanded list eligibility does not redefine ranked push triggers or their dedupe IDs", () => {
  const g = match("sec", { sec: true, pregameLine: { favoriteId: "a", spread: 7, source: "ESPN" } });
  for (const period of [4, 5]) {
    g.period = period;
    assert.equal(classify(g).upset, true); assert.equal(conditions(g, Date.now())["ranked-trailing-fourth"], false);
  }
  assert.equal(conditions({ ...g, state: "final" }, Date.now())["upset-final"], false);
  g.teams[0].rank = 5; g.pregameLine.favoriteId = "b";
  assert.equal(classify(g).upset, false); assert.equal(conditions(g, Date.now())["ranked-trailing-fourth"], true);
  assert.ok(transitions(null, g, Date.now()).some(e => e.id === "sec:ranked-trailing-fourth"));
});

test("unranked SEC upset watches remain visible during a delay after kickoff", () => {
  const paused = match("paused-sec", { sec: true, state: "delayed", started: true, score: 7, otherScore: 21 });
  for (const filter of ["watch", "upset"])
    assert.deepEqual(viewGames(scoreboard([paused]), filter).map(g => g.id), [paused.id]);
  assert.equal(gamePriority(paused).stage, 0);
  assert.equal(classify({ ...paused, started: false }).upset, false, "an unstarted delay is not a game in progress");
  paused.teams[0].rank = 5;
  assert.equal(conditions(paused, Date.now())["ranked-trailing-fourth"], false);
});
