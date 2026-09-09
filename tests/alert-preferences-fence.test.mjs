import test from "node:test";
import assert from "node:assert/strict";
import { database, bundle, cdnFeed } from "./helpers.mjs";
import { fenceSql, stateIds } from "../scripts/alert-preferences-fence.mjs";

const owner = "cutover-11111111-1111-4111-8111-111111111111";
const other = "cutover-22222222-2222-4222-8222-222222222222";
function fixture(t) {
  const { db, sqlite } = database({ migrated: true });
  t.after(() => sqlite.close());
  sqlite.exec("INSERT INTO poll_state VALUES('next_poll',123),('last_good_score',456)");
  const run = (action, who = owner) => {
    // Execute the exact generated mutation, then its immediately following
    // changes() readback, as the operator does. Remaining statements are reads.
    const statements = fenceSql(action, who).trim().split(";").filter(s => s.trim());
    sqlite.exec(statements[0]);
    const changed = sqlite.prepare(statements[1]).get().changed_rows;
    for (const sql of statements.slice(2)) sqlite.prepare(sql).all();
    return changed;
  };
  const states = () => sqlite.prepare("SELECT * FROM poll_state ORDER BY id").all();
  const drain = () => sqlite.exec("UPDATE poll_lock SET expires_at=expires_at-17*60000");
  return { db, sqlite, run, states, drain };
}

test("operator acquisition never steals a live or expired row; release is owner-specific", t => {
  const { sqlite, run } = fixture(t);
  assert.equal(run("acquire"), 1);
  const lock = sqlite.prepare("SELECT * FROM poll_lock").get();
  assert.ok(lock.expires_at > Date.now() + 119 * 60000);
  assert.equal(run("acquire", other), 0);
  assert.equal(run("acquire"), 0, "retry cannot silently extend a lease");
  assert.equal(run("release", other), 0);
  assert.deepEqual(sqlite.prepare("SELECT * FROM poll_lock").get(), lock);
  sqlite.exec("UPDATE poll_lock SET expires_at=0");
  assert.equal(run("acquire", other), 0, "expired orphan requires normal poll reclamation");
  assert.equal(run("release"), 1);
});

test("overlapping normal poll cannot acquire or release the operator fence", t => {
  const { sqlite, run, states, drain } = fixture(t);
  run("acquire");
  const before = states();
  const now = Date.now();
  // Same acquisition and owner release as services/alerts/worker.ts.
  assert.equal(sqlite.prepare("INSERT INTO poll_lock(id,owner,expires_at) VALUES('scores',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE poll_lock.expires_at<=?").run("poll", now + 600000, now).changes, 0);
  assert.equal(sqlite.prepare("DELETE FROM poll_lock WHERE id='scores' AND owner=?").run("poll").changes, 0);
  assert.deepEqual(states(), before);
  assert.equal(run("activate"), 0, "activation refuses a fence before its minimum drain");
  drain();
  assert.equal(run("activate"), 4);
  assert.equal(run("activate"), 0, "enabled delivery cannot be blindly rebaselined");
});

for (const failure of ["absent lock", "lost owner", "expired lease", ...stateIds]) {
  test(`activation changes no rows with ${failure}`, t => {
    const { sqlite, run, states, drain } = fixture(t);
    run("acquire");
    drain();
    if (failure === "absent lock") sqlite.exec("DELETE FROM poll_lock");
    else if (failure === "lost owner") sqlite.prepare("UPDATE poll_lock SET owner=?").run(other);
    else if (failure === "expired lease") sqlite.exec("UPDATE poll_lock SET expires_at=CAST(strftime('%s','now') AS INTEGER)*1000");
    else sqlite.prepare("DELETE FROM poll_state WHERE id=?").run(failure);
    const before = states();
    assert.equal(run("activate"), 0);
    assert.deepEqual(states(), before, "no partial update or absent-row insertion");
  });
}

