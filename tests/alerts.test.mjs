import test from "node:test";
import assert from "node:assert/strict";
import { bundle, database, game } from "./helpers.mjs";
const rules = await bundle("services/alerts/rules.ts");
const push = await bundle("services/alerts/web-push.ts");
const { default: worker, claimDelivery, saveGameStates, poll } = await bundle("services/alerts/worker.ts");

test("poll fetches yesterday AND today, catches live games, and ignores first-seen finals", async () => {
  const { db, sqlite } = database();
  const originalFetch = globalThis.fetch;
  const now = Date.parse("2026-09-05T23:00:00Z");
  const event = (id, date, state) => ({ id, date, status: { period: 4, clock: 120, type: { name: state === "in" ? "STATUS_IN_PROGRESS" : "STATUS_FINAL", state, completed: state === "post" } }, competitions: [{ competitors: [{ id: "a", homeAway: "away", score: "14", curatedRank: { current: 5 }, team: { id: "a" } }, { id: "b", homeAway: "home", score: "21", curatedRank: { current: 99 }, team: { id: "b" } }] }] });
  let calls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input); calls++;
    assert.equal(url.hostname, "cdn.espn.com");
    assert.equal(url.searchParams.get("group"), "80");
    return Response.json({ content: { sbData: { events: [event("friday-final", "2026-09-05T01:00:00Z", "post"), event("saturday-live", "2026-09-05T22:00:00Z", "in"), event("saturday-final", "2026-09-05T16:00:00Z", "post"), event("outside-window", "2026-09-06T20:00:00Z", "in")] } } });
  };
  try {
    const env = { DB: db, SITE_ORIGIN: "https://app.test", VAPID_PUBLIC_KEY: "test-only", VAPID_PRIVATE_KEY: "test-only" };
    await poll(env, now);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM game_states").get().n, 3);
    assert.deepEqual(sqlite.prepare("SELECT id FROM alert_events ORDER BY id").all().map(row => row.id), ["saturday-live:one-score-fourth", "saturday-live:ranked-trailing-fourth"]);
    assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now);
    assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='next_poll'").get().value, now + 60000);
    await poll(env, now + 60000);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM alert_events").get().n, 2);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("poll falls back to the site API when the CDN feed is unavailable", async () => {
  const { db, sqlite } = database();
  const originalFetch = globalThis.fetch;
  const now = Date.parse("2026-09-05T23:00:00Z");
  const hosts = [];
  globalThis.fetch = async input => {
    const url = new URL(input); hosts.push(url.hostname);
    if (url.hostname === "cdn.espn.com") return new Response("Unavailable", { status: 503 });
    assert.equal(url.hostname, "site.api.espn.com");
    assert.equal(url.searchParams.get("dates"), "20260904-20260906");
    return Response.json({ events: [] });
  };
  try {
    await poll({ DB: db, SITE_ORIGIN: "https://app.test", VAPID_PUBLIC_KEY: "test-only", VAPID_PRIVATE_KEY: "test-only" }, now);
    assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com"]);
    assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("config explains each readiness gate without exposing private configuration", async () => {
  const { db, sqlite } = database();
  const now = Date.now();
  const env = { DB: db, SITE_ORIGIN: "https://app.test", VAPID_PUBLIC_KEY: "public-test", VAPID_PRIVATE_KEY: "private-test" };
  const read = async (configuration = env) => (await worker.fetch(new Request("https://alerts.test/config"), configuration)).json();
  const set = (id, value) => sqlite.prepare("INSERT INTO poll_state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(id, value);
  try {
    assert.equal((await read({ ...env, VAPID_PRIVATE_KEY: "" })).readinessReason, "missing-vapid-config");
    assert.equal((await read()).readinessReason, "awaiting-first-poll-tick");
    set("last_tick", now);
    assert.equal((await read()).readinessReason, "awaiting-first-successful-poll");
    set("last_good_score", now - 21 * 60000);
    assert.equal((await read()).readinessReason, "stale-score-feed");
    set("last_good_score", now);
    set("last_tick", now - 4 * 60000);
    assert.equal((await read()).readinessReason, "stale-poll-tick");
    set("last_tick", now);
    const config = await read();
    assert.equal(config.ready, true); assert.equal(config.readinessReason, "ready");
    assert.equal(config.version, "1.1.4");
    assert.equal(config.lastSuccessfulPollAt, new Date(now).toISOString());
    assert.equal(config.lastTickAt, new Date(now).toISOString());
    assert.ok(!JSON.stringify(config).includes("private-test"));
  } finally { sqlite.close(); }
});

test("a full Saturday fits D1 query limits and unchanged games preserve clock-based transitions", async () => {
  const { db, sqlite } = database();
  let queries = 0;
  const counted = { ...db, prepare(sql) { queries++; const statement = db.prepare(sql), bind = statement.bind; statement.bind = function (...args) { assert.ok(args.length <= 100); return bind.apply(this, args); }; return statement; } };
  const now = Date.parse("2026-09-06T02:00:00Z");
  const games = Array.from({ length: 200 }, (_, i) => game({ id: `game${i}`, state: "upcoming", period: 0, started: false, date: new Date(now + 11 * 60000).toISOString() }));
  games[0].teams[0].conferenceId = "1";
  await saveGameStates(counted, games, now);
  assert.ok(queries <= 10);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM game_states").get().n, 200);
  const writes = sqlite.prepare("SELECT total_changes() AS n").get().n;
  await saveGameStates(counted, games, now + 30000);
  assert.equal(sqlite.prepare("SELECT total_changes() AS n").get().n, writes);
  await saveGameStates(counted, games, now + 60000);
  assert.deepEqual(sqlite.prepare("SELECT trigger FROM alert_events").all().map(row => row.trigger), ["acc-kickoff"]);
  const afterKickoff = sqlite.prepare("SELECT total_changes() AS n").get().n;
  await saveGameStates(counted, games, now + 120000);
  assert.equal(sqlite.prepare("SELECT total_changes() AS n").get().n, afterKickoff);
  sqlite.close();
});

test("alerts catch up first-seen live Q4 games and keep finals transition-only", () => {
  const now = Date.parse("2026-09-06T04:00:00Z"), g = game(); g.teams[0].rank = 5;
  assert.deepEqual(rules.transitions(null, g, now).map(e => e.trigger), ["one-score-fourth", "ranked-trailing-fourth"]);
  assert.deepEqual(rules.transitions(null, { ...g, period: 3 }, now), []);
  const previous = { game: { ...g, period: 3 }, observedAt: now - 60000 };
  assert.deepEqual(rules.transitions(previous, g, now).map(e => e.trigger), ["one-score-fourth", "ranked-trailing-fourth"]);
  assert.deepEqual(rules.transitions({ game: g, observedAt: now - 60000 }, g, now), []);
  const final = { ...g, state: "final" };
  assert.deepEqual(rules.transitions(null, final, now), []);
  assert.deepEqual(rules.transitions({ game: g, observedAt: now - 60000 }, final, now).map(e => e.trigger), ["upset-final"]);
  assert.deepEqual(rules.transitions({ game: final, observedAt: now - 60000 }, final, now), []);
});
test("overtime includes ties and upsets with accurate titles and stable dedupe IDs", async () => {
  const now = Date.parse("2026-09-06T04:00:00Z"), g = game({ period: 5 }); g.teams[0].rank = 5;
  const first = rules.transitions(null, g, now);
  assert.deepEqual(first.map(e => e.trigger), ["one-score-fourth", "ranked-trailing-fourth"]);
  assert.ok(first.every(e => e.payload.title.endsWith("Overtime")));
  assert.deepEqual(rules.transitions({ game: { ...g, period: 4 }, observedAt: now - 60000 }, g, now), []);
  const tied = structuredClone(g); tied.period = 6; tied.teams[0].score = tied.teams[1].score;
  assert.deepEqual(rules.transitions(null, tied, now).map(e => e.trigger), ["one-score-fourth"]);
  assert.match(rules.transitions(null, tied, now)[0].payload.body, /Tied/);
  const wide = structuredClone(g); wide.teams[1].score = wide.teams[0].score + 9;
  assert.equal(rules.conditions(wide, now)["one-score-fourth"], false);
  const { db, sqlite } = database();
  await saveGameStates(db, [{ ...g, period: 4 }], now);
  await saveGameStates(db, [g], now + 60000);
  await saveGameStates(db, [wide], now + 120000);
  await saveGameStates(db, [tied], now + 180000);
  const events = sqlite.prepare("SELECT id FROM alert_events ORDER BY id").all().map(row => row.id);
  assert.deepEqual(events, [`${g.id}:one-score-fourth`, `${g.id}:ranked-trailing-fourth`]);
  sqlite.close();
});
test("ACC reminder crosses ten minutes and game windows poll every minute", () => {
  const g = game({ state: "upcoming", period: 0, started: false }); g.teams[0].conferenceId = "1";
  const now = Date.parse(g.date) - 600000;
  assert.deepEqual(rules.transitions({ game: g, observedAt: now - 60000 }, g, now).map(e => e.trigger), ["acc-kickoff"]);
  assert.equal(rules.nextPollAt([g], now), now + 60000);
  assert.equal(rules.nextPollAt([], now), now + 900000);
});
test("RFC 8291 published encryption example matches byte for byte", async () => {
  const receiver = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
  const sender = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const raw = push.decode(sender);
  const jwk = { kty: "EC", crv: "P-256", x: push.encode(raw.slice(1, 33)), y: push.encode(raw.slice(33)), d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const encrypted = await push.encrypt({ endpoint: "https://push.example.net/test", keys: { p256dh: receiver, auth: "BTBZMqHH6r4Tts7J_aSIgg" } }, "When I grow up, I want to be a watermelon", { key: { publicKey, privateKey }, salt: push.decode("DGv6ra1nlYgDCS1FRnbzlw") });
  assert.equal(push.encode(encrypted), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});
test("VAPID JWT has a valid signature, push-service audience and bounded expiration", async () => {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", key.privateKey);
  const now = Date.parse("2026-09-06T04:00:00Z");
  const header = await push.vapid("https://fcm.googleapis.com/abc", push.encode(raw), jwk.d, "https://saturday-signal.mtorbert.chatgpt.site", now);
  const token = /^vapid t=([^,]+)/.exec(header)[1], [h, p, signature] = token.split(".");
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key.publicKey, push.decode(signature), push.bytes(`${h}.${p}`)), true);
  const claims = JSON.parse(new TextDecoder().decode(push.decode(p)));
  assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.exp, now / 1000 + 43200);
});
test("SQL delivery claims and per-game trigger history reject duplicates", async () => {
  const { db, sqlite } = database();
  const results = await Promise.all(Array.from({ length: 20 }, () => claimDelivery(db, "game:one-score-fourth", "device", Date.now())));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await claimDelivery(db, "game:upset-final", "device", Date.now()), true);
  assert.equal(await claimDelivery(db, "game:one-score-fourth", "device2", Date.now()), true);
  sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run("event1", "game", "upset-final", "2026-09-05", 1, "{}");
  assert.throws(() => sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run("event2", "game", "upset-final", "2026-09-05", 2, "{}"), /UNIQUE/);
  sqlite.close();
});
test("subscriptions validate push keys, require device ownership, and honor opt-out", async () => {
  const { db, sqlite } = database();
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: push.encode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), auth: push.encode(crypto.getRandomValues(new Uint8Array(16))) } };
  assert.equal(await push.validSubscription({ ...sub, endpoint: "https://127.0.0.1/secrets" }), null);
  assert.equal(await push.validSubscription({ ...sub, endpoint: "https://fcm.googleapis.com.evil.test/push" }), null);
  const env = { DB: db, SITE_ORIGIN: "https://saturday-signal.mtorbert.chatgpt.site" };
  const request = (path, method, body, token) => new Request(`https://alerts.test${path}`, { method, headers: { Origin: env.SITE_ORIGIN, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = await worker.fetch(request("/subscriptions", "POST", { subscription: sub, kickoff: false }), env);
  assert.equal(response.status, 200); const credentials = await response.json();
  assert.equal((await worker.fetch(request("/subscriptions", "POST", { subscription: sub, kickoff: true }), env)).status, 409);
  const path = `/subscriptions/${credentials.id}`;
  assert.equal((await worker.fetch(request(path, "PATCH", { kickoff: true }, "wrong-token"), env)).status, 404);
  assert.equal((await worker.fetch(request(path, "PATCH", { kickoff: true }, credentials.token), env)).status, 200);
  assert.deepEqual(await (await worker.fetch(request(path, "GET", null, credentials.token), env)).json(), { active: true, kickoff: true });
  assert.equal((await worker.fetch(request(path, "DELETE", null, credentials.token), env)).status, 200);
  assert.equal((await (await worker.fetch(request(path, "GET", null, credentials.token), env)).json()).active, false);
  sqlite.close();
});
