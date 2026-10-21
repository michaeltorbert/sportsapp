import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { viewGames, upsetCounts, categoryCounts, matchingBoard, expiredBoardKey, scoreboardScope, toggleCategory, normalizeSelection, boardKey } = await bundle("lib/scoreboard-views.ts");
const { gamePriority } = await bundle("lib/watch-priority.ts");
const { classify, retainFinalCategories } = await bundle("lib/football.ts");
const { upsetExplanation } = await bundle("lib/upset.ts");
const { loadScores } = await bundle("lib/score-client.ts");
const { protectDukeBoard, defaultDukePreferences } = await bundle("lib/duke-visibility.ts");

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
  assert.equal(viewGames(board, ["upset"]).some(game => game.id === recovered.id), false);
  assert.deepEqual(upsetCounts(board), { brewing: 2, total: 3 });
  assert.deepEqual(upsetCounts(board, true), { brewing: 2, total: 2 });
  assert.deepEqual(upsetCounts(null), { brewing: 0, total: 0 });
});

test("category counts pair qualifying games in progress with every listed game, whatever its state", () => {
  // ACC games that are never close or upsets: the ACC team leads comfortably.
  const acc = (id, changes = {}) => {
    const value = game({ id, ...changes });
    Object.assign(value.teams[0], { conferenceId: "1", score: 35 });
    value.teams.forEach(team => { team.rank = null; });
    return value;
  };
  const games = [
    acc("live"),
    acc("halftime", { halftime: true, intermission: true, period: 2, status: "Halftime" }),
    acc("started-delay", { state: "delayed", status: "Delayed" }),
    acc("pregame-delay", { state: "delayed", started: false, period: 0, status: "Delayed" }),
    acc("upcoming", { state: "upcoming", started: false, period: 0, status: "Scheduled" }),
    acc("final", { state: "final", status: "Final" }),
    acc("other", { state: "other", started: false, period: 0, status: "Postponed" }),
  ];
  const board = scoreboard(games);
  assert.equal(viewGames(board, ["acc"]).length, 7, "fixture: every state is listed under ACC");
  assert.deepEqual(categoryCounts(board, ["acc"]), { current: 3, total: 7 });
  assert.deepEqual(categoryCounts(board, ["acc"], true), { current: 3, total: 6 });
  assert.deepEqual(categoryCounts(board, []), { current: 3, total: 7 });
  // The total is every listed game, not in-progress games plus finals.
  assert.notEqual(categoryCounts(board, ["acc"]).total, 3 + 1);
  for (const selection of [["top25"], ["close"], ["upset"]]) assert.deepEqual(categoryCounts(board, selection), { current: 0, total: 0 }, JSON.stringify(selection));
  // Reversed input order counts the same.
  assert.deepEqual(categoryCounts(scoreboard([...games].reverse()), ["acc"]), { current: 3, total: 7 });
});

test("category counts follow OR membership once per game and the All-only focused game", () => {
  const rankedAcc = game({ id: "ranked-acc" });
  Object.assign(rankedAcc.teams[0], { conferenceId: "1", rank: 3, score: 35 }); rankedAcc.teams[1].rank = null;
  const plainAcc = game({ id: "plain-acc", state: "upcoming", started: false, period: 0 });
  plainAcc.teams[0].conferenceId = "1"; plainAcc.teams.forEach(team => { team.rank = null; });
  const ranked = game({ id: "ranked-final", state: "final" });
  Object.assign(ranked.teams[0], { rank: 7, score: 35 }); ranked.teams[1].rank = null;
  const focused = game({ id: "focused" });
  focused.teams.forEach(team => { team.rank = null; }); focused.teams[0].score = 0;
  const board = scoreboard([focused, ranked, plainAcc, rankedAcc]);
  assert.deepEqual(categoryCounts(board, ["acc"]), { current: 1, total: 2 });
  assert.deepEqual(categoryCounts(board, ["top25"]), { current: 1, total: 2 });
  assert.deepEqual(categoryCounts(board, ["acc", "top25"]), { current: 1, total: 3 }, "the ranked ACC game counts once");
  assert.deepEqual(categoryCounts(board, []), { current: 1, total: 3 });
  assert.deepEqual(categoryCounts(board, [], false, "focused"), { current: 2, total: 4 });
  assert.deepEqual(categoryCounts(board, [], true, "focused"), { current: 2, total: 3 });
  assert.deepEqual(categoryCounts(board, ["acc", "top25"], false, "focused"), { current: 1, total: 3 }, "categories never inherit the focus exception");
  for (const [selection, hideFinals, focusedGame] of [[[], false, "focused"], [["acc", "top25"], false, ""], [["acc", "top25"], true, ""]])
    assert.equal(categoryCounts(board, selection, hideFinals, focusedGame).total, viewGames(board, selection, hideFinals, focusedGame).length);
});

