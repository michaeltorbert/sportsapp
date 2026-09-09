import test from "node:test";
import assert from "node:assert/strict";
import { bundle, database, game } from "./helpers.mjs";
const { meaningfulUpset, retainExpectation } = await bundle("services/alerts/expectation.ts");
const { conditions } = await bundle("services/alerts/rules.ts");
const { activationBaselines } = await bundle("services/alerts/preferences.ts");
const { default: worker, claimDelivery, saveGameStates, deliver } = await bundle("services/alerts/worker.ts");
const { hash } = await bundle("services/alerts/web-push.ts");
const now = Date.parse("2026-09-06T03:00Z");
const ranked = () => { const g = game(); g.teams[0].rank = 5; g.teams[1].rank = 20; return g; };

test("delivery gates all 16 selections, stale conditions, sibling attempts and rollout epochs", async () => {
  const { db, sqlite } = database();
  const env = { DB: db, SITE_ORIGIN: "https://app.test", VAPID_PUBLIC_KEY: "invalid-fixture", VAPID_PRIVATE_KEY: "invalid-fixture", VAPID_SUBJECT: "https://app.test" };
  const originalFetch = globalThis.fetch; let network = 0;
  globalThis.fetch = async () => { network++; throw Error("No real notification transport allowed"); };
  try {
    const live = ranked(); live.id = "live";
    const final = { ...ranked(), id: "final", state: "final", completed: true }; final.teams[0].score = 10; final.teams[1].score = 20;
    const kick = { ...ranked(), id: "kick", state: "upcoming", started: false, date: new Date(now + 60000).toISOString() }; kick.teams[0].conferenceId = "1";
    const list = [live, final, kick];
    for (const [id, trigger] of [["live", "one-score-fourth"], ["live", "ranked-trailing-fourth"], ["final", "upset-final"], ["kick", "acc-kickoff"]]) sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run(`${id}:${trigger}`, id, trigger, "2026-09-05", now - 1, "{}");
    for (let mask = 0; mask < 16; mask++) {
      sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run(String(mask), "https://push.example.test/intercepted", "invalid", "invalid", "owner", (mask >> 3) & 1, 1, 1, 1);
      sqlite.prepare("UPDATE subscription_settings SET close_game=?,upset_watch=?,upset_final=? WHERE subscription_id=?").run(mask & 1, (mask >> 1) & 1, (mask >> 2) & 1, String(mask));
    }
    await deliver(env, now, list);
    for (let mask = 0; mask < 16; mask++) {
      const ids = sqlite.prepare("SELECT event_id FROM deliveries WHERE subscription_id=? ORDER BY event_id").all(String(mask)).map(r => r.event_id);
      assert.deepEqual(ids, [...(mask & 4 ? ["final:upset-final"] : []), ...(mask & 8 ? ["kick:acc-kickoff"] : []), ...(mask & 2 ? ["live:ranked-trailing-fourth"] : mask & 1 ? ["live:one-score-fourth"] : [])]);
    }
    const count = sqlite.prepare("SELECT count(*) n FROM deliveries").get().n;
    await deliver(env, now + 1, list); assert.equal(sqlite.prepare("SELECT count(*) n FROM deliveries").get().n, count);
    sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run("later", "https://push.example.test/intercepted", "invalid", "invalid", "owner", 1, 1, 1, 1);
    await deliver(env, now, []); assert.equal(sqlite.prepare("SELECT count(*) n FROM deliveries WHERE subscription_id='later'").get().n, 0);
    for (const epoch of [0, now]) { sqlite.prepare("UPDATE poll_state SET value=? WHERE id='preferences_epoch'").run(epoch); await deliver(env, now, list); assert.equal(sqlite.prepare("SELECT count(*) n FROM deliveries WHERE subscription_id='later'").get().n, 0); }
    assert.equal(network, 0, "Invalid fixture keys must fail before transport");
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("release rollout preflight fails closed for old or paused services", async () => {
  const { checkRollout } = await import("../scripts/check-alert-preferences-rollout.mjs");
  for (const config of [null, {}, { ready: true }, { preferencesVersion: 1, ready: false }]) assert.throws(() => checkRollout(config));
  assert.doesNotThrow(() => checkRollout({ preferencesVersion: 1, ready: true }));
});

test("losing a settings revision cannot partially mutate active or kickoff", async () => {
  const { db, sqlite } = database();
  const id = "r".repeat(43), token = "owner", origin = "https://app.test";
  try {
    sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run(id, "endpoint", "p", "a", await hash(token), 1, 1, 1, 1);
    let raced = false;
    const racing = { ...db, async batch(statements) {
      if (!raced) { raced = true; sqlite.prepare("UPDATE subscription_settings SET revision=revision+1,close_game=0 WHERE subscription_id=?").run(id); }
      return db.batch(statements);
    } };
    const response = await worker.fetch(new Request(`https://alerts.test/subscriptions/${id}`, { method: "PATCH", headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ active: false, kickoff: false, revision: 0 }) }), { DB: racing, SITE_ORIGIN: origin });
    assert.equal(response.status, 409); assert.equal(raced, true);
    assert.deepEqual({ ...sqlite.prepare("SELECT active,kickoff FROM subscriptions").get() }, { active: 1, kickoff: 1 });
    assert.deepEqual({ ...sqlite.prepare("SELECT close_game,revision FROM subscription_settings").get() }, { close_game: 0, revision: 1 });
  } finally { sqlite.close(); }
});

test("post-claim type disable changes revision and suppresses before transport", async () => {
  const { db, sqlite } = database(); let guarded = false, network = 0;
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { network++; throw Error("No actual transport"); };
  try {
    sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run("device", "endpoint", "p", "a", "owner", 0, 1, 1, 1);
    sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run("game1:ranked-trailing-fourth", "game1", "ranked-trailing-fourth", "2026-09-05", now - 1, "{}");
    const racing = { ...db, prepare(sql) {
      if (sql.startsWith("SELECT s.id FROM subscriptions s JOIN subscription_settings")) { guarded = true; sqlite.exec("UPDATE subscription_settings SET upset_watch=0,revision=revision+1"); }
      return db.prepare(sql);
    } };
    await deliver({ DB: racing }, now, [ranked()]);
    assert.equal(guarded, true); assert.equal(network, 0);
    assert.equal(sqlite.prepare("SELECT status FROM deliveries").get().status, "suppressed");
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("disabled at enrollment does not consume a condition before later enable", async () => {
  const { db, sqlite } = database();
  const origin = "https://app.test", env = { DB: db, SITE_ORIGIN: origin };
  let time = now;
  const originalNow = Date.now; Date.now = () => time;
  try {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/enrollment", keys: { p256dh: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"), auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } };
    const registration = await worker.fetch(new Request("https://alerts.test/subscriptions", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ subscription, kickoff: false }) }), env);
    assert.equal(registration.status, 200); const credentials = await registration.json();
    assert.equal(sqlite.prepare("SELECT pending FROM subscription_settings").get().pending, 2);
    await activationBaselines(db, [ranked()], ++time);
    assert.deepEqual(sqlite.prepare("SELECT trigger FROM alert_suppressions").all().map(r => r.trigger), ["ranked-trailing-fourth"]);
    const exited = ranked(); exited.teams[0].score = 50; exited.teams[1].score = 0;
    await activationBaselines(db, [exited], ++time);
    const response = await worker.fetch(new Request(`https://alerts.test/subscriptions/${credentials.id}`, { method: "PATCH", headers: { Origin: origin, Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ closeGame: true }) }), env);
    assert.equal(response.status, 200);
    assert.equal(sqlite.prepare("SELECT pending FROM subscription_settings").get().pending, 1);
    await activationBaselines(db, [exited], ++time);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM alert_suppressions WHERE trigger='one-score-fourth'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT pending FROM subscription_settings").get().pending, 0);
  } finally { Date.now = originalNow; sqlite.close(); }
});

