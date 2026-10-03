import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle, game } from "./helpers.mjs";
const { transitions } = await bundle("services/alerts/rules.ts");
const { normalizeScoreboard } = await bundle("lib/espn-data.ts");
const fixture = JSON.parse(readFileSync(new URL("fixtures/guide-2026-09-12.json", import.meta.url)));

// Issue #103: the body is the away line, the home line, then only a kickoff
// broadcast line when known.
// These are payload contracts only; they do not show how a Watch renders them.
const now = Date.parse("2026-09-06T02:40:00Z");
const live = (edit = () => {}) => { const g = game(); edit(g); return g; };
const oneScore = (g, at = now) => transitions(null, g, at).find(e => e.trigger === "one-score-fourth").payload;

test("every game trigger keeps its title, ID and URL and puts each team on its own line", () => {
  const upset = live(g => { g.teams[0].rank = 5; });
  assert.deepEqual(transitions(null, upset, now), ["one-score-fourth", "ranked-trailing-fourth"].map(trigger => ({
    id: `game1:${trigger}`, gameId: "game1", gameDay: "2026-09-05", trigger, createdAt: now,
    payload: {
      title: trigger === "one-score-fourth" ? "One-score game · 4th quarter" : "Upset watch · 4th quarter",
      body: "#5 Team a 14\n#20 Team b 21",
      eventId: `game1:${trigger}`, url: "/?date=2026-09-05#game-game1",
    },
  })));

  const final = { ...upset, state: "final" };
  assert.deepEqual(transitions({ game: upset, observedAt: now - 60000 }, final, now), [{
    id: "game1:upset-final", gameId: "game1", gameDay: "2026-09-05", trigger: "upset-final", createdAt: now,
    payload: { title: "Upset final", body: "#5 Team a 14\n#20 Team b 21", eventId: "game1:upset-final", url: "/?date=2026-09-05#game-game1" },
  }]);

  const upcoming = game({ state: "upcoming", period: 0, started: false }); upcoming.teams[0].conferenceId = "1";
  const reminder = Date.parse(upcoming.date) - 600000;
  assert.deepEqual(transitions({ game: upcoming, observedAt: reminder - 60000 }, upcoming, reminder), [{
    id: "game1:acc-kickoff", gameId: "game1", gameDay: "2026-09-05", trigger: "acc-kickoff", createdAt: reminder,
    payload: { title: "ACC kickoff in 10 minutes", body: "Team a\n#20 Team b\nESPN", eventId: "game1:acc-kickoff", url: "/?date=2026-09-05#game-game1" },
  }]);
});

test("only a valid known rank adds a #N prefix before the team name", () => {
  for (const [rank, rankKnown, line] of [[1, true, "#1 Team a 14"], [25, true, "#25 Team a 14"], [null, true, "Team a 14"], [null, false, "Team a 14"], [5, false, "Team a 14"], [26, true, "Team a 14"], [0, true, "Team a 14"]]) {
    assert.equal(oneScore(live(g => Object.assign(g.teams[0], { rank, rankKnown }))).body, `${line}\n#20 Team b 21`, `rank ${rank}, known ${rankKnown}`);
  }
});

test("one-score bodies are only the two team lines for margins, ties and overtime", () => {
  const cases = [
    [live(g => { g.teams[1].score = 22; }), "One-score game · 4th quarter", "Team a 14\n#20 Team b 22"],
    [live(g => { g.teams[1].score = 14; }), "One-score game · 4th quarter", "Team a 14\n#20 Team b 14"],
    [live(g => { g.period = 5; g.teams[0].score = 24; }), "One-score game · Overtime", "Team a 24\n#20 Team b 21"],
    [live(g => { g.period = 6; g.teams[1].score = 14; }), "One-score game · Overtime", "Team a 14\n#20 Team b 14"],
    [live(g => { g.teams[0].rank = 5; }), "One-score game · 4th quarter", "#5 Team a 14\n#20 Team b 21"],
  ];
  for (const [g, title, body] of cases) {
    assert.deepEqual([oneScore(g).title, oneScore(g).body], [title, body]);
    assert.equal(oneScore(g).body.split("\n").length, 2);
    // Upset watch carries the same two score lines.
    const watch = transitions(null, g, now).find(e => e.trigger === "ranked-trailing-fourth");
    if (watch) assert.equal(watch.payload.body, body);
  }
});

test("kickoff reminders omit scores and add only a nonempty broadcast line", () => {
  for (const [broadcast, body] of [["ESPN / ESPN+", "Team a\n#20 Team b\nESPN / ESPN+"], ["", "Team a\n#20 Team b"]]) {
    const g = game({ state: "upcoming", period: 0, started: false, broadcast }); g.teams[0].conferenceId = "1";
    const at = Date.parse(g.date) - 300000;
    const [event] = transitions({ game: g, observedAt: at - 360000 }, g, at);
    assert.deepEqual([event.payload.title, event.payload.body], ["ACC kickoff in 10 minutes", body]);
    assert.ok(!event.payload.body.endsWith("\n"));
  }
});

test("ESPN fixture names and long names are used in full, never replaced by abbreviations", () => {
  const board = normalizeScoreboard({ events: fixture.events }, "2026-09-12");
  const g = structuredClone(board.games.find(x => x.id === "401856782"));
  Object.assign(g, { state: "live", started: true, period: 4, clock: 120, pregameLine: undefined });
  g.teams[0].score = 24; g.teams[1].score = 27;
  assert.deepEqual(oneScore(g, Date.parse("2026-09-12T19:00:00Z")), {
    title: "One-score game · 4th quarter", body: "#6 Oregon 24\nOklahoma St 27",
    eventId: "401856782:one-score-fourth", url: "/?date=2026-09-12#game-401856782",
  });

  const long = "Southeastern Louisiana Lions of the Gulf South Conference";
  assert.equal(oneScore(live(g => { g.teams[0].name = long; })).body, `${long} 14\n#20 Team b 21`);
});
