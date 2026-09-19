import test from "node:test";
import assert from "node:assert/strict";
import { bundle, database, game } from "./helpers.mjs";
const { deliver, saveGameStates } = await bundle("services/alerts/worker.ts");
const { conditions, transitions } = await bundle("services/alerts/rules.ts");
const now = Date.parse("2026-09-06T03:00Z");
function matchup(id, conferences = ["151", "15"], ranks = [null, null]) {
  const g = game({ id, period: 4, clock: 180 });
  g.teams.forEach((team, i) => Object.assign(team, { conferenceId: conferences[i], rank: ranks[i], rankKnown: true, score: i ? 21 : 27 }));
  return g;
}
function enroll(sqlite, id = "device") {
  // Invalid fixture keys fail before transport; no real device or notification.
  sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run(id, "invalid", "invalid", "invalid", "owner", 1, 1, 1, 1);
}
function event(sqlite, g, trigger = "one-score-fourth", created = now - 1) {
  sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run(`${g.id}:${trigger}`, g.id, trigger, "2026-09-05", created, "{}");
}
function deliveries(sqlite) { return sqlite.prepare("SELECT event_id FROM deliveries ORDER BY event_id").all().map(r => r.event_id); }

test("ORD-012 global pre-claim competition uses fresh live candidates and exact conference evidence", async () => {
  for (const [conference, rank, stronger] of [["1", null, true], ["4", null, true], ["5", null, true], ["8", null, true],
    ["9", null, false], [null, null, false], ["unknown", null, false], ["18", null, false], ["20", null, false], ["151", 20, true]]) {
    for (const reverse of [false, true]) {
      const { db, sqlite } = database();
      try {
        enroll(sqlite);
        const low = matchup(reverse ? "z-temple-toledo" : "a-temple-toledo");
        const other = matchup(reverse ? "a-other" : "z-other", [conference, conference], [rank, null]);
        const raw = transitions(null, low, now);
        assert.deepEqual(raw.map(e => e.id), [`${low.id}:one-score-fourth`]);
        assert.equal(conditions(low, now)["one-score-fourth"], true);
        event(sqlite, low); event(sqlite, other);
        await deliver({ DB: db }, now, reverse ? [other, low] : [low, other]);
        assert.equal(deliveries(sqlite).includes(`${low.id}:one-score-fourth`), !stronger, `${conference}/${rank}/${reverse}`);
        assert.ok(deliveries(sqlite).includes(`${other.id}:one-score-fourth`));
      } finally { sqlite.close(); }
    }
  }
});

test("ORD-012 ranked/unknown-rank/independent/FCS targets are never demoted as two unranked Group of Six", async () => {
  for (const variant of ["ranked", "unknown-rank", "independent", "fcs", "unknown-conference", "pac12"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite); const target = matchup("target"), strong = matchup("strong", ["5", "4"]);
      if (variant === "ranked") target.teams[0].rank = 20;
      if (variant === "unknown-rank") target.teams[0].rankKnown = false;
      if (variant === "independent") target.teams[0].conferenceId = "18";
      if (variant === "fcs") target.teams[0].conferenceId = "20";
      if (variant === "unknown-conference") target.teams[0].conferenceId = null;
      if (variant === "pac12") target.teams[0].conferenceId = "9";
      event(sqlite, target); event(sqlite, strong);
      await deliver({ DB: db }, now, [target, strong]);
      assert.equal(deliveries(sqlite).includes("target:one-score-fourth"), variant !== "pac12");
    } finally { sqlite.close(); }
  }
});