test("selective upset policy covers tied/behind/ahead, near peers, valid rank fallback and late states", () => {
  for (const deficit of [-21, -1, 0, 1, 8, 9]) {
    const g = ranked(); g.teams[0].score = 30; g.teams[1].score = 30 - deficit;
    assert.equal(meaningfulUpset(g), deficit <= 8);
  }
  for (const gap of [1, 9, 10]) { const g = ranked(); g.teams[1].rank = 5 + gap; assert.equal(meaningfulUpset(g), gap >= 10); }
  for (const rankKnown of [undefined, false, true]) { const g = ranked(); g.teams[1].rank = null; g.teams[1].rankKnown = rankKnown; assert.equal(meaningfulUpset(g), rankKnown === true); }
  for (const rank of [0, 26, 5.5]) { const g = ranked(); g.teams[0].rank = rank; assert.equal(meaningfulUpset(g), false); }
  for (const period of [3, 4, 5, 4.5]) for (const intermission of [true, false]) {
    const g = { ...ranked(), period, intermission, clockKnown: false };
    assert.equal(conditions(g, now)["ranked-trailing-fourth"], period === 4 || period === 5);
  }
  for (const state of ["delayed", "upcoming", "other", "final"]) assert.equal(conditions({ ...ranked(), state }, now)["ranked-trailing-fourth"], false);
  for (const score of [null, NaN, Infinity, -1]) { const g = ranked(); g.teams[0].score = score; assert.equal(meaningfulUpset(g), false); }
});

