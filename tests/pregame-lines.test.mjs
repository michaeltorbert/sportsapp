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
