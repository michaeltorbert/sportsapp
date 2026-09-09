import test from "node:test";
import assert from "node:assert/strict";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { parsePregameLine, summaryPregameLine, enrichPregameLines } = await bundle("lib/pregame-lines.ts");
const { normalizeScoreboard } = await bundle("lib/espn-data.ts");
const { loadScores } = await bundle("lib/score-client.ts");
const { gamePriority } = await bundle("lib/watch-priority.ts");

function odds(changes = {}) {
  return { spread: -7, provider: { id: "100", name: "ESPN sample", priority: 1 },
    awayTeamOdds: { favorite: false, team: { id: "a" } }, homeTeamOdds: { favorite: true, team: { id: "b" } }, ...changes };
}
function event(changes = {}) {
  return { id: "odds-game", date: "2026-09-06T20:00:00Z", status: { period: 0, clock: 0, type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ odds: [odds()], competitors: [
    { id: "a", homeAway: "away", score: "0", curatedRank: { current: 99 }, team: { id: "a", conferenceId: "151" } },
    { id: "b", homeAway: "home", score: "0", curatedRank: { current: 99 }, team: { id: "b", conferenceId: "8" } },
  ] }], ...changes };
}
function summary(g, lines = [odds()]) {
  return { header: { id: g.id, competitions: [{ competitors: g.teams.map((t, i) => ({ homeAway: i ? "home" : "away", team: { id: t.id } })) }] }, pickcenter: lines };
}

test("parse explicit pregame favorites, away spreads, pick'em and summary teamId references", () => {
  assert.deepEqual(parsePregameLine([odds()], "a", "b"), { favoriteId: "b", spread: 7, source: "ESPN sample" });
  const away = odds({ spread: 22.5, awayTeamOdds: { favorite: true, team: { id: "a" } }, homeTeamOdds: { favorite: false, team: { id: "b" } } });
  assert.equal(parsePregameLine([away], "a", "b").favoriteId, "a");
  const pickem = odds({ spread: 0, homeTeamOdds: { favorite: false, team: { id: "b" } } });
  assert.equal(parsePregameLine([pickem], "a", "b").favoriteId, null);
  const referenced = odds({ homeTeamOdds: { favorite: true, teamId: "b", team: { $ref: "https://sports.core.api.espn.com/team/b" } } });
  assert.equal(parsePregameLine([referenced], "a", "b").favoriteId, "b");
  assert.deepEqual(parsePregameLine([odds({ spread: "-7.5", homeTeamOdds: { favorite: true, teamId: 2 }, awayTeamOdds: { favorite: false, teamId: 1 } })], "1", "2"), { favoriteId: "2", spread: 7.5, source: "ESPN sample" });
  for (const spread of ["", " ", "NaN", "Infinity", "7 points", null, false])
    assert.equal(parsePregameLine([odds({ spread })], "a", "b"), undefined);
});

test("malformed, live, conflicting and mismatched odds never establish a favorite", () => {
  const invalid = [
    odds({ isLive: true }), odds({ live: true }), odds({ type: "live" }), odds({ spread: Infinity }), odds({ spread: 7 }),
    odds({ homeTeamOdds: { favorite: true } }), odds({ homeTeamOdds: { favorite: true, team: { id: "wrong" } } }),
    odds({ awayTeamOdds: { favorite: true, team: { id: "a" } } }),
    odds({ homeTeamOdds: { favorite: false, team: { id: "b" } } }),
    odds({ homeTeamOdds: { favorite: true, teamId: "wrong", team: { id: "b" } } }),
  ];
  for (const entry of invalid) assert.equal(parsePregameLine([entry], "a", "b"), undefined);
  assert.equal(parsePregameLine(null, "a", "b"), undefined);
  const away = odds({ spread: 7, homeTeamOdds: { favorite: false, team: { id: "b" } }, awayTeamOdds: { favorite: true, team: { id: "a" } } });
  assert.equal(parsePregameLine([odds(), away], "a", "b"), undefined);
  away.provider.priority = 2;
  assert.equal(parsePregameLine([away, odds()], "a", "b").favoriteId, "b");
});

