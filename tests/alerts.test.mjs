import test from "node:test";
import assert from "node:assert/strict";
import { bundle, database, game } from "./helpers.mjs";
const rules = await bundle("services/alerts/rules.ts");
const push = await bundle("services/alerts/web-push.ts");
const { default: worker, claimDelivery } = await bundle("services/alerts/worker.ts");

test("alerts fire on transitions, include the start of Q4, and skip an initial baseline", () => {
  const now = Date.parse("2026-09-06T04:00:00Z"), g = game(); g.teams[0].rank = 5;
  assert.deepEqual(rules.transitions(null, g, now), []);
  const previous = { game: { ...g, period: 3 }, observedAt: now - 60000 };
  assert.deepEqual(rules.transitions(previous, g, now).map(e => e.trigger), ["one-score-fourth", "ranked-trailing-fourth"]);
  assert.deepEqual(rules.transitions({ game: g, observedAt: now - 60000 }, g, now), []);
  const final = { ...g, state: "final" };
  assert.deepEqual(rules.transitions({ game: g, observedAt: now - 60000 }, final, now).map(e => e.trigger), ["upset-final"]);
  assert.deepEqual(rules.transitions({ game: final, observedAt: now - 60000 }, final, now), []);
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
