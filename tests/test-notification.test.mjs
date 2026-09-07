import test from "node:test";
import { alertCdn } from "./fixtures/alert-cdn.mjs";
import assert from "node:assert/strict";
import { bundle, database, game } from "./helpers.mjs";
const { default: worker, poll } = await bundle("services/alerts/worker.ts");
const { hash } = await bundle("services/alerts/web-push.ts");

async function fixture(t) {
  const { db, sqlite } = database();
  t.after(() => sqlite.close());
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", vapid.publicKey)).toString("base64url");
  const privateKey = (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d;
  const env = { DB: db, SITE_ORIGIN: "https://old.test", ADDITIONAL_SITE_ORIGINS: "https://app.test", VAPID_SUBJECT: "https://old.test", VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey };
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = Buffer.from(await crypto.subtle.exportKey("raw", receiver.publicKey)).toString("base64url");
  const id = "a".repeat(43), other = "b".repeat(43), token = "ephemeral-device-owner";
  for (const [device, secret] of [[id, token], [other, "another-owner"]]) sqlite.prepare("INSERT INTO subscriptions(id,endpoint,p256dh,auth,token_hash,kickoff,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)").run(device, `https://web.push.apple.com/${device}`, p256dh, Buffer.from(auth).toString("base64url"), await hash(secret), 0, 1, 1);
  const request = (testId, overrides = {}) => worker.fetch(new Request(`https://alerts.test/subscriptions/${overrides.id || id}/test`, { method: overrides.method || "POST", headers: { "Content-Type": "application/json", ...(overrides.origin === null ? {} : { Origin: overrides.origin || "https://app.test" }), ...(overrides.token === null ? {} : { Authorization: `Bearer ${overrides.token || token}` }) }, ...(overrides.method === "GET" ? {} : { body: "rawBody" in overrides ? overrides.rawBody : JSON.stringify({ testId }) }) }), overrides.env || env);
  const original = globalThis.fetch;
  const calls = [];
  let response = 201;
  globalThis.fetch = async (url, init) => {
    if (new URL(url).hostname === "cdn.espn.com") return Response.json(alertCdn([], {
      startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
      endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    }));
    calls.push({ url, init });
    if (response === "transport") throw new TypeError("Simulated connection loss");
    return new Response(null, { status: response });
  };
  t.after(() => { globalThis.fetch = original; });
  return { sqlite, env, id, other, calls, receiver, auth, p256dh, request, respond: value => { response = value; } };
}
async function decodePayload(f, body) {
  const encrypted = Buffer.from(body), sender = encrypted.subarray(21, 21 + encrypted[20]);
  const publicKey = await crypto.subtle.importKey("raw", sender, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, f.receiver.privateKey, 256);
  const hmac = async (key, data) => crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data);
  const keyPrk = await hmac(f.auth, shared);
  const ikm = await hmac(keyPrk, Buffer.concat([Buffer.from("WebPush: info\0"), Buffer.from(f.p256dh, "base64url"), sender, Buffer.from([1])]));
  const prk = await hmac(encrypted.subarray(0, 16), ikm);
  const key = Buffer.from(await hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01"))).subarray(0, 16);
  const iv = Buffer.from(await hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01"))).subarray(0, 12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]), encrypted.subarray(21 + encrypted[20]));
  return JSON.parse(Buffer.from(plain).subarray(0, -1).toString());
}

test("device test requires exact origin, active ownership and valid UUID before any send", async t => {
  const f = await fixture(t), uuid = crypto.randomUUID();
  for (const options of [{ token: null }, { token: "wrong" }, { id: f.other }]) assert.equal((await f.request(uuid, options)).status, 404);
  for (const options of [{ origin: null }, { origin: "https://attacker.test" }]) assert.equal((await f.request(uuid, options)).status, 403);
  assert.equal((await f.request(uuid, { method: "GET" })).status, 404);
  for (const invalid of [null, "", "not-a-uuid", "../test", 42]) assert.equal((await f.request(invalid)).status, 400);
  for (const rawBody of [null, "null", "not-json", "[]"]) assert.equal((await f.request(uuid, { rawBody })).status, 400);
  assert.equal((await f.request(uuid, { env: { ...f.env, VAPID_PRIVATE_KEY: "" } })).status, 503);
  f.sqlite.prepare("UPDATE subscriptions SET active=0 WHERE id=?").run(f.id);
  assert.equal((await f.request(uuid)).status, 409);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM deliveries").get().n, 0);
});

test("one labeled encrypted test reaches only its owner, preserves game history, and cannot replay", async t => {
  const f = await fixture(t), testId = crypto.randomUUID(), now = Date.now();
  t.mock.method(Date, "now", () => now);
  const history = JSON.stringify(game({ id: "existing-game" }));
  f.sqlite.prepare("INSERT INTO game_states VALUES(?,?,?,?)").run("existing-game", "2026-09-05", history, now - 60000);
  f.sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run("existing-game:one-score-fourth", "existing-game", "one-score-fourth", "2026-09-05", now - 1, JSON.stringify({ title: "Simulated game alert", eventId: "existing-game:one-score-fourth" }));
  const first = await f.request(testId), result = await first.json();
  assert.equal(first.status, 200);
  assert.equal(result.testId, testId); assert.equal(result.attemptedAt, new Date(now).toISOString());
  assert.equal(result.status, "accepted"); assert.equal(result.attempted, true); assert.equal(result.receiptConfirmed, false);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, `https://web.push.apple.com/${f.id}`);
  assert.deepEqual(await decodePayload(f, f.calls[0].init.body), { title: "Saturday Signal: TEST", body: "This is a test notification, not a game alert. Tap to open Saturday Signal.", eventId: `test:${testId}`, url: "https://app.test/" });
  const replay = await (await f.request(testId)).json();
  assert.equal(replay.attempted, false); assert.equal(replay.status, "accepted");
  assert.equal((await f.request(crypto.randomUUID())).status, 429);
  assert.equal(f.sqlite.prepare("SELECT state_json FROM game_states").get().state_json, history);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM alert_events").get().n, 1);
  assert.deepEqual({ ...f.sqlite.prepare("SELECT * FROM deliveries").get() }, { event_id: `test:${testId}`, subscription_id: f.id, status: "accepted", attempted_at: now });
  await poll(f.env, now);
  await poll(f.env, now + 60000);
  assert.deepEqual(await Promise.all(f.calls.map(async c => (await decodePayload(f, c.init.body)).eventId)), [`test:${testId}`, "existing-game:one-score-fourth", "existing-game:one-score-fourth"]);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM deliveries").get().n, 3);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM alert_events").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT state_json FROM game_states").get().state_json, history);
});

