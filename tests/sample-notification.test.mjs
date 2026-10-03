import test from "node:test";
import assert from "node:assert/strict";
import { bundle, cdnFeed, database, game } from "./helpers.mjs";
const { default: worker, SAMPLE_DELAY_MS } = await bundle("services/alerts/worker.ts");
const { alertText, transitions } = await bundle("services/alerts/rules.ts");
const { sampleText, samplePayload } = await bundle("services/alerts/sample.ts");
const { hash } = await bundle("services/alerts/web-push.ts");

// Issue #103 sample route. Every credential, key and endpoint below is a local
// throwaway fixture. All transport is intercepted; no provider is contacted.
const start = Date.parse("2026-09-05T23:00:00Z");
async function fixture(t, { db: wrap } = {}) {
  const { db, sqlite } = database();
  t.after(() => sqlite.close());
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", vapid.publicKey)).toString("base64url");
  const privateKey = (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d;
  const env = { DB: wrap ? wrap(db) : db, SITE_ORIGIN: "https://old.test", ADDITIONAL_SITE_ORIGINS: "https://app.test", VAPID_SUBJECT: "https://old.test", VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey };
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = Buffer.from(await crypto.subtle.exportKey("raw", receiver.publicKey)).toString("base64url");
  const id = "a".repeat(43), other = "b".repeat(43), token = "fixture-owner-token";
  for (const [device, secret] of [[id, token], [other, "fixture-other-owner"]]) sqlite.prepare("INSERT INTO subscriptions(id,endpoint,p256dh,auth,token_hash,kickoff,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)").run(device, `https://web.push.apple.com/${device}`, p256dh, Buffer.from(auth).toString("base64url"), await hash(secret), 0, 1, 1);
  const tasks = [], ctx = { waitUntil(promise) { tasks.push(promise); } };
  const call = (path, { method = "POST", body, rawBody, origin, token: owner, ctx: context = ctx, env: configuration = env } = {}) => worker.fetch(new Request(`https://alerts.test${path}`, {
    method, headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin || "https://app.test" }), ...(owner === null ? {} : { Authorization: `Bearer ${owner || token}` }) },
    ...(method === "GET" ? {} : { body: rawBody ?? JSON.stringify(body) }),
  }), configuration, context === null ? undefined : context);
  const sample = (testId, options = {}) => call(`/subscriptions/${options.id || id}/test`, { body: { testId, sample: "one-score" }, ...options });
  const generic = (testId, options = {}) => call(`/subscriptions/${options.id || id}/test`, { body: { testId }, ...options });
  const read = (testId, options = {}) => call(`/subscriptions/${options.id || id}/test/${testId}`, { method: "GET", ...options });
  const original = globalThis.fetch;
  const calls = [];
  let response = 201, during = () => {};
  globalThis.fetch = async (url, init) => {
    const host = new URL(url).hostname;
    if (host === "cdn.espn.com") return Response.json(cdnFeed());
    assert.equal(host, "web.push.apple.com", "Unexpected destination must not escape interception");
    calls.push({ url, init });
    during();
    if (response === "transport") throw new TypeError("Simulated connection loss");
    return new Response(null, { status: response });
  };
  t.after(() => { globalThis.fetch = original; });
  let now = start;
  t.mock.method(Date, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return {
    sqlite, env, id, other, token, calls, tasks, receiver, auth, p256dh, sample, generic, read, call,
    respond: (value, hook = () => {}) => { response = value; during = hook; },
    advance: ms => { now += ms; },
    // Wake the delayed task on the same clock and wait for its completion.
    async wake(elapsed = SAMPLE_DELAY_MS) { now += elapsed; t.mock.timers.tick(SAMPLE_DELAY_MS); await Promise.all(tasks); },
    rows: () => sqlite.prepare("SELECT * FROM deliveries ORDER BY event_id").all().map(row => ({ ...row })),
  };
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

test("real game payloads use the shared formatter byte for byte", () => {
  const now = Date.parse("2026-09-06T02:40:00Z");
  const upset = game(); upset.teams[0].rank = 5;
  const overtime = game({ period: 5 }); overtime.teams[0].score = 21;
  const final = { ...upset, state: "final" };
  const kickoff = game({ state: "upcoming", period: 0, started: false, broadcast: "ESPN / ESPN+" }); kickoff.teams[0].conferenceId = "1";
  const reminder = Date.parse(kickoff.date) - 600000, seen = new Set();
  for (const [previous, g, at] of [[null, upset, now], [null, overtime, now], [{ game: upset, observedAt: now - 60000 }, final, now], [{ game: kickoff, observedAt: reminder - 60000 }, kickoff, reminder]]) {
    for (const event of transitions(previous, g, at)) {
      seen.add(event.trigger);
      assert.equal(JSON.stringify(event.payload), JSON.stringify({ ...alertText(g, event.trigger), eventId: `game1:${event.trigger}`, url: "/?date=2026-09-05#game-game1" }));
    }
  }
  assert.deepEqual([...seen].sort(), ["acc-kickoff", "one-score-fourth", "ranked-trailing-fourth", "upset-final"]);
});

test("the sample is the fixed synthetic one-score format with a test event ID and root URL", () => {
  assert.deepEqual({ ...sampleText }, { title: "SAMPLE · One-score game · 4th quarter", body: "#21 Western Kentucky 24\n#4 Coastal Carolina 27" });
  assert.ok(Object.isFrozen(sampleText));
  // The same teams through a real one-score transition produce identical lines.
  const real = game(); Object.assign(real.teams[0], { name: "Western Kentucky", rank: 21, score: 24 }); Object.assign(real.teams[1], { name: "Coastal Carolina", rank: 4, score: 27 });
  const event = transitions(null, real, Date.parse("2026-09-06T02:40:00Z")).find(e => e.trigger === "one-score-fourth");
  assert.equal(sampleText.title, `SAMPLE · ${event.payload.title}`);
  assert.equal(sampleText.body, event.payload.body);
  const testId = "6f1c7b8e-3c1a-4d2b-9e4f-0a1b2c3d4e5f";
  assert.equal(JSON.stringify(samplePayload(testId, "https://app.test")), JSON.stringify({ title: sampleText.title, body: sampleText.body, eventId: `test:${testId}`, url: "https://app.test/" }));
});

test("sample selector and body are exact before any claim", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  for (const body of [{ testId, sample: "generic" }, { testId, sample: null }, { testId, sample: "ONE-SCORE" }, { testId, sample: ["one-score"] }, { testId, sample: "one-score", extra: true }, { testId, sample: "one-score", title: "custom" }, { testId: "not-a-uuid", sample: "one-score" }, { sample: "one-score" }]) {
    assert.equal((await f.call(`/subscriptions/${f.id}/test`, { body })).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(f.rows(), []); assert.equal(f.tasks.length, 0); assert.equal(f.calls.length, 0);
});

test("wrong owner, origin, inactive device, missing settings or no execution context claim and send nothing", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  for (const options of [{ token: null }, { token: "wrong" }, { id: f.other }]) assert.equal((await f.sample(testId, options)).status, 404);
  for (const options of [{ origin: null }, { origin: "https://attacker.test" }]) assert.equal((await f.sample(testId, options)).status, 403);
  for (const ctx of [null, {}, { waitUntil: "no" }]) assert.equal((await f.sample(testId, { ctx })).status, 503);
  assert.equal((await f.sample(testId, { env: { ...f.env, VAPID_PRIVATE_KEY: "" } })).status, 503);
  f.sqlite.prepare("DELETE FROM subscription_settings WHERE subscription_id=?").run(f.id);
  assert.equal((await f.sample(testId)).status, 409);
  f.sqlite.prepare("INSERT INTO subscription_settings(subscription_id) VALUES(?)").run(f.id);
  f.sqlite.prepare("UPDATE subscriptions SET active=0 WHERE id=?").run(f.id);
  assert.equal((await f.sample(testId)).status, 409);
  await f.wake();
  assert.deepEqual(f.rows(), []); assert.equal(f.tasks.length, 0); assert.equal(f.calls.length, 0);
});

test("a durable scheduled claim precedes one delayed send; game tables never change", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  const history = JSON.stringify(game({ id: "existing-game" }));
  f.sqlite.prepare("INSERT INTO game_states VALUES(?,?,?,?)").run("existing-game", "2026-09-05", history, start - 60000);
  f.sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)").run("existing-game:one-score-fourth", "existing-game", "one-score-fourth", "2026-09-05", start - 1, "{}");
  const tables = () => ["game_states", "alert_events", "rule_baselines", "alert_suppressions", "poll_state", "subscription_settings"].map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all());
  const before = JSON.stringify(tables());
  const response = await f.sample(testId);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { testId, sample: "one-score", status: "scheduled", attempted: false, attemptHistory: "none", scheduledAt: new Date(start).toISOString(), receiptConfirmed: false });
  assert.deepEqual(f.rows(), [{ event_id: `test:${testId}`, subscription_id: f.id, status: "sample:scheduled", attempted_at: start }]);
  assert.equal(f.calls.length, 0); assert.equal(f.tasks.length, 1);
  const pending = await f.read(testId);
  assert.equal(pending.status, 202);
  assert.deepEqual(await pending.json(), { testId, sample: "one-score", status: "scheduled", attempted: false, attemptHistory: "pending", scheduledAt: new Date(start).toISOString(), receiptConfirmed: false, overdue: false });
  t.mock.timers.tick(SAMPLE_DELAY_MS - 1); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 0);
  await f.wake();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `https://web.push.apple.com/${f.id}`);
  assert.deepEqual(await decodePayload(f, f.calls[0].init.body), { title: "SAMPLE · One-score game · 4th quarter", body: "#21 Western Kentucky 24\n#4 Coastal Carolina 27", eventId: `test:${testId}`, url: "https://app.test/" });
  assert.equal(f.rows()[0].status, "sample:accepted");
  const done = await f.read(testId);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { testId, sample: "one-score", status: "accepted", attempted: false, attemptHistory: "attempted", scheduledAt: new Date(start).toISOString(), receiptConfirmed: false });
  const replay = await f.sample(testId);
  assert.equal(replay.status, 200); assert.equal((await replay.json()).status, "accepted");
  await f.wake();
  assert.equal(f.calls.length, 1); assert.equal(f.tasks.length, 1);
  assert.equal(JSON.stringify(tables()), before);
});

