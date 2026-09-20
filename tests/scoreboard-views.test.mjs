import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { viewGames, upsetCounts, matchingBoard, expiredBoardKey, scoreboardScope, toggleCategory, normalizeSelection, boardKey } = await bundle("lib/scoreboard-views.ts");
const { gamePriority } = await bundle("lib/watch-priority.ts");
const { classify } = await bundle("lib/football.ts");
const { loadScores } = await bundle("lib/score-client.ts");

test("every count describes the displayed period's board and honors Hide finals", () => {
  const live = game();
  live.teams[0].rank = 5;
  const final = game({ id: "final", state: "final" });
  const acc = game({ id: "acc" });
  acc.teams[0].conferenceId = "1"; acc.teams[1].rank = null;
  const daily = scoreboard([live, final]);
  const future = game({ id: "monday-ranked", state: "upcoming", date: "2026-09-08T00:00:00Z" });
  const week = scoreboard([live, final, future, acc], "2026-09-03", { endDate: "2026-09-07" });
  const boards = { daily, week };
  const counts = (period, hideFinals = false) => Object.fromEntries([["all", []], ["acc", ["acc"]], ["top25", ["top25"]], ["close", ["close"]], ["upset", ["upset"]]].map(([name, selection]) => [name, viewGames(boards[scoreboardScope(period)], selection, hideFinals).length]));
  assert.deepEqual(counts("day"), { all: 2, acc: 0, top25: 2, close: 2, upset: 1 });
  assert.deepEqual(counts("week"), { all: 4, acc: 1, top25: 3, close: 3, upset: 1 });
  assert.deepEqual(counts("week", true), { all: 3, acc: 1, top25: 2, close: 2, upset: 1 });
  assert.deepEqual(counts("day", true), { all: 1, acc: 0, top25: 1, close: 1, upset: 1 });
  assert.equal(viewGames(null, []).length, 0);
  assert.equal(scoreboardScope("day"), "daily");
});

test("Upsets count active watches first and add only games that concluded as upsets", () => {
  const activeUpset = changes => { const value = game(changes); value.teams[0].rank = 5; value.teams[1].rank = null; return value; };
  const live = activeUpset({ id: "live-upset" });
  const delayed = activeUpset({ id: "delayed-upset", state: "delayed" });
  const final = activeUpset({ id: "final-upset", state: "final" });
  const recovered = game({ id: "recovered-favorite", state: "final", retainedCategories: { acc: false, top25: false, close: false, upset: true } });
  const plain = game({ id: "plain" });
  plain.teams.forEach(team => { team.rank = null; });
  plain.teams[1].score = plain.teams[0].score + 20;
  const board = scoreboard([live, delayed, final, recovered, plain]);
  assert.deepEqual(upsetCounts(board), { brewing: 2, total: 3 });
  assert.deepEqual(upsetCounts(board, true), { brewing: 2, total: 2 });
  assert.deepEqual(upsetCounts(null), { brewing: 0, total: 0 });
});

test("ORD-011 categories toggle independently, combine with OR once per game, and All is an exclusive reset", () => {
  let selection = [];
  const steps = [];
  for (const [action, expected] of [["acc", ["acc"]], ["upset", ["acc", "upset"]], ["acc", ["upset"]], ["upset", []], ["upset", ["upset"]], ["acc", ["acc", "upset"]], ["close", ["acc", "close", "upset"]], ["top25", ["acc", "top25", "close", "upset"]]]) {
    selection = toggleCategory(selection, action); steps.push(selection);
    assert.deepEqual(selection, expected, `after toggling ${action}`);
  }
  // Four manual selections stay selected rather than collapsing to All.
  assert.equal(selection.length, 4);
  assert.deepEqual(normalizeSelection([]), []);
  assert.deepEqual(normalizeSelection(["upset", "acc", "upset", "bogus", "", "watch"]), ["acc", "upset"]);
  const rankedAcc = game({ id: "ranked-acc" }); rankedAcc.teams[0].conferenceId = "1"; rankedAcc.teams[0].rank = 3;
  const plainAcc = game({ id: "plain-acc" }); plainAcc.teams.forEach(t => { t.rank = null; }); plainAcc.teams[0].conferenceId = "1"; plainAcc.teams[1].score = plainAcc.teams[0].score + 20;
  const ranked = game({ id: "ranked" }); ranked.teams[0].rank = 7; ranked.teams[1].score = ranked.teams[0].score + 20;
  const nothing = game({ id: "none" }); nothing.teams.forEach(t => { t.rank = null; }); nothing.teams[1].score = nothing.teams[0].score + 20;
  const board = scoreboard([nothing, ranked, plainAcc, rankedAcc]);
  const ids = selection => viewGames(board, selection).map(g => g.id);
  assert.deepEqual(new Set(ids(["acc", "top25"])), new Set(["ranked-acc", "plain-acc", "ranked"]));
  assert.equal(ids(["acc", "top25"]).length, 3, "a game matching both categories appears once");
  assert.deepEqual(new Set(ids(["acc"])), new Set(["ranked-acc", "plain-acc"]));
  assert.deepEqual(new Set(ids(["top25"])), new Set(["ranked-acc", "ranked"]));
  assert.deepEqual(ids([]).length, 3);
  assert.deepEqual(ids(["top25", "acc"]), ids(["acc", "top25"]), "selection order does not change results");
  const shared = ids([]);
  for (const selection of [["acc", "top25"], ["acc", "top25", "close", "upset"]]) assert.deepEqual(ids(selection).filter(id => shared.includes(id)), shared.filter(id => ids(selection).includes(id)), "shared ordering is preserved");
});

