import test from "node:test";
import assert from "node:assert/strict";
import { bundle, cdnFeed, database, game } from "./helpers.mjs";

// The alert poller must prove that ESPN's CDN week covers yesterday and today
// before a poll counts as successful. Every fetch is intercepted; no push
// provider, production database, or real notification is involved.
const { default: worker, poll, saveGameStates } = await bundle("services/alerts/worker.ts");
const { encode } = await bundle("services/alerts/web-push.ts");
const origin = "https://app.test";

const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const p256dh = encode(new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey)));
const auth = encode(crypto.getRandomValues(new Uint8Array(16)));
const publicKey = encode(new Uint8Array(await crypto.subtle.exportKey("raw", signing.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", signing.privateKey)).d;

// Issue #18 fixture: a Sunday poll while the CDN still serves week 1 (Aug 22 – Sep 8).
const wrongWeekPoll = Date.parse("2026-09-13T21:00:00Z");

function fixture(t) {
  const { db, sqlite } = database();
  t.after(() => sqlite.close());
  const value = id => sqlite.prepare("SELECT value FROM poll_state WHERE id=?").get(id)?.value;
  return {
    db, sqlite, value,
    env: { DB: db, SITE_ORIGIN: origin, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: origin },
    count: table => sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
    state(id, v) { sqlite.prepare("INSERT INTO poll_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(id, v); },
    subscription(id, createdAt) {
      sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run(id, `https://fcm.googleapis.com/fcm/send/${id}`, p256dh, auth, "test-owner-hash", 1, 1, createdAt, createdAt);
    },
  };
}

// A fourth-quarter one-score game on the requested day, served by either feed.
function liveEvent(id, date = "2026-09-13T20:00:00Z") {
  return {
    id, date,
    status: { period: 4, clock: 120, type: { name: "STATUS_IN_PROGRESS", state: "in" } },
    competitions: [{ competitors: [
      { id: "away", homeAway: "away", score: "14", curatedRank: { current: 99 }, team: { id: "away", abbreviation: "AWAY" } },
      { id: "home", homeAway: "home", score: "21", curatedRank: { current: 99 }, team: { id: "home", abbreviation: "HOME" } },
    ] }],
  };
}

// Intercept both ESPN feeds and the push transport; record every destination.
function intercept(t, { cdn, api = () => Response.json({ events: [] }), send = () => new Response(null, { status: 201 }) }) {
  const hosts = [], queries = [], attempts = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    hosts.push(url.hostname);
    if (url.hostname === "cdn.espn.com") return cdn(url);
    if (url.hostname === "site.api.espn.com") { queries.push(url.searchParams.get("dates")); return api(url); }
    assert.equal(url.hostname, "fcm.googleapis.com", "Unexpected network destination must not escape interception");
    attempts.push(url.pathname.split("/").at(-1));
    return send(url, init);
  });
  return { hosts, queries, attempts };
}

test("a wrong-week CDN board is rejected and the date-specific API supplies the real games, once", async t => {
  const f = fixture(t);
  const { hosts, queries } = intercept(t, { cdn: () => Response.json(cdnFeed([], { week: 1 })), api: () => Response.json({ events: [liveEvent("sunday-live")] }) });
  await poll(f.env, wrongWeekPoll);
  assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com"]);
  assert.deepEqual(queries, ["20260912-20260914"], "The fallback must request yesterday and today with ESPN's exclusive end date");
  assert.equal(f.count("game_states"), 1);
  assert.deepEqual(f.sqlite.prepare("SELECT id FROM alert_events").all().map(row => row.id), ["sunday-live:one-score-fourth"]);
  assert.equal(f.value("last_good_score"), wrongWeekPoll);
  assert.equal(f.value("next_poll"), wrongWeekPoll + 60000, "a live game keeps the one-minute schedule");
  assert.equal(f.count("poll_lock"), 0);
  await poll(f.env, wrongWeekPoll + 60000);
  assert.equal(f.count("alert_events"), 1, "an unchanged game must not repeat its trigger");
  assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com", "cdn.espn.com", "site.api.espn.com"]);
  assert.equal(f.value("last_good_score"), wrongWeekPoll + 60000);
});

test("a CDN board without a readable calendar proves nothing, even when it lists games", async t => {
  const f = fixture(t);
  for (const raw of [{ content: { sbData: { events: [liveEvent("unproven")] } } }, { events: [liveEvent("unproven")] }]) {
    const { hosts } = intercept(t, { cdn: () => Response.json(raw) });
    await poll(f.env, wrongWeekPoll);
    assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com"]);
    assert.equal(f.count("game_states"), 0, "games from an unproven CDN board must not be saved");
    assert.equal(f.count("alert_events"), 0);
    assert.equal(f.value("last_good_score"), wrongWeekPoll);
    f.state("next_poll", 0);
  }
});

test("partially covered week-boundary days fall back to the API; a fully covered day never does", async t => {
  const boundaries = [
    ["Tuesday poll while the CDN still serves week 1", "2026-09-08T16:00:00Z", 1],
    ["Tuesday poll after the CDN switched to week 2", "2026-09-08T16:00:00Z", 2],
    ["Wednesday poll whose yesterday is the week-2 boundary day", "2026-09-09T16:00:00Z", 2],
  ];
  for (const [label, at, week] of boundaries) {
    const f = fixture(t), now = Date.parse(at);
    const { hosts } = intercept(t, { cdn: () => Response.json(cdnFeed([liveEvent("boundary", at)], { week })) });
    await poll(f.env, now);
    assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com"], label);
    assert.equal(f.count("game_states"), 0, `${label}: CDN games were not accepted`);
    assert.equal(f.value("last_good_score"), now, `${label}: the API answer completed the poll`);
  }
  const f = fixture(t), thursday = Date.parse("2026-09-10T16:00:00Z");
  const { hosts } = intercept(t, { cdn: () => Response.json(cdnFeed([liveEvent("covered", "2026-09-10T15:00:00Z")], { week: 2 })) });
  await poll(f.env, thursday);
  assert.deepEqual(hosts, ["cdn.espn.com"]);
  assert.equal(f.count("game_states"), 1);
  assert.deepEqual(f.sqlite.prepare("SELECT id FROM alert_events").all().map(row => row.id), ["covered:one-score-fourth"]);
  assert.equal(f.value("last_good_score"), thursday);
});

test("a rejected CDN plus an API 403 is a failed poll that preserves history and reports a stale feed", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(wrongWeekPoll) });
  const f = fixture(t);
  const lastSuccess = wrongWeekPoll - 21 * 60000;
  f.subscription("device", lastSuccess - 60000);
  await saveGameStates(f.db, [game({ id: "earlier", date: "2026-09-13T00:30:00Z" })], lastSuccess);
  f.sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run("earlier:one-score-fourth", "device", "accepted", lastSuccess);
  f.state("last_good_score", lastSuccess);
  f.state("next_poll", wrongWeekPoll - 1);
  const history = () => ["game_states", "alert_events", "deliveries", "subscriptions"].map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all());
  const before = history();
  const { hosts, attempts } = intercept(t, { cdn: () => Response.json(cdnFeed([liveEvent("stale-week")], { week: 1 })), api: () => new Response("Forbidden", { status: 403 }) });
  await assert.rejects(poll(f.env, wrongWeekPoll), /ESPN score feeds failed \(cdn: CDN does not cover the requested dates; site-api: HTTP 403\)/);
  assert.deepEqual(hosts, ["cdn.espn.com", "site.api.espn.com"]);
  assert.deepEqual(attempts, [], "no notification may be sent from a failed poll");
  assert.deepEqual(history(), before);
  assert.equal(f.value("last_good_score"), lastSuccess);
  assert.equal(f.value("next_poll"), wrongWeekPoll - 1);
  assert.equal(f.value("last_tick"), wrongWeekPoll);
  assert.equal(f.count("poll_lock"), 0);
  const config = await (await worker.fetch(new Request("https://alerts.test/config"), f.env)).json();
  assert.equal(config.ready, false);
  assert.equal(config.readinessReason, "stale-score-feed", "readiness must not be manufactured from a rejected board");
  assert.equal(config.lastSuccessfulPollAt, new Date(lastSuccess).toISOString());
});

test("fallback games still reach a subscribed device exactly once", async t => {
  const f = fixture(t);
  f.subscription("device", wrongWeekPoll - 60000);
  const { attempts } = intercept(t, { cdn: () => Response.json(cdnFeed([], { week: 1 })), api: () => Response.json({ events: [liveEvent("sunday-live")] }) });
  await poll(f.env, wrongWeekPoll);
  await poll(f.env, wrongWeekPoll + 60000);
  assert.deepEqual(attempts, ["device"]);
  assert.deepEqual(f.sqlite.prepare("SELECT event_id,subscription_id,status,attempted_at FROM deliveries").all().map(row => ({ ...row })), [
    { event_id: "sunday-live:one-score-fourth", subscription_id: "device", status: "accepted", attempted_at: wrongWeekPoll },
  ]);
});