test("one UUID never sends a second kind, initially or in a concurrent claim", async t => {
  const f = await fixture(t), first = crypto.randomUUID(), second = crypto.randomUUID();
  assert.equal((await f.generic(first)).status, 200);
  const conflict = await f.sample(first);
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "test-kind-conflict");
  assert.equal((await f.read(first)).status, 409);
  f.advance(60000);
  assert.equal((await f.sample(second)).status, 202);
  assert.equal((await f.generic(second)).status, 409);
  await f.wake();
  assert.deepEqual(await Promise.all(f.calls.map(async c => (await decodePayload(f, c.init.body)).title)), ["Saturday Signal: TEST", "SAMPLE · One-score game · 4th quarter"]);
  assert.deepEqual(f.rows().map(row => row.status).sort(), ["accepted", "sample:accepted"]);

  f.advance(60000);
  const race = crypto.randomUUID(), sent = f.calls.length;
  const responses = await Promise.all([f.sample(race), f.generic(race)]);
  await f.wake();
  assert.equal(f.rows().filter(row => row.event_id === `test:${race}`).length, 1);
  assert.deepEqual(responses.map(r => r.status).filter(status => status === 409), [409]);
  assert.ok(f.calls.length - sent <= 1, "At most the one winning kind may send");

  f.advance(60000);
  const same = crypto.randomUUID(), tasks = f.tasks.length;
  // Token hashing is asynchronous, so either UUID may win the device's single claim.
  const concurrent = await Promise.all([f.sample(same), f.sample(same), f.sample(crypto.randomUUID())]);
  assert.ok(concurrent.every(r => [202, 429].includes(r.status)));
  assert.equal(concurrent.filter(r => r.status === 202).length >= 1 && concurrent.some(r => r.status === 429), true);
  assert.equal(f.tasks.length - tasks, 1);
  assert.equal(f.rows().filter(row => row.attempted_at === Date.now()).length, 1);
  const before = f.calls.length; await f.wake();
  assert.equal(f.calls.length - before, 1);
});

