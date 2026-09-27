import test from "node:test";
import assert from "node:assert/strict";
import { bundle, database, game } from "./helpers.mjs";

const { deliver, saveGameStates } = await bundle("services/alerts/worker.ts");
const { conditions, transitions } = await bundle("services/alerts/rules.ts");
const { normalizeScoreboard } = await bundle("lib/espn-data.ts");
const { classify } = await bundle("lib/football.ts");
const now = Date.parse("2026-09-27T02:00:00Z");

function enroll(sqlite) {
  // Invalid fixture keys fail before transport; no real device or notification.
  sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run("device", "invalid", "invalid", "invalid", "owner", 1, 1, 1, 1);
}
function event(sqlite, g, trigger = "one-score-fourth", created = now - 1) {
  sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run(`${g.id}:${trigger}`, g.id, trigger, "2026-09-26", created, "{}");
}
function events(sqlite) { return sqlite.prepare("SELECT id FROM alert_events ORDER BY id").all().map(row => row.id); }
function deliveries(sqlite) { return sqlite.prepare("SELECT event_id FROM deliveries ORDER BY event_id").all().map(row => row.event_id); }
function matchup(id, conferences = ["12", "37"], ranks = [null, null]) {
  const g = game({ id, date: "2026-09-27T00:00:00Z" });
  g.teams.forEach((team, i) => Object.assign(team, { conferenceId: conferences[i], rank: ranks[i], rankKnown: true, score: i ? 20 : 13 }));
  return g;
}
function sourceFixture(id, away, home, awayConference, homeConference, awayScore, homeScore, period) {
  // Constructed from the issue screenshot's Q4 scores and ESPN's Sep 26 final-board
  // rank/conference fields. This is not a captured fourth-quarter ESPN payload.
  const competitor = (teamId, abbreviation, conferenceId, score, homeAway) => ({
    id: teamId, homeAway, score: String(score), curatedRank: { current: 99 },
    team: { id: teamId, abbreviation, shortDisplayName: abbreviation, conferenceId },
  });
  const raw = { events: [{ id, date: "2026-09-27T00:00:00Z",
    status: { period, clock: 120, type: { name: "STATUS_IN_PROGRESS", state: "in" } },
    competitions: [{ competitors: [competitor(`${id}-away`, away, awayConference, awayScore, "away"),
      competitor(`${id}-home`, home, homeConference, homeScore, "home")] }],
  }] };
  return normalizeScoreboard(raw, "2026-09-26").games[0];
}

test("ORD-018 reported Group-of-Six games create no events or claims in Q4 or overtime, with or without competition", async () => {
  const reported = [
    sourceFixture("401871048", "MTSU", "JXST", "12", "12", 13, 20, 4),
    sourceFixture("401869931", "KENN", "ARST", "12", "37", 14, 14, 4),
  ];
  for (const g of reported) {
    assert.deepEqual(g.teams.map(t => [t.conferenceId, t.rank, t.rankKnown]),
      g.id === "401871048" ? [["12", null, true], ["12", null, true]] : [["12", null, true], ["37", null, true]]);
    assert.equal(classify(g).close, true, "game remains visible in the One score category");
    for (const period of [4, 5]) for (const competing of [false, true]) for (const reverse of [false, true]) {
      const { db, sqlite } = database();
      try {
        enroll(sqlite);
        const excluded = { ...g, period };
        const strong = matchup("ranked-power-four", ["5", "4"], [5, null]);
        assert.equal(conditions(excluded, now)["one-score-fourth"], false);
        assert.deepEqual(transitions(null, excluded, now), []);
        const games = competing ? reverse ? [strong, excluded] : [excluded, strong] : [excluded];
        const retained = await saveGameStates(db, games, now - 1);
        await deliver({ DB: db }, now, retained);
        assert.equal(events(sqlite).some(id => id.startsWith(`${g.id}:`)), false);
        assert.equal(deliveries(sqlite).some(id => id.startsWith(`${g.id}:`)), false);
        if (competing) assert.ok(events(sqlite).some(id => id.startsWith("ranked-power-four:")));
        if (competing) assert.ok(deliveries(sqlite).some(id => id.startsWith("ranked-power-four:")));
      } finally { sqlite.close(); }
    }
  }
});

test("ORD-018 exclusion covers every trigger, including previously recorded events", async () => {
  const triggers = Object.keys(conditions(matchup("excluded"), now));
  for (const state of ["live", "final", "upcoming"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite);
      const g = matchup("excluded");
      Object.assign(g, { state, period: state === "live" ? 5 : 0, started: state !== "upcoming" });
      assert.deepEqual(Object.values(conditions(g, now)), triggers.map(() => false));
      for (const trigger of triggers) event(sqlite, g, trigger);
      const retained = await saveGameStates(db, [g], now);
      await deliver({ DB: db }, now, retained);
      assert.deepEqual(deliveries(sqlite), []);
      assert.deepEqual(sqlite.prepare("SELECT trigger FROM rule_baselines ORDER BY trigger").all().map(row => row.trigger), [...triggers].sort());
    } finally { sqlite.close(); }
  }
});

test("ORD-018 all six Group-of-Six conference IDs exclude known-unranked games", async () => {
  for (const conference of ["151", "12", "15", "17", "9", "37"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite);
      const excluded = matchup(`excluded-${conference}`, [conference, "12"]);
      const retained = await saveGameStates(db, [excluded], now - 1);
      await deliver({ DB: db }, now, retained);
      assert.deepEqual(events(sqlite), [], conference);
      assert.deepEqual(deliveries(sqlite), [], conference);
    } finally { sqlite.close(); }
  }
});

