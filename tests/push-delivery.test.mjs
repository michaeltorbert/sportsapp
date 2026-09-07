import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { bundle, cdnFeed, database, game } from "./helpers.mjs";

const { poll, saveGameStates } = await bundle("services/alerts/worker.ts");
const { encode } = await bundle("services/alerts/web-push.ts");
const now = Date.parse("2026-09-06T03:00:00Z");
const origin = "https://app.test";

// These keys exist only in this test process. Every fetch is intercepted;
// neither provider credentials nor production subscriptions are involved.
const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const p256dh = encode(new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey)));
const auth = encode(crypto.getRandomValues(new Uint8Array(16)));
const publicKey = encode(new Uint8Array(await crypto.subtle.exportKey("raw", signing.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", signing.privateKey)).d;

function fixture(t) {
  const { db, sqlite } = database();
  t.after(() => sqlite.close());
  return {
    db, sqlite,
    env: { DB: db, SITE_ORIGIN: origin, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: origin },
    subscription(id, { active = 1, kickoff = 1, createdAt = now - 60000 } = {}) {
      sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)")
        .run(id, `https://fcm.googleapis.com/fcm/send/${id}`, p256dh, auth, "test-owner-hash", kickoff, active, createdAt, createdAt);
    },
    event(id, { trigger = "one-score-fourth", createdAt = now } = {}) {
      const eventId = `${id}:${trigger}`;
      sqlite.prepare("INSERT INTO alert_events VALUES(?,?,?,?,?,?)")
        .run(eventId, id, trigger, "2026-09-05", createdAt, JSON.stringify({ title: "Saturday Signal: TEST", body: "Simulated notification", eventId, url: `/?date=2026-09-05#game-${id}` }));
      return eventId;
    },
    state(id, value) {
      sqlite.prepare("INSERT INTO poll_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(id, value);
    },
  };
}

function liveEvent(id = "live") {
  return {
    id, date: "2026-09-06T02:00:00Z",
    status: { period: 4, clock: 120, type: { name: "STATUS_IN_PROGRESS", state: "in" } },
    competitions: [{ competitors: [
      { id: "away", homeAway: "away", score: "14", curatedRank: { current: 99 }, team: { id: "away", abbreviation: "AWAY" } },
      { id: "home", homeAway: "home", score: "21", curatedRank: { current: 99 }, team: { id: "home", abbreviation: "HOME" } },
    ] }],
  };
}

function intercept(t, { events = [liveEvent()], send = () => new Response(null, { status: 201 }) } = {}) {
  const attempts = [], feeds = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "cdn.espn.com") {
      feeds.push(url.href);
      return Response.json(cdnFeed(events));
    }
    assert.equal(url.hostname, "fcm.googleapis.com", "Unexpected network destination must not escape interception");
    const headers = new Headers(init.headers);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(headers.get("content-encoding"), "aes128gcm");
    assert.equal(headers.get("content-type"), "application/octet-stream");
    assert.equal(headers.get("ttl"), "300");
    assert.equal(headers.get("urgency"), "high");
    assert.match(headers.get("authorization"), /^vapid t=[^.]+\.[^.]+\.[^,]+, k=/);
    assert.ok(headers.get("authorization").endsWith(`k=${publicKey}`));
    assert.ok(init.body instanceof Uint8Array);
    assert.ok(init.body.length > 86, "A real encrypted push body must reach the intercepted transport");
    assert.equal(new DataView(init.body.buffer, init.body.byteOffset, init.body.byteLength).getUint32(16), 4096);
    assert.ok(init.signal instanceof AbortSignal);
    attempts.push(url.pathname.split("/").at(-1));
    return send(url, init);
  });
  return { attempts, feeds };
}

