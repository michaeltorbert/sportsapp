import test from "node:test";
import assert from "node:assert/strict";
import { bundle, database } from "./helpers.mjs";
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
  for (const [device, secret] of [[id, token], [other, "another-owner"]]) sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,1,?,?)").run(device, `https://web.push.apple.com/${device}`, p256dh, Buffer.from(auth).toString("base64url"), await hash(secret), 0, 1, 1);
  const request = (testId, overrides = {}) => worker.fetch(new Request(`https://alerts.test/subscriptions/${overrides.id || id}/test`, { method: overrides.method || "POST", headers: { "Content-Type": "application/json", ...(overrides.origin === null ? {} : { Origin: overrides.origin || "https://app.test" }), ...(overrides.token === null ? {} : { Authorization: `Bearer ${overrides.token || token}` }) }, ...(overrides.method === "GET" ? {} : { body: JSON.stringify({ testId }) }) }), overrides.env || env);
  const original = globalThis.fetch;
  const calls = [];
  let response = 201;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("espn.com")) return Response.json({ events: [] });
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
  assert.equal((await f.request(uuid, { env: { ...f.env, VAPID_PRIVATE_KEY: "" } })).status, 503);
  f.sqlite.prepare("UPDATE subscriptions SET active=0 WHERE id=?").run(f.id);
  assert.equal((await f.request(uuid)).status, 409);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM deliveries").get().n, 0);
});

test("one labeled encrypted test reaches only its owner, preserves game history, and cannot replay", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  const first = await f.request(testId), result = await first.json();
  assert.equal(first.status, 200);
  assert.equal(result.status, "accepted"); assert.equal(result.attempted, true); assert.equal(result.receiptConfirmed, false);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, `https://web.push.apple.com/${f.id}`);
  assert.deepEqual(await decodePayload(f, f.calls[0].init.body), { title: "Saturday Signal: TEST", body: "This is a test notification, not a game alert. Tap to open Saturday Signal.", eventId: `test:${testId}`, url: "https://app.test/" });
  const replay = await (await f.request(testId)).json();
  assert.equal(replay.attempted, false); assert.equal(replay.status, "accepted");
  assert.equal((await f.request(crypto.randomUUID())).status, 429);
  await poll(f.env);
  assert.equal(f.calls.length, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM deliveries").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM alert_events").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM game_states").get().n, 0);
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
  assert.equal(responses.filter(r => r.status === 429).length, 1);
});