test("generic tests and samples share one atomic per-device minute", async t => {
  const f = await fixture(t);
  assert.equal((await f.sample(crypto.randomUUID())).status, 202);
  f.advance(59999);
  assert.equal((await f.generic(crypto.randomUUID())).status, 429);
  assert.equal((await f.sample(crypto.randomUUID())).status, 429);
  f.advance(1);
  assert.equal((await f.generic(crypto.randomUUID())).status, 200);
  f.advance(1);
  assert.equal((await f.sample(crypto.randomUUID())).status, 429);
  // The generic path keeps its old acceptance of unrelated keys and needs no context.
  f.advance(60000);
  const legacy = await f.call(`/subscriptions/${f.id}/test`, { body: { testId: crypto.randomUUID(), note: "ignored" }, ctx: null });
  assert.equal(legacy.status, 200); assert.equal((await legacy.json()).status, "accepted");
});

for (const [change, mutate] of [
  ["deactivation", f => f.sqlite.prepare("UPDATE subscriptions SET active=0 WHERE id=?").run(f.id)],
  ["settings revision", f => f.sqlite.prepare("UPDATE subscription_settings SET revision=revision+1 WHERE subscription_id=?").run(f.id)],
  ["missing settings row", f => f.sqlite.prepare("DELETE FROM subscription_settings WHERE subscription_id=?").run(f.id)],
  ["p256dh rewrite", f => f.sqlite.prepare("UPDATE subscriptions SET p256dh='rewritten' WHERE id=?").run(f.id)],
  ["auth rewrite", f => f.sqlite.prepare("UPDATE subscriptions SET auth='rewritten' WHERE id=?").run(f.id)],
  ["owner token", f => f.sqlite.prepare("UPDATE subscriptions SET token_hash='replaced' WHERE id=?").run(f.id)],
]) test(`a ${change} after scheduling suppresses the sample before transport`, async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  assert.equal((await f.sample(testId)).status, 202);
  mutate(f);
  await f.wake();
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows()[0].status, "sample:suppressed");
  f.sqlite.prepare("UPDATE subscriptions SET token_hash=? WHERE id=?").run(await hash(f.token), f.id);
  const result = await (await f.read(testId)).json();
  assert.equal(result.status, "suppressed"); assert.equal(result.attemptHistory, "none"); assert.equal(result.overdue, undefined);
});