for (const [outcome, status, active, send] of [
  ["HTTP 201", "accepted", 1, () => new Response(null, { status: 201 })],
  ["HTTP 404", "http-404", 0, () => new Response(null, { status: 404 })],
  ["HTTP 410", "http-410", 0, () => new Response(null, { status: 410 })],
  ["HTTP 503", "http-503", 1, () => new Response(null, { status: 503 })],
  ["ambiguous transport failure", "uncertain", 1, () => { throw new TypeError("Simulated connection reset after request"); }],
]) {
  test(`poll records ${outcome}, updates subscription state, and never repeats the attempt`, async t => {
    const f = fixture(t);
    f.subscription("device");
    const { attempts, feeds } = intercept(t, { send });
    await poll(f.env, now);
    assert.deepEqual({ ...f.sqlite.prepare("SELECT * FROM deliveries").get() }, {
      event_id: "live:one-score-fourth", subscription_id: "device", status, attempted_at: now,
    });
    const subscription = f.sqlite.prepare("SELECT active,updated_at FROM subscriptions").get();
    assert.equal(subscription.active, active);
    assert.equal(subscription.updated_at, active ? now - 60000 : now);
    await poll(f.env, now + 60000);
    assert.equal(feeds.length, 2, "The second poll must reach delivery rather than stop at the schedule gate");
    assert.deepEqual(attempts, ["device"]);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM deliveries").get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT attempted_at FROM deliveries").get().attempted_at, now);
    assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now + 60000);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM poll_lock").get().n, 0);
  });
}

test("delivery filters inactive/new subscribers, stale events, and kickoff opt-outs at the exact boundaries", async t => {
  const f = fixture(t);
  const recentAt = now - 60000;
  f.subscription("eligible", { createdAt: recentAt });
  f.subscription("inactive", { active: 0, createdAt: now - 300000 });
  f.subscription("new", { createdAt: recentAt + 1 });
  f.subscription("no-kickoff", { kickoff: 0, createdAt: now - 300000 });
  f.event("stale", { createdAt: now - 180001 });
  f.event("boundary", { createdAt: now - 180000 });
  f.event("recent", { createdAt: recentAt });
  f.event("kickoff", { trigger: "acc-kickoff", createdAt: recentAt });
  const { attempts } = intercept(t, { events: [] });
  await poll(f.env, now);
  assert.deepEqual(f.sqlite.prepare("SELECT event_id,subscription_id,status FROM deliveries ORDER BY event_id,subscription_id").all().map(row => ({ ...row })), [
    { event_id: "boundary:one-score-fourth", subscription_id: "no-kickoff", status: "accepted" },
    { event_id: "kickoff:acc-kickoff", subscription_id: "eligible", status: "accepted" },
    { event_id: "recent:one-score-fourth", subscription_id: "eligible", status: "accepted" },
    { event_id: "recent:one-score-fourth", subscription_id: "no-kickoff", status: "accepted" },
  ]);
  assert.deepEqual(attempts.sort(), ["eligible", "eligible", "no-kickoff", "no-kickoff"]);
});

test("delivery crosses the 100-subscriber page boundary once per eligible device", async t => {
  const f = fixture(t);
  for (let i = 0; i < 102; i++) f.subscription(`device-${String(i).padStart(3, "0")}`);
  const { attempts } = intercept(t);
  await poll(f.env, now);
  await poll(f.env, now + 60000);
  assert.equal(attempts.length, 102);
  assert.equal(new Set(attempts).size, 102);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM deliveries WHERE status='accepted'").get().n, 102);
});