test("exact Upsets counts delegate brewing and actual upsets; mixed selections use the general path", () => {
  const activeUpset = changes => { const value = game(changes); value.teams[0].rank = 5; value.teams[1].rank = null; return value; };
  const live = activeUpset({ id: "live-upset" });
  const delayed = activeUpset({ id: "delayed-upset", state: "delayed" });
  const final = activeUpset({ id: "final-upset", state: "final" });
  const recovered = game({ id: "recovered-favorite", state: "final", retainedCategories: { acc: false, top25: false, close: false, upset: true } });
  const plain = game({ id: "plain" });
  plain.teams.forEach(team => { team.rank = null; });
  plain.teams[1].score = plain.teams[0].score + 20;
  const board = scoreboard([live, delayed, final, recovered, plain]);
  for (const hideFinals of [false, true]) {
    const { brewing, total } = upsetCounts(board, hideFinals);
    assert.deepEqual(categoryCounts(board, ["upset"], hideFinals), { current: brewing, total });
  }
  assert.deepEqual(categoryCounts(board, ["upset"]), { current: 2, total: 3 }, "the recovered favorite's final is excluded");
  assert.deepEqual(categoryCounts(board, ["upset"], true), { current: 2, total: 2 });
  const accLive = activeUpset({ id: "acc-live-upset" }); accLive.teams[0].conferenceId = "1";
  const accUpcoming = game({ id: "acc-upcoming", state: "upcoming", started: false, period: 0 });
  accUpcoming.teams[0].conferenceId = "1"; accUpcoming.teams.forEach(team => { team.rank = null; });
  const mixed = scoreboard([accLive, live, final, recovered, accUpcoming]);
  assert.deepEqual(categoryCounts(mixed, ["acc"]), { current: 1, total: 2 });
  assert.deepEqual(categoryCounts(mixed, ["upset"]), { current: 2, total: 3 });
  assert.deepEqual(categoryCounts(mixed, ["acc", "upset"]), { current: 2, total: 4 }, "the ACC upset counts once");
  assert.deepEqual(categoryCounts(mixed, ["acc", "upset"], true), { current: 2, total: 3 });
});

test("a delay never adds a One-score count; its retained final counts in the total only", () => {
  const live = game({ id: "delay-close" });
  const paused = retainFinalCategories(scoreboard([{ ...live, state: "delayed" }]), scoreboard([live]));
  assert.equal(paused.games[0].lastActiveClose, true);
  assert.deepEqual(categoryCounts(paused, ["close"]), { current: 0, total: 0 });
  assert.deepEqual(categoryCounts(paused, ["top25"]), { current: 1, total: 1 }, "a delay after kickoff is in progress where it qualifies");
  const final = structuredClone(live); final.state = "final"; final.teams[1].score = 35;
  const finished = retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(paused)));
  assert.deepEqual(categoryCounts(finished, ["close"]), { current: 0, total: 1 });
  assert.deepEqual(categoryCounts(finished, ["close"], true), { current: 0, total: 0 });
});

test("an empty board counts real zeros for every selection", () => {
  for (const selection of [[], ["acc"], ["top25"], ["close"], ["upset"], ["acc", "upset"]]) {
    assert.deepEqual(categoryCounts(scoreboard([]), selection), { current: 0, total: 0 }, JSON.stringify(selection));
    assert.deepEqual(categoryCounts(null, selection), { current: 0, total: 0 }, JSON.stringify(selection));
  }
});

test("ORD-016 Virginia Tech comeback leaves Upsets but remains in its other categories", () => {
  const live = game({ id: "vt-bc", state: "live", pregameLine: { favoriteId: "259", spread: 14.5, source: "fixture" } });
  Object.assign(live.teams[0], { id: "259", name: "Virginia Tech", conferenceId: "1", rank: null, score: 7 });
  Object.assign(live.teams[1], { id: "103", name: "Boston College", conferenceId: "1", rank: null, score: 14 });
  assert.deepEqual(viewGames(scoreboard([live]), ["upset"]).map(game => game.id), [live.id]);
  const finished = structuredClone(live);
  finished.state = "final"; finished.teams[0].score = 21;
  const board = retainFinalCategories(scoreboard([finished]), scoreboard([live]));
  const final = board.games[0];
  assert.equal(final.retainedCategories.upset, true, "historical observation can survive in stored data");
  assert.equal(classify(final).upset, false, "the final result determines Upsets membership");
  assert.deepEqual(viewGames(board, ["upset"]), []);
  for (const selection of [[], ["acc"], ["close"]])
    assert.deepEqual(viewGames(board, selection).map(game => game.id), [final.id]);
  assert.deepEqual(upsetCounts(board), { brewing: 0, total: 0 });
  assert.deepEqual(viewGames(board, [], true), []);
});