test("ORD-011 matching more selected categories adds no priority", () => {
  // A two-category match with higher priority stays above a game matching every category.
  const everything = game({ id: "everything" }); everything.teams[0].conferenceId = "1"; everything.teams[0].rank = 25; everything.teams[1].rank = null;
  everything.teams[0].score = 3; everything.teams[1].score = 10; everything.period = 1; everything.clock = 600; everything.status = "10:00 - 1st";
  const fewer = game({ id: "fewer" }); fewer.teams[0].rank = 1; fewer.teams[1].rank = 2; fewer.teams.forEach(t => { t.conferenceId = "2"; });
  fewer.teams[0].score = 24; fewer.teams[1].score = 24; fewer.period = 4; fewer.clock = 60; fewer.status = "1:00 - 4th";
  assert.deepEqual(classify(everything), { acc: true, top25: true, close: true, upset: true });
  assert.deepEqual(classify(fewer), { acc: false, top25: true, close: true, upset: false });
  assert.ok(gamePriority(fewer).total > gamePriority(everything).total, "fixture: the late top-two tie carries more priority alone");
  const board = scoreboard([everything, fewer]);
  for (const selection of [[], ["close"], ["top25", "close"], ["acc", "top25", "close", "upset"]]) {
    const order = viewGames(board, selection).map(g => g.id);
    assert.deepEqual(order, ["fewer", "everything"], JSON.stringify(selection));
    assert.deepEqual(viewGames(scoreboard([fewer, everything]), selection).map(g => g.id), order);
  }
  assert.deepEqual(viewGames(board, ["acc"]).map(g => g.id), ["everything"]);
  assert.deepEqual(viewGames(board, ["upset"]).map(g => g.id), ["everything"]);
});

test("a changed day or football week cannot display counts from the previous scope", () => {
  const daily = scoreboard([game()]);
  assert.equal(matchingBoard(daily, "2026-09-05"), daily);
  assert.equal(matchingBoard(daily, "2026-09-06"), null);
  const weekly = scoreboard([game()], "2026-09-03", { endDate: "2026-09-07" });
  assert.equal(matchingBoard(weekly, "2026-09-03", "2026-09-07"), weekly);
  assert.equal(matchingBoard(weekly, "2026-09-10", "2026-09-14"), null);
  assert.equal(matchingBoard(weekly, "2026-09-03"), null);
});

test("All excludes nonqualifying games unless explicitly focused; category selections never inherit the focus exception", () => {
  const unqualified = game();
  for (const team of unqualified.teams) team.rank = null;
  unqualified.teams[1].score = unqualified.teams[0].score + 9;
  const board = scoreboard([unqualified]);
  assert.deepEqual(viewGames(board, []), []);
  assert.deepEqual(viewGames(board, [], false, unqualified.id), [unqualified]);
  for (const selection of [["top25"], ["acc", "top25", "close", "upset"]]) assert.deepEqual(viewGames(board, selection, false, unqualified.id), []);
  unqualified.state = "final";
  assert.deepEqual(viewGames(board, [], true, unqualified.id), []);
});

test("real score client and parser preserve the weekly range used by ACC counts", async () => {
  const event = { id: "weekly", date: "2026-09-06T02:30:00Z", status: { type: { name: "STATUS_IN_PROGRESS", state: "in" } }, competitions: [{ competitors: [
    { id: "a", homeAway: "away", score: "14", team: { id: "a", conferenceId: "2" } },
    { id: "b", homeAway: "home", score: "21", team: { id: "b", conferenceId: "1" } },
  ] }] };
  const controller = new AbortController();
  const board = await loadScores("2026-09-03", controller.signal, async url => {
    const query = new URL(url).searchParams;
    assert.equal(query.get("groups"), "1");
    assert.equal(query.get("dates"), "20260903-20260908");
    return Response.json({ events: [event] });
  }, "2026-09-07", true);
  assert.equal(board.endDate, "2026-09-07");
  assert.equal(viewGames(matchingBoard(board, "2026-09-03", "2026-09-07"), ["acc"]).length, 1);

  const fallback = await loadScores("2026-09-03", controller.signal, async url => {
    if (!String(url).startsWith("/api/scores?")) throw new Error("Direct feed unavailable");
    assert.match(url, /end=2026-09-07&acc=1/);
    return Response.json(board);
  }, "2026-09-07", true);
  assert.equal(viewGames(matchingBoard(fallback, "2026-09-03", "2026-09-07"), ["acc"]).length, 1);
});