test("ORD-018 ranked, Power Four and unknown-evidence games remain eligible without a slate priority hold", async () => {
  for (const variant of ["ranked", "power-four", "unknown-rank", "unknown-conference", "independent", "fcs", "unknown-id"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite);
      const eligible = matchup("eligible");
      if (variant === "ranked") eligible.teams[1].rank = 20;
      if (variant === "power-four") eligible.teams[0].conferenceId = "5";
      if (variant === "unknown-rank") eligible.teams[0].rankKnown = false;
      if (variant === "unknown-conference") eligible.teams[0].conferenceId = null;
      if (variant === "independent") eligible.teams[0].conferenceId = "18";
      if (variant === "fcs") eligible.teams[0].conferenceId = "20";
      if (variant === "unknown-id") eligible.teams[0].conferenceId = "unknown";
      const stronger = matchup("stronger", ["5", "4"], [5, null]);
      assert.equal(conditions(eligible, now)["one-score-fourth"], true, variant);
      const retained = await saveGameStates(db, [stronger, eligible], now - 1);
      await deliver({ DB: db }, now, retained);
      assert.ok(events(sqlite).includes("eligible:one-score-fourth"), variant);
      assert.ok(deliveries(sqlite).some(id => id.startsWith("eligible:")), variant);
      assert.ok(deliveries(sqlite).some(id => id.startsWith("stronger:")), variant);
    } finally { sqlite.close(); }
  }
  const duke = matchup("duke"); duke.teams[0].id = "150";
  assert.deepEqual(Object.values(conditions(duke, now)), Object.keys(conditions(duke, now)).map(() => false));
});

test("ORD-018 excluded queued event is terminal after evidence confirmation and cannot replay after slate changes", async () => {
  for (const baselineAge of ["production", "older-than-event"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite);
      const unknown = matchup("queued"); unknown.teams[0].rankKnown = false;
      const originalTime = now - 60000;
      await saveGameStates(db, [unknown], originalTime);
      assert.deepEqual(events(sqlite), ["queued:one-score-fourth"]);
      const known = matchup("queued");
      await saveGameStates(db, [known], now - 30000);
      assert.deepEqual(sqlite.prepare("SELECT game_id,trigger FROM rule_baselines").all().map(row => [row.game_id, row.trigger]), [["queued", "one-score-fourth"]]);
      if (baselineAge === "older-than-event") sqlite.prepare("UPDATE rule_baselines SET observed_at=? WHERE game_id='queued'").run(originalTime - 1000);
      assert.equal(sqlite.prepare("SELECT observed_at FROM rule_baselines WHERE game_id='queued'").get().observed_at,
        baselineAge === "production" ? now - 30000 : originalTime - 1000);
      assert.equal(sqlite.prepare("SELECT created_at FROM alert_events WHERE game_id='queued'").get().created_at, originalTime);
      const strong = matchup("other", ["5", "4"], [5, null]);
      const lostEvidence = matchup("queued"); lostEvidence.teams[0].rankKnown = false;
      await saveGameStates(db, [lostEvidence, strong], now - 20000);
      await deliver({ DB: db }, now - 20000, [lostEvidence, strong]);
      assert.ok(deliveries(sqlite).some(id => id.startsWith("other:")), baselineAge);
      await saveGameStates(db, [lostEvidence], now - 10000);
      await deliver({ DB: db }, now, [lostEvidence]);
      assert.equal(events(sqlite).filter(id => id.startsWith("queued:")).length, 1, baselineAge);
      assert.equal(deliveries(sqlite).includes("queued:one-score-fourth"), false, baselineAge);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM alert_suppressions WHERE game_id='queued'").get().n, 0, baselineAge);
      assert.equal(sqlite.prepare("SELECT created_at FROM alert_events WHERE game_id='queued'").get().created_at, originalTime, baselineAge);
    } finally { sqlite.close(); }
  }
});

test("ORD-018 a positive rank or conference correction creates the first valid event", async () => {
  for (const correction of ["ranked", "power-four"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite);
      const excluded = matchup("correction");
      await saveGameStates(db, [excluded], now - 60000);
      assert.deepEqual(events(sqlite), []);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM rule_baselines").get().n, 0);
      const corrected = matchup("correction");
      if (correction === "ranked") corrected.teams[1].rank = 25;
      if (correction === "power-four") corrected.teams[0].conferenceId = "5";
      const retained = await saveGameStates(db, [corrected], now - 1);
      await deliver({ DB: db }, now, retained);
      assert.ok(events(sqlite).includes("correction:one-score-fourth"), correction);
      assert.ok(deliveries(sqlite).some(id => id.startsWith("correction:")), correction);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM rule_baselines").get().n, 0);
    } finally { sqlite.close(); }
  }
});

test("ORD-018 loss of rank evidence permits a first event when none existed before", async () => {
  const { db, sqlite } = database();
  try {
    enroll(sqlite);
    await saveGameStates(db, [matchup("unknown-later")], now - 60000);
    assert.deepEqual(events(sqlite), []);
    const unknown = matchup("unknown-later"); unknown.teams[0].rankKnown = false;
    const retained = await saveGameStates(db, [unknown], now - 1);
    await deliver({ DB: db }, now, retained);
    assert.ok(events(sqlite).includes("unknown-later:one-score-fourth"));
    assert.ok(deliveries(sqlite).some(id => id.startsWith("unknown-later:")));
    assert.equal(sqlite.prepare("SELECT count(*) n FROM rule_baselines").get().n, 0);
  } finally { sqlite.close(); }
});