for (const [failure, respond] of [
  ["HTTP errors", () => new Response(null, { status: 503 })],
  ["transport failures", () => { throw new TypeError("Simulated feed connection failure"); }],
  ["malformed JSON", () => new Response("not-json")],
  ["partial feeds", () => Response.json({ events: [liveEvent("new-game"), { invalid: true }] })],
]) {
  test(`both score sources returning ${failure} preserves history and last success, and releases the poll lock`, async t => {
    const f = fixture(t);
    f.subscription("device");
    await saveGameStates(f.db, [game()], now - 60000);
    f.sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run("historical-event", "historical-device", "accepted", now - 60000);
    f.state("last_good_score", now - 60000);
    f.state("next_poll", now - 1);
    const history = () => ["game_states", "alert_events", "deliveries"].map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all());
    const before = history(), hosts = [];
    t.mock.method(globalThis, "fetch", async input => {
      const host = new URL(input).hostname;
      assert.ok(["cdn.espn.com", "site.api.espn.com"].includes(host), "Failed feeds must not send queued notifications");
      hosts.push(host);
      return respond();
    });
    await assert.rejects(poll(f.env, now), /ESPN score feeds failed/);
    assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com"]);
    assert.deepEqual(history(), before);
    assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now - 60000);
    assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='next_poll'").get().value, now - 1);
    assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_tick'").get().value, now);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM poll_lock").get().n, 0);
  });
}

test("partial CDN data falls back without saving or notifying from its incomplete games", async t => {
  const f = fixture(t);
  f.subscription("device");
  const hosts = [];
  t.mock.method(globalThis, "fetch", async input => {
    const host = new URL(input).hostname;
    hosts.push(host);
    if (host === "cdn.espn.com") return Response.json(cdnFeed([liveEvent("partial-only"), { invalid: true }]));
    assert.equal(host, "site.api.espn.com");
    return Response.json({ events: [] });
  });
  await poll(f.env, now);
  assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com"]);
  for (const table of ["game_states", "alert_events", "deliveries", "poll_lock"])
    assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now);
});

test("an active poll lock prevents fetching or delivering and keeps its owner intact", async t => {
  const f = fixture(t);
  f.subscription("device");
  f.event("queued");
  f.sqlite.prepare("INSERT INTO poll_lock VALUES('scores',?,?)").run("other-poller", now + 60000);
  const { attempts, feeds } = intercept(t);
  await poll(f.env, now);
  assert.deepEqual(feeds, []);
  assert.deepEqual(attempts, []);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM deliveries").get().n, 0);
  assert.deepEqual({ ...f.sqlite.prepare("SELECT * FROM poll_lock").get() }, { id: "scores", owner: "other-poller", expires_at: now + 60000 });
  assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_tick'").get().value, now);
  assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get(), undefined);
});

test("an expired poll lock can be reclaimed and is released after a successful send", async t => {
  const f = fixture(t);
  f.subscription("device");
  f.sqlite.prepare("INSERT INTO poll_lock VALUES('scores',?,?)").run("expired-poller", now);
  const { attempts, feeds } = intercept(t);
  await poll(f.env, now);
  assert.equal(feeds.length, 1);
  assert.deepEqual(attempts, ["device"]);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM poll_lock").get().n, 0);
});

test("a failed game-state write rolls back its alert events and permits a later recovery poll", async t => {
  const f = fixture(t);
  const baseline = game({ id: "live", period: 3 });
  await saveGameStates(f.db, [baseline], now - 60000);
  f.state("last_good_score", now - 60000);
  const before = f.sqlite.prepare("SELECT * FROM game_states").all();
  f.sqlite.exec("CREATE TRIGGER reject_game_update BEFORE UPDATE ON game_states BEGIN SELECT RAISE(ABORT, 'simulated database failure'); END");
  const { feeds } = intercept(t);
  await assert.rejects(poll(f.env, now), /simulated database failure/);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM game_states").all(), before);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM alert_events").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now - 60000);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM poll_lock").get().n, 0);
  f.sqlite.exec("DROP TRIGGER reject_game_update");
  await poll(f.env, now + 1);
  assert.equal(feeds.length, 2);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM alert_events").get().n, 1);
  assert.equal(JSON.parse(f.sqlite.prepare("SELECT state_json FROM game_states").get().state_json).period, 4);
  assert.equal(f.sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now + 1);
});

const serviceWorkerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
function serviceWorker(windows = []) {
  const listeners = new Map(), notifications = [], calls = [];
  runInNewContext(serviceWorkerSource, {
    URL,
    self: {
      location: { origin },
      addEventListener(type, listener) { listeners.set(type, listener); },
      skipWaiting() { calls.push(["skipWaiting"]); },
      registration: { async showNotification(title, options) { notifications.push({ title, ...structuredClone(options) }); } },
      clients: {
        async claim() { calls.push(["claim"]); },
        async matchAll(options) { calls.push(["matchAll", structuredClone(options)]); return windows; },
        async openWindow(url) { calls.push(["openWindow", url]); },
      },
    },
  }, { filename: "public/sw.js" });
  return {
    calls, notifications,
    async dispatch(type, data = {}) {
      const waits = [];
      listeners.get(type)({ ...data, waitUntil(promise) { waits.push(promise); } });
      if (type !== "install") assert.equal(waits.length, 1, "The browser must be asked to keep the event alive");
      await Promise.all(waits);
    },
  };
}

test("the actual service worker displays a labeled push and visible fallbacks for missing or malformed payloads", async () => {
  const sw = serviceWorker();
  await sw.dispatch("push", { data: { json: () => ({ title: "Saturday Signal: TEST", body: "This is a test notification, not a game alert.", eventId: "test-unique", url: "/?date=2026-09-05#game-live" }) } });
  assert.deepEqual(sw.notifications[0], {
    title: "Saturday Signal: TEST", body: "This is a test notification, not a game alert.",
    icon: "/icon-192.png", badge: "/icon-192.png", tag: "test-unique", renotify: false,
    data: { url: "/?date=2026-09-05#game-live" },
  });
  for (const data of [undefined, { json: () => { throw new SyntaxError("Invalid JSON"); } }, { json: () => null }, { json: () => ({ title: 7, body: false, eventId: [], url: {} }) }]) {
    await sw.dispatch("push", { data });
    assert.deepEqual(sw.notifications.at(-1), {
      title: "Saturday Signal", body: "There is an update on your football watchlist.",
      icon: "/icon-192.png", badge: "/icon-192.png", tag: "saturday-signal", renotify: false, data: { url: "/" },
    });
  }
});

test("notification clicks close the notification, navigate and focus the existing same-origin window", async () => {
  const calls = [];
  const client = url => ({ url, async navigate(target) { calls.push(["navigate", url, target]); }, async focus() { calls.push(["focus", url]); } });
  const sw = serviceWorker([client("https://other.test/"), client(`${origin}/old-page`), client(`${origin}/another-page`)]);
  await sw.dispatch("notificationclick", { notification: { data: { url: "/?date=2026-09-05#game-live" }, close() { calls.push(["close"]); } } });
  assert.deepEqual(calls, [
    ["close"], ["navigate", `${origin}/old-page`, `${origin}/?date=2026-09-05#game-live`], ["focus", `${origin}/old-page`],
  ]);
  assert.deepEqual(sw.calls, [["matchAll", { type: "window", includeUncontrolled: true }]]);
});

test("notification clicks open an app window when none of the existing windows belongs to this origin", async () => {
  let closed = 0;
  const sw = serviceWorker([{ url: "https://other.test/" }]);
  await sw.dispatch("notificationclick", { notification: { data: { url: `${origin}/?date=2026-09-05#game-live` }, close() { closed++; } } });
  assert.equal(closed, 1);
  assert.deepEqual(sw.calls, [
    ["matchAll", { type: "window", includeUncontrolled: true }], ["openWindow", `${origin}/?date=2026-09-05#game-live`],
  ]);
});

test("notification clicks use the home page for missing, malformed, or out-of-origin destinations", async () => {
  for (const url of [undefined, "http://[", "https://other.test/", "//other.test/", "https://app.test.attacker.test/", "http://app.test/", "https://app.test:444/", "javascript:alert(1)"]) {
    const sw = serviceWorker();
    await sw.dispatch("notificationclick", { notification: { data: { url }, close() {} } });
    assert.deepEqual(sw.calls.at(-1), ["openWindow", `${origin}/`]);
  }
});