test("a late wake on the task clock marks late and sends nothing", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  assert.equal((await f.sample(testId)).status, 202);
  await f.wake(15001);
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows()[0].status, "sample:late");
  assert.equal((await (await f.read(testId)).json()).status, "late");
});

for (const [label, result] of [
  ["missing metadata", () => ({ results: [] })],
  ["empty metadata", () => ({ results: [], meta: {} })],
  ["string count", r => ({ ...r, meta: { changes: "1" } })],
  ["two changes", r => ({ ...r, meta: { changes: 2 } })],
  ["null result", () => null],
  ["thrown error", () => { throw new Error("simulated D1 failure"); }],
]) test(`a guard result with ${label} never sends or infers success`, async t => {
  const wrap = db => ({ ...db, prepare(sql) {
    const statement = db.prepare(sql);
    if (sql.startsWith("UPDATE deliveries SET status='sample:sending'")) { const run = statement.run.bind(statement); statement.run = async () => result(await run()); }
    return statement;
  } });
  const f = await fixture(t, { db: wrap }), testId = crypto.randomUUID();
  assert.equal((await f.sample(testId)).status, 202);
  await f.wake();
  assert.equal(f.calls.length, 0);
  assert.ok(["sample:sending", "sample:suppressed"].includes(f.rows()[0].status));
});

for (const [code, expected, active] of [[201, "sample:accepted", 1], [307, "sample:http-307", 1], [404, "sample:http-404", 0], [410, "sample:http-410", 0], [503, "sample:http-503", 1], ["transport", "sample:uncertain", 1]]) {
  test(`sample provider outcome ${code} is recorded once and never retried`, async t => {
    const f = await fixture(t), testId = crypto.randomUUID(); f.respond(code);
    assert.equal((await f.sample(testId)).status, 202);
    await f.wake();
    assert.equal(f.rows()[0].status, expected);
    assert.equal(f.sqlite.prepare("SELECT active FROM subscriptions WHERE id=?").get(f.id).active, active);
    const replay = await f.sample(testId);
    assert.equal((await replay.json()).status, expected.slice("sample:".length));
    await f.wake();
    assert.equal(f.calls.length, 1); assert.equal(f.tasks.length, 1);
  });
}