test("activation, pause and owner release preserve retained histories and durable marker", t => {
  const { sqlite, run, drain } = fixture(t);
  sqlite.exec(`INSERT INTO subscriptions VALUES('s','https://example.invalid','fake','fake','fake',1,1,1,1);
    INSERT INTO game_states VALUES('g','2026-09-09','{}',1);
    INSERT INTO alert_events VALUES('e','g','game:one-score-fourth','2026-09-09',1,'{}');
    INSERT INTO deliveries VALUES('e','s','failed',1);
    INSERT INTO rule_baselines VALUES('g','game:one-score-fourth',1);
    INSERT INTO alert_suppressions VALUES('s','g','game:one-score-fourth',1);`);
  const tables = ["subscriptions", "subscription_settings", "game_states", "alert_events", "deliveries", "rule_baselines", "alert_suppressions"];
  const history = () => tables.map(table => sqlite.prepare(`SELECT * FROM ${table}`).all());
  const before = history();
  assert.equal(run("acquire"), 1);
  drain();
  assert.equal(run("activate"), 4);
  for (const id of stateIds) assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id=?").get(id).value, id === "preferences_epoch" || id === "next_poll" ? 0 : 1);
  assert.equal(run("pause"), 1);
  assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='preferences_cutover_complete'").get().value, 1);
  assert.equal(run("release"), 1);
  assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, 456);
  assert.deepEqual(history(), before);
});

test("SQL generator rejects unsafe owners and unknown actions", () => {
  assert.throws(() => fenceSql("acquire", "'; DELETE FROM subscriptions;--"));
  assert.throws(() => fenceSql("renew", owner));
});

test("generated activation and release let the real poll establish a fresh no-replay baseline", async t => {
  const { poll } = await bundle("services/alerts/worker.ts");
  const { db, sqlite, run, drain } = fixture(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const now = Date.now();
  sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run("enabled-device", "https://push.example.invalid/intercepted", "invalid", "invalid", "owner", 0, 1, 1, 1);
  sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run("cutover-game:one-score-fourth", "cutover-game", "one-score-fourth", "retained-day", now - 60000, "{}");
  const eventsBefore = sqlite.prepare("SELECT * FROM alert_events").all();
  assert.equal(run("acquire"), 1);
  drain(); // Simulate elapsed time locally; production never alters the lease.
  const drainCompleted = now - 1000;
  assert.equal(run("activate"), 4);
  assert.equal(run("release"), 1);
  let scoreRequests = 0;
  globalThis.fetch = async input => {
    assert.equal(new URL(input).hostname, "cdn.espn.com", "All network is mocked; push transport must never be attempted");
    scoreRequests++;
    const feed = cdnFeed([{ id: "cutover-game", date: new Date(now - 60000).toISOString(),
      status: { period: 4, type: { state: "in", name: "STATUS_IN_PROGRESS" } },
      competitions: [{ competitors: ["a", "b"].map((id, i) => ({ id, homeAway: i ? "home" : "away", score: i ? "21" : "14", team: { id } })) }] }]);
    const entry = feed.content.sbData.leagues[0].calendar[0].entries[0];
    entry.startDate = new Date(now - 7 * 86400000).toISOString();
    entry.endDate = new Date(now + 7 * 86400000).toISOString();
    return Response.json(feed);
  };
  await poll({ DB: db, SITE_ORIGIN: "https://app.test", VAPID_PUBLIC_KEY: "invalid", VAPID_PRIVATE_KEY: "invalid" }, now);
  assert.equal(scoreRequests, 1);
  const epoch = sqlite.prepare("SELECT value FROM poll_state WHERE id='preferences_epoch'").get().value;
  assert.equal(epoch, now);
  assert.ok(epoch > drainCompleted);
  assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, epoch);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM deliveries").get().n, 0, "Existing event receives no delivery claim");
  assert.deepEqual(sqlite.prepare("SELECT * FROM alert_events").all(), eventsBefore);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM rule_baselines WHERE game_id='cutover-game' AND trigger='one-score-fourth'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM subscriptions WHERE active=1").get().n, 1);
});