test("scoreboard parsing retains known clocks and only reads pre-kickoff line evidence", () => {
  const normalize = e => normalizeScoreboard({ events: [e] }, "2026-09-06").games[0];
  assert.equal(normalize(event()).pregameLine.favoriteId, "b");
  const live = event({ status: { period: 4, clock: 0, type: { name: "STATUS_IN_PROGRESS", state: "in" } } });
  assert.equal(normalize(live).pregameLine, undefined, "unverified live scoreboard odds cannot become pregame evidence");
  assert.equal(normalize(live).clockKnown, true); assert.equal(gamePriority(normalize(live)).stage, 5);
  delete live.status.clock;
  assert.equal(normalize(live).clockKnown, false); assert.equal(gamePriority(normalize(live)).stage, 4);
  live.status.clock = -1;
  assert.equal(normalize(live).clockKnown, false);
  live.status.clock = 0; live.status.type.name = "STATUS_END_PERIOD";
  assert.equal(normalize(live).intermission, true); assert.equal(gamePriority(normalize(live)).stage, 4);
  live.status.period = 2; live.status.type.name = "STATUS_HALFTIME";
  assert.equal(gamePriority(normalize(live)).stage, 2);
  live.competitions[0].odds = { malformed: true };
  assert.equal(normalize(live).id, live.id, "invalid odds cannot discard an otherwise valid score");
});

test("alert normalization distinguishes absent odds from supplied invalid evidence without changing display lines", () => {
  for (const [raw, invalid] of [[undefined, false], [[], false], [{ malformed: true }, true], [[odds({ spread: "bad" })], true], [[odds()], false]]) {
    const e = event(); e.competitions[0].odds = raw;
    const g = normalizeScoreboard({ events: [e] }, "2026-09-06").games[0];
    assert.equal(g.pregameEvidenceInvalid === true, invalid);
    if (invalid) assert.equal(g.pregameLine, undefined);
  }
});

test("summary identity binds the line to the correct game and both competitors", () => {
  const g = game({ id: "summary-identity" });
  assert.equal(summaryPregameLine(summary(g), g).favoriteId, "b");
  const wrong = summary(g); wrong.header.id = "other-game";
  assert.equal(summaryPregameLine(wrong, g), undefined);
  const swapped = summary(g); swapped.header.competitions[0].competitors.reverse();
  swapped.header.competitions[0].competitors[0].homeAway = "away";
  assert.equal(summaryPregameLine(swapped, g), undefined);
  assert.equal(summaryPregameLine({ ...summary(g, []), odds: [odds()] }, g), undefined, "do not read generic/live odds instead of pickcenter");
});

test("first visit after kickoff obtains a pregame line without losing scores; completed lookups cache", async () => {
  const live = event({ status: { period: 4, clock: 120, type: { name: "STATUS_IN_PROGRESS", state: "in" } } });
  delete live.competitions[0].odds; live.competitions[0].competitors[0].score = "21"; live.competitions[0].competitors[1].score = "7";
  const normalized = normalizeScoreboard({ events: [live] }, "2026-09-06").games[0];
  let summaries = 0;
  const fetcher = async url => {
    if (url.includes("/summary?")) { summaries++; return Response.json(summary(normalized)); }
    return Response.json({ events: [live] });
  };
  const signal = new AbortController().signal;
  for (let i = 0; i < 2; i++) {
    const board = await loadScores("2026-09-06", signal, fetcher);
    assert.equal(board.games[0].pregameLine.favoriteId, "b");
    assert.deepEqual(board.games[0].teams.map(t => t.score), [21, 7]);
  }
  assert.equal(summaries, 1);
  const failed = await loadScores("2026-09-06", signal, async url => url.includes("/summary?") ? Promise.reject(new Error("offline")) : Response.json({ events: [live] }));
  assert.equal(failed.games[0].pregameLine, undefined); assert.deepEqual(failed.games[0].teams.map(t => t.score), [21, 7]);
});

test("a game paused after kickoff can recover its line without triggering live urgency", async () => {
  const paused = game({ id: "paused", state: "delayed", started: true });
  const board = await enrichPregameLines(scoreboard([paused]), new AbortController().signal, async () => Response.json(summary(paused)));
  assert.equal(board.games[0].pregameLine.favoriteId, "b");
  assert.equal(gamePriority(board.games[0]).stage, 0);
});