test("ORD-015 ranked live watches and completed upsets count despite contrary retained lines", () => {
  const ranked = (id, state) => {
    const value = game({ id, state });
    value.teams[0].rank = 4; value.teams[0].rankKnown = true; value.teams[0].score = 3;
    value.teams[1].rank = 21; value.teams[1].rankKnown = true; value.teams[1].score = 10;
    value.pregameLine = { favoriteId: value.teams[1].id, spread: 3, source: "retained" };
    return value;
  };
  const board = scoreboard([ranked("ole-miss-florida", "live"), ranked("iowa-michigan", "live"), ranked("finished", "final")]);
  assert.deepEqual(viewGames(board, ["upset"]).map(g => g.id), ["iowa-michigan", "ole-miss-florida", "finished"]);
  assert.deepEqual(upsetCounts(board), { brewing: 2, total: 3 });
  assert.deepEqual(upsetCounts(board, true), { brewing: 2, total: 2 });
});

test("ORD-015 either a higher-ranked loser or favored loser counts as a completed upset", () => {
  const result = (id, awayScore, homeScore) => {
    const value = game({ id, state: "final" });
    Object.assign(value.teams[0], { name: "Higher", rank: 4, rankKnown: true, score: awayScore });
    Object.assign(value.teams[1], { name: "Lower favorite", rank: 21, rankKnown: true, score: homeScore });
    value.pregameLine = { favoriteId: value.teams[1].id, spread: 3, source: "validated pregame line" };
    return value;
  };
  const rankUpset = result("rank-upset", 3, 10);
  const lineUpset = result("line-upset", 10, 3);
  assert.equal(classify(rankUpset).upset, true);
  assert.equal(classify(lineUpset).upset, true);
  assert.match(upsetExplanation(rankUpset), /No\. 21 Lower favorite beat No\. 4 Higher · rank-based upset/);
  assert.match(upsetExplanation(lineUpset), /No\. 4 Higher beat No\. 21 Lower favorite · pregame favorite/);
  const board = scoreboard([rankUpset, lineUpset]);
  assert.deepEqual(new Set(viewGames(board, ["upset"]).map(game => game.id)), new Set(["rank-upset", "line-upset"]));
  assert.deepEqual(upsetCounts(board), { brewing: 0, total: 2 });
  assert.deepEqual(upsetCounts(board, true), { brewing: 0, total: 0 });
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

// ORD-021 fixtures: curated games, an ordinary unranked non-ACC upcoming game outside the watchlist,
// an FBS–FCS matchup as the feed returns it (unranked, unknown conference), and a Duke game.
function scopeGames() {
  const ranked = game({ id: "ranked-live" });
  const accFinal = game({ id: "acc-final", state: "final" }); accFinal.teams[0].conferenceId = "1"; accFinal.teams.forEach(team => { team.rank = null; }); accFinal.teams[0].score = 35;
  const ordinary = game({ id: "ordinary-upcoming", state: "upcoming", started: false, period: 0, date: "2026-09-05T23:00:00Z" }); ordinary.teams.forEach(team => { team.rank = null; });
  const fcs = game({ id: "fbs-fcs", state: "upcoming", started: false, period: 0, date: "2026-09-05T17:00:00Z" }); fcs.teams.forEach(team => { team.rank = null; }); fcs.teams[1].conferenceId = "";
  const ordinaryFinal = game({ id: "ordinary-final", state: "final" }); ordinaryFinal.teams.forEach(team => { team.rank = null; }); ordinaryFinal.teams[0].score = 42;
  const duke = game({ id: "duke-game", state: "upcoming", started: false, period: 0 }); duke.teams[0] = { ...duke.teams[0], id: "150", name: "Duke", rank: null }; duke.teams[1].rank = null;
  return { ranked, accFinal, ordinary, fcs, ordinaryFinal, duke };
}

test("ORD-021 All FBS games shows every board game only for the empty selection; categories still narrow with OR", () => {
  const g = scopeGames(), games = Object.values(g);
  const hideDuke = { ...defaultDukePreferences(), manual: { "duke-game": true } };
  const daily = protectDukeBoard(scoreboard(games), hideDuke);
  const week = protectDukeBoard(scoreboard([...games, game({ id: "monday-ranked", state: "upcoming", started: false, period: 0, date: "2026-09-08T00:00:00Z" })], "2026-09-03", { endDate: "2026-09-07" }), hideDuke);
  for (const board of [daily, week]) {
    const ids = (selection, hideFinals = false, allFbs = false) => viewGames(board, selection, hideFinals, "", allFbs).map(game => game.id);
    // Curated All excludes the ordinary and FBS–FCS games; All FBS adds them.
    assert.equal(ids([]).includes("ordinary-upcoming"), false); assert.equal(ids([]).includes("fbs-fcs"), false);
    assert.deepEqual(new Set(ids([], false, true)), new Set(board.games.map(game => game.id)));
    assert.ok(ids([], false, true).includes("ordinary-upcoming") && ids([], false, true).includes("fbs-fcs"));
    // Selecting ACC narrows; the scope never widens a category.
    assert.deepEqual(ids(["acc"], false, true), ids(["acc"]));
    assert.equal(ids(["acc"], false, true).includes("ordinary-upcoming"), false);
    // Four manual categories are their union, not every FBS game.
    const four = ["acc", "top25", "close", "upset"];
    assert.deepEqual(ids(four, false, true), ids(four)); assert.deepEqual(ids(four, false, true), ids([]));
    assert.equal(ids(four, false, true).includes("fbs-fcs"), false);
    // Hide finals excludes finals in either scope.
    assert.equal(viewGames(board, [], true, "", true).some(game => game.state === "final"), false);
    assert.ok(ids([], true, true).includes("ordinary-upcoming"));
    // The protected Duke game is absent in both scopes and from every category.
    for (const selection of [[], ["acc"], four]) for (const allFbs of [false, true]) assert.equal(ids(selection, false, allFbs).includes("duke-game"), false);
  }
  assert.ok(viewGames(week, [], false, "", true).some(game => game.id === "monday-ranked"));
  // Unprotected, the Duke game would be listed: protection, not the scope, removes it.
  assert.ok(viewGames(scoreboard(games), [], false, "", true).some(game => game.id === "duke-game"));
  assert.deepEqual(viewGames(null, [], false, "", true), []);
});

test("ORD-021 counts describe each chip's own scope after Hide finals; category and Upsets counts are unchanged", () => {
  const g = scopeGames();
  const upset = game({ id: "brewing-upset" }); upset.teams[0].rank = 5; upset.teams[1].rank = null;
  const board = protectDukeBoard(scoreboard([...Object.values(g), upset]), { ...defaultDukePreferences(), manual: { "duke-game": true } });
  for (const hideFinals of [false, true]) {
    const all = categoryCounts(board, [], hideFinals, "", true);
    assert.equal(all.total, viewGames(board, [], hideFinals, "", true).length);
    assert.deepEqual(all, { current: 2, total: hideFinals ? 4 : 6 }, String(hideFinals));
    for (const selection of [["acc"], ["top25"], ["close"], ["upset"], ["acc", "upset"], ["acc", "top25", "close", "upset"]])
      assert.deepEqual(categoryCounts(board, selection, hideFinals, "", true), categoryCounts(board, selection, hideFinals), JSON.stringify(selection));
    const { brewing, total } = upsetCounts(board, hideFinals);
    assert.deepEqual(categoryCounts(board, ["upset"], hideFinals, "", true), { current: brewing, total }, "Upsets keeps its brewing/completed count");
  }
  assert.deepEqual(categoryCounts(board, ["upset"], false, "", true), { current: 1, total: 1 });
  // The curated count stays the watchlist's; the focused-game exception adds nothing beyond every game.
  assert.deepEqual(categoryCounts(board, []), { current: 2, total: 3 });
  assert.deepEqual(categoryCounts(board, [], false, "ordinary-upcoming", true), categoryCounts(board, [], false, "", true));
  assert.deepEqual(categoryCounts(scoreboard([]), [], false, "", true), { current: 0, total: 0 });
  assert.deepEqual(categoryCounts(null, [], false, "", true), { current: 0, total: 0 });
});

test("ORD-021 scope keeps the shared order and curated relative order for reversed and rotated inputs", () => {
  const games = Object.values(scopeGames()).filter(game => game.id !== "duke-game");
  const expected = viewGames(scoreboard(games), [], false, "", true).map(game => game.id);
  for (const input of [games, [...games].reverse(), [...games.slice(2), ...games.slice(0, 2)]]) {
    const before = structuredClone(input);
    const order = viewGames(scoreboard(input), [], false, "", true).map(game => game.id);
    assert.deepEqual(order, expected);
    const curated = viewGames(scoreboard(input), []).map(game => game.id);
    assert.deepEqual(curated, order.filter(id => curated.includes(id)), "curated games keep their relative order under All FBS");
    assert.deepEqual(input, before, "inputs are not mutated");
  }
  assert.deepEqual(expected.slice(0, 1), ["ranked-live"], "the live game still leads its state groups");
  assert.equal(expected.at(-1).endsWith("final"), true);
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