test("pregame expectation persists with identity, ambiguity and live-odds guards", async () => {
  const g = ranked();
  const pre = { ...g, state: "upcoming", started: false, period: 0, pregameLine: { favoriteId: "a", spread: 7, source: "fixture" } };
  const stored = retainExpectation(pre, undefined, now);
  const live = retainExpectation(g, stored, now + 1);
  assert.equal(meaningfulUpset(live), true);
  assert.deepEqual(retainExpectation(g, live, now + 2).alertExpectation, live.alertExpectation);
  for (const spread of [1, 6.5, 7]) assert.equal(meaningfulUpset(retainExpectation(g, retainExpectation({ ...pre, pregameLine: { ...pre.pregameLine, spread } }, undefined, now), now + 1)), spread >= 7);
  const pick = retainExpectation({ ...pre, pregameLine: { favoriteId: null, spread: 0, source: "fixture" } }, undefined, now);
  assert.equal(meaningfulUpset(retainExpectation(g, pick, now + 1)), false);
  const conflict = retainExpectation({ ...pre, pregameLine: undefined, pregameEvidenceInvalid: true }, stored, now + 1);
  assert.equal(conflict.alertExpectation.state, "invalid");
  assert.equal(meaningfulUpset(retainExpectation(g, conflict, now + 2)), false);
  assert.equal(retainExpectation({ ...g, date: "2026-09-07T03:00Z" }, live, now + 2).alertExpectation.state, "absent");
  const changed = structuredClone(g); changed.teams[0].id = "replacement";
  assert.equal(retainExpectation(changed, live, now + 2).alertExpectation.state, "absent");
  const unrankedFavorite = structuredClone(g); unrankedFavorite.teams[0].rank = null;
  assert.equal(meaningfulUpset(retainExpectation(unrankedFavorite, stored, now + 1)), false);
  const liveOdds = retainExpectation({ ...g, pregameLine: pre.pregameLine }, undefined, now);
  assert.equal(liveOdds.alertExpectation.state, "absent");
  const { db, sqlite } = database();
  try { await saveGameStates(db, [pre], now); await saveGameStates(db, [g], now + 1); const saved = JSON.parse(sqlite.prepare("SELECT state_json FROM game_states").get().state_json); assert.equal(saved.alertExpectation.line.spread, 7); }
  finally { sqlite.close(); }
});