test("an expired endpoint does not deactivate a re-registration that replaced its keys", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  f.respond(410, () => f.sqlite.prepare("UPDATE subscriptions SET p256dh='re-registered',auth='re-registered' WHERE id=?").run(f.id));
  assert.equal((await f.sample(testId)).status, 202);
  await f.wake();
  assert.equal(f.calls.length, 1);
  assert.equal(f.rows()[0].status, "sample:http-410");
  assert.equal(f.sqlite.prepare("SELECT active FROM subscriptions WHERE id=?").get(f.id).active, 1);
});

test("a stale expiry does not deactivate a later settings generation on the same endpoint and keys", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  const subscription = () => f.sqlite.prepare("SELECT endpoint,p256dh,auth,token_hash,active FROM subscriptions WHERE id=?").get(f.id);
  const before = { ...subscription() };
  f.respond(410, () => f.sqlite.prepare("UPDATE subscription_settings SET revision=revision+1 WHERE subscription_id=?").run(f.id));
  assert.equal((await f.sample(testId)).status, 202);
  await f.wake();
  assert.equal(f.calls.length, 1);
  assert.equal(f.rows()[0].status, "sample:http-410");
  assert.equal(f.sqlite.prepare("SELECT revision FROM subscription_settings WHERE subscription_id=?").get(f.id).revision, 1);
  assert.deepEqual({ ...subscription() }, before);
});

test("a failed result write leaves an unknown sending row that is never resent", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  const errors = t.mock.method(console, "error", () => {});
  f.sqlite.exec("CREATE TRIGGER reject_sample_result BEFORE UPDATE OF status ON deliveries WHEN NEW.status='sample:accepted' BEGIN SELECT RAISE(ABORT,'simulated D1 failure'); END;");
  assert.equal((await f.sample(testId)).status, 202);
  await f.wake();
  assert.equal(f.calls.length, 1);
  assert.equal(f.rows()[0].status, "sample:sending");
  const logs = errors.mock.calls.map(c => c.arguments.join(" ")).join("\n");
  assert.match(logs, /sample_task_failed/);
  for (const secret of [f.token, f.p256dh, f.id, "web.push.apple.com"]) assert.ok(!logs.includes(secret));
  const unknown = await (await f.read(testId)).json();
  assert.equal(unknown.status, "sending"); assert.equal(unknown.attemptHistory, "unknown"); assert.equal(unknown.overdue, false);
  f.advance(31000);
  const late = await f.read(testId);
  assert.equal(late.status, 202);
  const overdue = await late.json();
  assert.equal(overdue.overdue, true); assert.equal(overdue.receiptConfirmed, false);
  assert.match(overdue.warning, /does not show whether the sample was or was not sent/);
  assert.equal((await f.sample(testId)).status, 202);
  await f.wake();
  assert.equal(f.calls.length, 1); assert.equal(f.rows()[0].status, "sample:sending");
});

test("sample status GET is protected and read-only", async t => {
  const f = await fixture(t), testId = crypto.randomUUID();
  assert.equal((await f.read(testId)).status, 404);
  for (const options of [{ token: null }, { token: "wrong" }, { id: f.other }]) assert.equal((await f.read(testId, options)).status, 404);
  for (const options of [{ origin: null }, { origin: "https://attacker.test" }]) assert.equal((await f.read(testId, options)).status, 403);
  assert.equal((await f.read("not-a-uuid")).status, 400);
  assert.equal((await f.call(`/subscriptions/${f.id}/test/${testId}`, { body: { testId, sample: "one-score" } })).status, 404);
  assert.equal((await f.call(`/subscriptions/${f.id}/test`, { method: "GET" })).status, 404);
  assert.deepEqual(f.rows(), []);
  f.sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run(`test:${testId}`, f.id, "sample:scheduled", start - 31000);
  const before = f.rows();
  const response = await f.read(testId), body = await response.json();
  assert.equal(response.status, 202); assert.equal(body.status, "scheduled"); assert.equal(body.overdue, true);
  assert.equal(body.attemptHistory, "pending"); assert.match(body.warning, /does not show whether/);
  assert.deepEqual(f.rows(), before);
  await f.wake();
  assert.equal(f.tasks.length, 0); assert.equal(f.calls.length, 0);
});