test("ORD-012 stale, missing, Duke, kickoff, final and no-longer-live competition cannot suppress", async () => {
  for (const variant of ["expired", "no-event", "duke", "kickoff", "final", "wide", "delayed", "missing-game"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite); const low = matchup("low"), strong = matchup("strong", ["1", "8"], [5, null]);
      event(sqlite, low);
      if (variant === "duke") strong.teams[0].id = "150";
      if (variant === "kickoff") Object.assign(strong, { state: "upcoming", started: false, date: new Date(now + 60000).toISOString() });
      if (variant === "final") { strong.state = "final"; strong.teams[0].score = 10; }
      if (variant === "wide") strong.teams[0].score = 49;
      if (variant === "delayed") strong.state = "delayed";
      if (variant !== "no-event") event(sqlite, strong, variant === "kickoff" ? "acc-kickoff" : variant === "final" ? "upset-final" : "one-score-fourth", variant === "expired" ? now - 180001 : now - 1);
      await deliver({ DB: db }, now, variant === "missing-game" ? [low] : [low, strong]);
      assert.ok(deliveries(sqlite).includes("low:one-score-fourth"), variant);
      if (variant === "duke") assert.deepEqual(deliveries(sqlite), ["low:one-score-fourth"]);
    } finally { sqlite.close(); }
  }
});

test("ORD-012 competition is global even for disabled or already-delivered stronger triggers", async () => {
  for (const variant of ["disabled", "accepted", "uncertain"]) {
    const { db, sqlite } = database();
    try {
      enroll(sqlite);
      const low = matchup("low"), strong = matchup("strong", ["9", "17"], [5, null]);
      strong.teams[0].score = 0; strong.teams[1].score = 21;
      assert.equal(conditions(strong, now)["ranked-trailing-fourth"], true, "supported meaningful upset need not be one score");
      event(sqlite, low); event(sqlite, strong, "ranked-trailing-fourth");
      if (variant === "disabled") sqlite.exec("UPDATE subscription_settings SET upset_watch=0");
      else sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run("strong:ranked-trailing-fourth", "device", variant, now - 10);
      await deliver({ DB: db }, now, [low, strong]);
      assert.equal(deliveries(sqlite).includes("low:one-score-fourth"), false);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM deliveries WHERE event_id='low:one-score-fourth'").get().n, 0);
    } finally { sqlite.close(); }
  }
});

test("ORD-012 immutable snapshot is decided before recipient processing and creates no skipped claim", async () => {
  const { db, sqlite } = database();
  try {
    enroll(sqlite); const low = matchup("z-low"), strong = matchup("a-strong", ["5", "4"]);
    event(sqlite, low); event(sqlite, strong);
    let mutated = false;
    const racing = { ...db, prepare(sql) {
      if (sql.startsWith("SELECT s.*,p.revision")) {
        mutated = true; strong.state = "final";
        sqlite.prepare("DELETE FROM alert_events WHERE game_id='a-strong'").run();
      }
      return db.prepare(sql);
    } };
    await deliver({ DB: racing }, now, [strong, low]);
    assert.equal(mutated, true);
    assert.deepEqual(deliveries(sqlite), ["a-strong:one-score-fourth"]);
    // With competition gone during the still-fresh window, the original event
    // remains available and its original timestamp/ID is unchanged.
    await deliver({ DB: db }, now + 1, [low]);
    assert.ok(deliveries(sqlite).includes("z-low:one-score-fourth"));
    assert.equal(sqlite.prepare("SELECT created_at FROM alert_events WHERE game_id='z-low'").get().created_at, now - 1);
  } finally { sqlite.close(); }
});

test("ORD-012 a priority-skipped event expires without refresh, replay or sibling claim", async () => {
  const { db, sqlite } = database();
  try {
    enroll(sqlite); const low = matchup("low"), strong = matchup("strong", ["5", "4"]);
    await saveGameStates(db, [low, strong], now - 1);
    await deliver({ DB: db }, now, [low, strong]);
    assert.equal(deliveries(sqlite).includes("low:one-score-fourth"), false);
    await saveGameStates(db, [low], now + 180001);
    await deliver({ DB: db }, now + 180001, [low]);
    assert.equal(deliveries(sqlite).includes("low:one-score-fourth"), false);
    assert.deepEqual({ ...sqlite.prepare("SELECT id,created_at FROM alert_events WHERE game_id='low'").get() }, { id: "low:one-score-fourth", created_at: now - 1 });
    assert.equal(sqlite.prepare("SELECT count(*) n FROM alert_suppressions WHERE game_id='low'").get().n, 0);
  } finally { sqlite.close(); }
});