for (const [code, expected, active] of [[404, "http-404", 0], [410, "http-410", 0], [503, "http-503", 1], ["transport", "uncertain", 1]]) {
  test(`device test ${code} keeps an immutable attempt and does not retry`, async t => {
    const f = await fixture(t), testId = crypto.randomUUID(); f.respond(code);
    const result = await (await f.request(testId)).json();
    assert.equal(result.status, expected); assert.equal(result.receiptConfirmed, false);
    assert.equal(f.sqlite.prepare("SELECT active FROM subscriptions WHERE id=?").get(f.id).active, active);
    assert.equal((await (await f.request(testId)).json()).status, expected);
    assert.equal(f.calls.length, 1);
  });
}

test("concurrent duplicate and distinct device tests claim at most one attempt", async t => {
  const f = await fixture(t), id = crypto.randomUUID();
  const responses = await Promise.all([f.request(id), f.request(id), f.request(crypto.randomUUID())]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM deliveries").get().n, 1);
  const bodies = await Promise.all(responses.map(r => r.json()));
  assert.equal(bodies.filter(x => x.attempted === true).length, 1);
  assert.ok(responses.every(r => [200, 202, 429].includes(r.status)));
  assert.ok(responses.filter(r => r.status === 429).length >= 1);
});

test("a pending or interrupted test claim returns 202 and cannot send again", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  f.sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run(`test:${testId}`, f.id, "claimed", Date.now() - 3600000);
  const response = await f.request(testId), body = await response.json();
  assert.equal(response.status, 202); assert.equal(body.status, "claimed"); assert.equal(body.attempted, false);
  assert.equal(f.calls.length, 0);
});

test("a failed expiry update cannot report clean persistence or permit a resend", async t => {
  const f = await fixture(t), testId = crypto.randomUUID(); f.respond(410);
  f.sqlite.exec("CREATE TRIGGER reject_expiry BEFORE UPDATE OF active ON subscriptions BEGIN SELECT RAISE(ABORT,'simulated D1 failure'); END;");
  const failed = await f.request(testId), failure = await failed.json();
  assert.equal(failed.status, 503);
  assert.equal(failure.testId, testId); assert.equal(failure.attempted, true);
  assert.equal(failure.status, "claimed"); assert.equal(failure.receiptConfirmed, false);
  assert.match(failure.error, /attempt was made.*Do not send another test/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM deliveries WHERE event_id=?").get(`test:${testId}`).status, "claimed");
  assert.equal(f.sqlite.prepare("SELECT active FROM subscriptions WHERE id=?").get(f.id).active, 1);
  const retry = await f.request(testId);
  assert.equal(retry.status, 202); assert.equal((await retry.json()).attempted, false);
  assert.equal(f.calls.length, 1);
});


test("cooldown and permanent UUID deduplication are isolated per device and expire at exactly one minute", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  assert.equal((await (await f.request(testId)).json()).attempted, true);
  assert.equal((await (await f.request(testId, { id: f.other, token: "another-owner" })).json()).attempted, true);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(c => c.url).sort(), [`https://web.push.apple.com/${f.id}`, `https://web.push.apple.com/${f.other}`].sort());
  now += 59999;
  assert.equal((await f.request(crypto.randomUUID())).status, 429);
  now += 1;
  assert.equal((await (await f.request(crypto.randomUUID())).json()).attempted, true);
  assert.equal((await (await f.request(testId)).json()).attempted, false);
  assert.equal(f.calls.length, 3);
});