test("fresh activation baseline is durable and cannot baseline a future activation", async () => {
  const { db, sqlite } = database();
  try {
    sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run("device", "endpoint", "p", "a", "hash", 1, 1, 0, 0);
    sqlite.exec(`UPDATE subscription_settings SET pending=3,close_since=${now},upset_since=${now}`);
    await activationBaselines(db, [ranked()], now);
    assert.equal(sqlite.prepare("SELECT pending FROM subscription_settings").get().pending, 3);
    await activationBaselines(db, [ranked()], now + 1);
    assert.equal(sqlite.prepare("SELECT pending FROM subscription_settings").get().pending, 0);
    assert.deepEqual(sqlite.prepare("SELECT trigger FROM alert_suppressions ORDER BY trigger").all().map(r => r.trigger), ["one-score-fourth", "ranked-trailing-fourth"]);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM deliveries").get().n, 0);
    await activationBaselines(db, [], now + 2);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM alert_suppressions").get().n, 2);
  } finally { sqlite.close(); }
});

test("migration baseline suppresses current broad rules without erasing history", async () => {
  const { db, sqlite } = database({ migrated: true });
  try {
    sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run("old:ranked-trailing-fourth", "device", "uncertain", 10);
    await saveGameStates(db, [ranked()], now, true);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM alert_events").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM rule_baselines").get().n, 2);
    assert.equal(sqlite.prepare("SELECT status FROM deliveries").get().status, "uncertain");
    assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='preferences_delivery_enabled'").get().value, 0);
  } finally { sqlite.close(); }
});

test("atomic sibling claims include every legacy status and keep finals separate", async () => {
  const { db, sqlite } = database();
  try {
    for (const status of ["claimed", "accepted", "uncertain", "http-503", "http-410"]) {
      sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run(`${status}:one-score-fourth`, "device", status, now);
      assert.equal(await claimDelivery(db, `${status}:ranked-trailing-fourth`, "device", now), false);
      assert.equal(await claimDelivery(db, `${status}:upset-final`, "device", now), true);
    }
    const claimed = await Promise.all(Array.from({ length: 20 }, (_, i) => claimDelivery(db, `parallel:${i % 2 ? "ranked-trailing-fourth" : "one-score-fourth"}`, "device", now)));
    assert.equal(claimed.filter(Boolean).length, 1);
  } finally { sqlite.close(); }
});

test("all preference combinations, authorization, revisions, grandfathering and master retention", async () => {
  const { db, sqlite } = database();
  const token = "fixture-owner", id = "a".repeat(43), origin = "https://app.test", env = { DB: db, SITE_ORIGIN: origin };
  sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run(id, "endpoint", "p", "a", await hash(token), 1, 1, 0, 0);
  const request = (method, body, owner = token, site = origin) => worker.fetch(new Request(`https://alerts.test/subscriptions/${id}`, { method, headers: { Origin: site, Authorization: `Bearer ${owner}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  try {
    let current = await (await request("GET")).json(); assert.equal(current.closeGame, true); assert.equal(current.upsetFinal, true);
    for (let mask = 0; mask < 16; mask++) {
      const patch = Object.fromEntries(["closeGame", "upsetWatch", "upsetFinal", "kickoff"].map((k, i) => [k, !!(mask & (1 << i))]));
      const r = await request("PATCH", { ...patch, revision: current.revision }); assert.equal(r.status, 200); current = await r.json();
      for (const key of Object.keys(patch)) assert.equal(current[key], patch[key]);
    }
    assert.equal((await request("PATCH", { active: false, revision: current.revision })).status, 200);
    const off = await (await request("GET")).json(); assert.equal(off.active, false); assert.equal(off.upsetWatch, true);
    assert.equal((await request("PATCH", { kickoff: false })).status, 200); // Old client.
    assert.equal((await request("PATCH", { active: true, revision: 0 })).status, 409);
    for (const bad of [{}, { closeGame: 1 }, { unknown: true }, { revision: 2 }]) assert.equal((await request("PATCH", bad)).status, 400);
    assert.equal((await request("PATCH", { active: true }, "wrong")).status, 404);
    assert.equal((await request("PATCH", { active: true }, token, "https://evil.test")).status, 403);
    const fresh = await (await request("GET")).json();
    assert.equal((await request("PATCH", { active: true, revision: fresh.revision })).status, 200);
    const settings = sqlite.prepare("SELECT * FROM subscription_settings").get(); assert.ok(settings.pending); assert.ok(settings.upset_since > 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM subscriptions").get().n, 1);
  } finally { sqlite.close(); }
});
