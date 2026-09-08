import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { viewGames, matchingBoard, expiredBoardKey, scoreboardScope } = await bundle("lib/scoreboard-views.ts");
const { loadScores } = await bundle("lib/score-client.ts");

test("each tab's count uses its own daily or weekly board and honors Hide finals", () => {
  const live = game();
  live.teams[0].rank = 5;
  const final = game({ id: "final", state: "final" });
  const acc = game({ id: "acc" });
  acc.teams[0].conferenceId = "1";
  const daily = scoreboard([live, final]);
  const weekly = scoreboard([acc], "2026-09-03", { endDate: "2026-09-07" });
  const future = game({ id: "monday-ranked", state: "upcoming", date: "2026-09-08T00:00:00Z" });
  const top25 = scoreboard([live, final, future], weekly.date, { endDate: weekly.endDate });
  const boards = { daily, acc: weekly, top25 };
  for (const active of ["watch", "acc", "top25", "close", "upset", "acc", "watch"]) {
    const counts = Object.fromEntries(["watch", "acc", "top25", "close", "upset"].map(f => [f, viewGames(boards[scoreboardScope(f)], f).length]));
    assert.deepEqual(counts, { watch: 2, acc: 1, top25: 3, close: 2, upset: 1 }, active);
  }
  assert.equal(viewGames(top25, "top25", true).length, 2);
  assert.equal(viewGames(daily, "close", true).length, 1);
  assert.equal(viewGames(weekly, "acc", true).length, 1);
  assert.equal(viewGames(null, "watch").length, 0);
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

test("Watchlist excludes nonqualifying games unless explicitly focused", () => {
  const unqualified = game();
  for (const team of unqualified.teams) team.rank = null;
  unqualified.teams[1].score = unqualified.teams[0].score + 9;
  const board = scoreboard([unqualified]);
  assert.deepEqual(viewGames(board, "watch"), []);
  assert.deepEqual(viewGames(board, "watch", false, unqualified.id), [unqualified]);
  assert.deepEqual(viewGames(board, "top25", false, unqualified.id), []);
  unqualified.state = "final";
  assert.deepEqual(viewGames(board, "watch", true, unqualified.id), []);
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
  assert.equal(viewGames(matchingBoard(board, "2026-09-03", "2026-09-07"), "acc").length, 1);

  let calls = 0;
  const fallback = await loadScores("2026-09-03", controller.signal, async url => {
    if (++calls <= 2) throw new Error("Direct feed unavailable");
    assert.match(url, /end=2026-09-07&acc=1/);
    return Response.json(board);
  }, "2026-09-07", true);
  assert.equal(viewGames(matchingBoard(fallback, "2026-09-03", "2026-09-07"), "acc").length, 1);
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
  assert.deepEqual(viewGames(board, "top25").map(g => g.id), ["non-acc-ranked", "acc-ranked"]);
  assert.ok(viewGames(board, "top25").every(g => g.state === "upcoming"));
  let calls = 0;
  const fallback = await loadScores("2026-09-03", controller.signal, async url => {
    if (++calls <= 2) throw new Error("Direct feed unavailable");
    assert.match(url, /end=2026-09-07&acc=0/);
    return Response.json(board);
  }, "2026-09-07");
  assert.deepEqual(viewGames(fallback, "top25").map(g => g.id), ["non-acc-ranked", "acc-ranked"]);
});

test("storage cleanup retains both weekly histories through the weekend and expires completed ranges", () => {
  for (const prefix of ["ss:board:", "ss:board:top25:"]) {
    const weekly = `${prefix}2026-09-03:2026-09-07`;
    for (const cutoff of ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]) assert.equal(expiredBoardKey(weekly, cutoff), false);
    assert.equal(expiredBoardKey(weekly, "2026-09-08"), true);
  }
  assert.equal(expiredBoardKey("ss:board:2026-09-04:2026-09-04", "2026-09-05"), true);
  assert.equal(expiredBoardKey("ss:board:2026-09-05:2026-09-05", "2026-09-05"), false);
  assert.equal(expiredBoardKey("ss:hide-finals", "2026-09-05"), false);
});