test("overlapping board refreshes cannot erase a valid line with a missing-line response", async () => {
  const g = game({ id: "shared-scopes" }), pending = [];
  const fetcher = () => new Promise(resolve => pending.push(resolve));
  const first = enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  const second = enrichPregameLines(scoreboard([g], "2026-09-03", { endDate: "2026-09-07" }), new AbortController().signal, fetcher);
  pending[0](Response.json(summary(g)));
  const daily = await first;
  pending[1](Response.json(summary(g, [])));
  const weekly = await second;
  assert.deepEqual(weekly.games[0].pregameLine, daily.games[0].pregameLine);
  assert.equal(weekly.games[0].pregameLine.favoriteId, "b");
});

test("optional line requests are bounded and caller cancellation cannot retain their results", async () => {
  const games = Array.from({ length: 30 }, (_, i) => game({ id: `bounded-${i}` }));
  let calls = 0, running = 0, maxRunning = 0;
  const enriched = await enrichPregameLines(scoreboard(games), new AbortController().signal, async url => {
    calls++; running++; maxRunning = Math.max(maxRunning, running);
    await new Promise(resolve => setTimeout(resolve, 1)); running--;
    const g = games.find(g => url.endsWith(g.id)); return Response.json(summary(g));
  });
  assert.equal(calls, 12); assert.ok(maxRunning <= 4); assert.equal(enriched.games.filter(g => g.pregameLine).length, 12);
  const c = new AbortController(); let resolve;
  const pending = enrichPregameLines(scoreboard([game({ id: "canceled" })]), c.signal, () => new Promise(r => { resolve = r; }));
  c.abort(); resolve(Response.json(summary(game({ id: "canceled" }))));
  assert.equal((await pending).games[0].pregameLine, undefined);
});

test("failed summary requests yield slots to healthy later games and back off briefly", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-06T20:00:00Z") });
  const games = Array.from({ length: 13 }, (_, i) => game({ id: `retry-${String(i).padStart(2, "0")}` }));
  const healthy = games.at(-1);
  healthy.teams.forEach(t => { t.conferenceId = "8"; t.rank = null; });
  healthy.teams[0].score = 21; healthy.teams[1].score = 7;
  const calls = [];
  const fetcher = async url => {
    const id = new URL(url).searchParams.get("event"); calls.push(id);
    return id === healthy.id ? Response.json(summary(healthy)) : new Response(null, { status: 404 });
  };
  const board = scoreboard(games), signal = new AbortController().signal;
  await enrichPregameLines(board, signal, fetcher);
  assert.equal(calls.length, 12); assert.ok(!calls.includes(healthy.id));
  const second = await enrichPregameLines(board, signal, fetcher);
  assert.ok(calls.includes(healthy.id));
  assert.equal(calls.length, 13, "failed requests have a one-minute operational backoff");
  assert.equal(second.games.at(-1).pregameLine.favoriteId, "b");
  assert.equal(second.games[0].pregameLine, undefined, "retry state must not manufacture missing-line evidence");
  t.mock.timers.tick(60001);
  await enrichPregameLines(board, signal, fetcher);
  assert.equal(calls.length, 25, "failed providers may recover on a later retry");
});

test("timed-out summaries rotate, while caller cancellation does not count as provider failure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const games = Array.from({ length: 5 }, (_, i) => game({ id: `slow-${i}` }));
  const calls = [];
  const fetcher = async (url, options) => {
    const id = new URL(url).searchParams.get("event"); calls.push(id);
    if (id === "slow-4") return Response.json(summary(games[4]));
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  };
  const board = scoreboard(games), canceled = new AbortController();
  const abandoned = enrichPregameLines(board, canceled.signal, fetcher);
  canceled.abort(); await abandoned;
  const first = enrichPregameLines(board, new AbortController().signal, fetcher);
  assert.deepEqual(calls.slice(4), calls.slice(0, 4), "caller cancellation should not penalize those providers");
  t.mock.timers.tick(1500); await first;
  const second = enrichPregameLines(board, new AbortController().signal, fetcher);
  await new Promise(setImmediate);
  t.mock.timers.tick(1500);
  const enriched = await second;
  assert.ok(calls.includes("slow-4")); assert.equal(enriched.games[4].pregameLine.favoriteId, "b");
});
