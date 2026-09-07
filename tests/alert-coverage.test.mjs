import test from "node:test";
import assert from "node:assert/strict";
import { bundle, database, game } from "./helpers.mjs";
import { alertCdn } from "./fixtures/alert-cdn.mjs";
const { poll, saveGameStates } = await bundle("services/alerts/worker.ts");

const cases = [
  ["wrong week", "2026-09-13T21:00:00Z", () => alertCdn()],
  ["missing calendar", "2026-09-05T23:00:00Z", () => { const raw = alertCdn(); delete raw.content.sbData.leagues; return raw; }],
  ["partial start boundary", "2026-08-23T21:00:00Z", () => alertCdn()],
  ["partial end boundary", "2026-09-08T21:00:00Z", () => alertCdn()],
];

for (const [reason, instant, feed] of cases) {
  for (const apiStatus of [200, 403]) {
    test(`${reason} CDN falls back to date-specific API; HTTP ${apiStatus} ${apiStatus === 200 ? "succeeds" : "preserves history and releases lock"}`, async t => {
      const { db, sqlite } = database();
      t.after(() => sqlite.close());
      const now = Date.parse(instant), previousSuccess = now - 30 * 60000;
      const env = { DB: db, SITE_ORIGIN: "https://app.test", VAPID_PUBLIC_KEY: "test-only", VAPID_PRIVATE_KEY: "test-only" };
      // Retained historical state must survive failed coverage checks, even with
      // a subscribed device and undelivered event waiting in the database.
      await saveGameStates(db, [game()], previousSuccess);
      sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)").run("device", "https://push.test/device", "key", "auth", "owner", 1, 1, previousSuccess, previousSuccess);
      sqlite.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run("historical-event", "device", "accepted", previousSuccess);
      sqlite.prepare("INSERT INTO poll_state VALUES('last_good_score',?)").run(previousSuccess);
      sqlite.prepare("INSERT INTO poll_state VALUES('next_poll',?)").run(now - 1);
      const snapshot = () => ["subscriptions", "game_states", "alert_events", "deliveries"].map(table => sqlite.prepare(`SELECT * FROM ${table}`).all());
      const before = snapshot(), calls = [];
      t.mock.method(globalThis, "fetch", async input => {
        const url = new URL(input); calls.push(url.hostname);
        if (url.hostname === "cdn.espn.com") return Response.json(feed());
        assert.equal(url.hostname, "site.api.espn.com", "No notification may escape interception");
        const today = instant.slice(0, 10), yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
        const tomorrow = new Date(now + 86400000).toISOString().slice(0, 10);
        assert.equal(url.searchParams.get("dates"), `${yesterday.replaceAll("-", "")}-${tomorrow.replaceAll("-", "")}`, `Expected complete yesterday/today range ending ${today}`);
        assert.equal(url.searchParams.get("groups"), "80");
        return apiStatus === 200 ? Response.json({ events: [] }) : new Response("Forbidden", { status: apiStatus });
      });
      if (apiStatus === 200) {
        await poll(env, now);
        assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now);
        assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='next_poll'").get().value, now + 900000);
      } else {
        await assert.rejects(poll(env, now), /ESPN score feeds failed \(cdn:.*site-api: HTTP 403\)/s);
        assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, previousSuccess);
        assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='next_poll'").get().value, now - 1);
      }
      assert.deepEqual(snapshot(), before);
      assert.deepEqual(calls, ["cdn.espn.com", "site.api.espn.com"]);
      assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_tick'").get().value, now);
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM poll_lock").get().n, 0);
    });
  }
}

test("correctly covered empty CDN is a successful poll without API fallback", async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const now = Date.parse("2026-09-05T23:00:00Z"), calls = [];
  t.mock.method(globalThis, "fetch", async input => {
    calls.push(new URL(input).hostname);
    assert.equal(calls.at(-1), "cdn.espn.com");
    return Response.json(alertCdn());
  });
  await poll({ DB: db, SITE_ORIGIN: "https://app.test", VAPID_PUBLIC_KEY: "test-only", VAPID_PRIVATE_KEY: "test-only" }, now);
  assert.deepEqual(calls, ["cdn.espn.com"]);
  assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now);
  assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='next_poll'").get().value, now + 900000);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM poll_lock").get().n, 0);
});