test("Top 25's full-FBS weekly feed and fallback retain Monday games and exclude out-of-range games", async () => {
  const event = (id, date, rank, acc = false) => ({ id, date, status: { type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ competitors: [
    { id: "a", homeAway: "away", curatedRank: { current: rank }, team: { id: "a", conferenceId: acc ? "1" : "2" } },
    { id: "b", homeAway: "home", curatedRank: { current: 99 }, team: { id: "b", conferenceId: "2" } },
  ] }] });
  const controller = new AbortController();
  const board = await loadScores("2026-09-03", controller.signal, async url => {
    const query = new URL(url).searchParams;
    assert.equal(query.get("groups"), "80"); assert.equal(query.get("limit"), "200");
    assert.equal(query.get("dates"), "20260903-20260908");
    return Response.json({ events: [event("non-acc-ranked", "2026-09-07T23:00:00Z", 5), event("acc-ranked", "2026-09-08T03:00:00Z", 25, true), event("unranked", "2026-09-07T22:00:00Z", 99), event("tuesday", "2026-09-08T05:00:00Z", 1)] });
  }, "2026-09-07");
  assert.deepEqual(viewGames(board, ["top25"]).map(g => g.id), ["non-acc-ranked", "acc-ranked"]);
  assert.ok(viewGames(board, ["top25"]).every(g => g.state === "upcoming"));
  // ORD-011: the same full-FBS weekly board serves the ACC category under Week.
  assert.deepEqual(viewGames(board, ["acc"]).map(g => g.id), ["acc-ranked"]);
  assert.deepEqual(viewGames(board, ["acc", "top25"]).map(g => g.id), ["non-acc-ranked", "acc-ranked"]);
  const fallback = await loadScores("2026-09-03", controller.signal, async url => {
    if (!String(url).startsWith("/api/scores?")) throw new Error("Direct feed unavailable");
    assert.match(url, /end=2026-09-07&acc=0/);
    return Response.json(board);
  }, "2026-09-07");
  assert.deepEqual(viewGames(fallback, ["top25"]).map(g => g.id), ["non-acc-ranked", "acc-ranked"]);
});

test("storage cleanup retains weekly history through the weekend and expires completed ranges, including retired key names", () => {
  assert.equal(boardKey("week", "2026-09-03", "2026-09-07"), "ss:board:week:2026-09-03:2026-09-07");
  assert.equal(boardKey("week", "2026-09-03", "2026-09-07", true), "ss:board:top25:2026-09-03:2026-09-07");
  assert.equal(boardKey("daily", "2026-09-05", "2026-09-05"), "ss:board:2026-09-05:2026-09-05");
  for (const prefix of ["ss:board:", "ss:board:top25:", "ss:board:week:"]) {
    const weekly = `${prefix}2026-09-03:2026-09-07`;
    for (const cutoff of ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]) assert.equal(expiredBoardKey(weekly, cutoff), false);
    assert.equal(expiredBoardKey(weekly, "2026-09-08"), true);
  }
  assert.equal(expiredBoardKey("ss:board:2026-09-04:2026-09-04", "2026-09-05"), true);
  assert.equal(expiredBoardKey("ss:board:2026-09-05:2026-09-05", "2026-09-05"), false);
  assert.equal(expiredBoardKey("ss:hide-finals", "2026-09-05"), false);
});

test("a weekly response filling ESPN's requested limit is flagged as possibly incomplete", async () => {
  const { normalizeScoreboard, scoreboardUrl, SCOREBOARD_LIMIT } = await bundle("lib/espn-data.ts");
  assert.equal(new URL(scoreboardUrl("2026-09-03", "2026-09-07")).searchParams.get("limit"), String(SCOREBOARD_LIMIT));
  const event = id => ({ id, date: "2026-09-05T23:30:00Z", status: { type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ competitors: [
    { id: `${id}a`, homeAway: "away", team: { id: `${id}a`, conferenceId: "2" } }, { id: `${id}b`, homeAway: "home", team: { id: `${id}b`, conferenceId: "1" } },
  ] }] });
  const events = Array.from({ length: SCOREBOARD_LIMIT }, (_, i) => event(`g${i}`));
  const full = normalizeScoreboard({ events }, "2026-09-03", undefined, "2026-09-07");
  assert.equal(full.games.length, SCOREBOARD_LIMIT);
  assert.deepEqual(full.warnings, ["ESPN returned its maximum number of games; the list may be incomplete."]);
  assert.equal(normalizeScoreboard({ events: events.slice(1) }, "2026-09-03", undefined, "2026-09-07").warnings, undefined);
});
