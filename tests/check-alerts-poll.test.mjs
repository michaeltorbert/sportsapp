import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cdnFeed, database } from "./helpers.mjs";
import { classifyRequest, guardedFetch, runDiagnostic } from "../scripts/check-alerts-poll.mjs";

const now = Date.parse("2026-09-05T23:00:00Z");
const cdn = "https://cdn.espn.com/core/college-football/scoreboard?xhr=1&group=80";
const siteApi = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260904-20260906&groups=80&limit=200";
const safeFetch = response => async (input, init) => {
  const url = new URL(input);
  assert.ok(["cdn.espn.com", "site.api.espn.com"].includes(url.hostname), "No push or other network transport may escape the guard");
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  return response(url);
};

test("diagnostic accepts the covered CDN board without a fallback or push request", async () => {
  const original = globalThis.fetch, calls = [];
  const result = await runDiagnostic({ now, upstream: safeFetch(url => {
    calls.push(url.href);
    return Response.json(cdnFeed());
  }) });
  assert.equal(globalThis.fetch, original);
  assert.equal(result.success, true);
  assert.equal(result.acceptedSource, "cdn");
  assert.equal(result.cdnFallback, null);
  assert.deepEqual(calls, [cdn]);
  assert.deepEqual(result.attempts.map(({ source, status }) => [source, status]), [["cdn", 200]]);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.subscriptions, 0);
  assert.equal(result.deliveries, 0);
});

test("diagnostic attributes CDN HTTP failure and date-API fallback separately", async () => {
  const result = await runDiagnostic({ now, upstream: safeFetch(url =>
    url.hostname === "cdn.espn.com" ? new Response("Unavailable", { status: 503 }) : Response.json({ events: [] })) });
  assert.equal(result.success, true);
  assert.equal(result.acceptedSource, "site-api");
  assert.equal(result.cdnFallback, "http-error");
  assert.deepEqual(result.attempts.map(({ source, url, status }) => [source, url, status]), [
    ["cdn", cdn, 503], ["site-api", siteApi, 200],
  ]);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.deliveries, 0);
});

test("CDN HTTP 200 with rejected board is identified as response rejection", async () => {
  const partial = cdnFeed([{ invalid: true }]);
  const result = await runDiagnostic({ now, upstream: safeFetch(url =>
    url.hostname === "cdn.espn.com" ? Response.json(partial) : Response.json({ events: [] })) });
  assert.equal(result.success, true);
  assert.equal(result.acceptedSource, "site-api");
  assert.equal(result.cdnFallback, "response-rejected");
  assert.deepEqual(result.attempts.map(attempt => attempt.status), [200, 200]);
  assert.equal(result.games, 0);
});

test("network error remains distinct from a diagnostic allowlist block", async () => {
  const result = await runDiagnostic({ now, upstream: safeFetch(url => {
    if (url.hostname === "cdn.espn.com")
      throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND", message: "test-only private proxy detail" } });
    return Response.json({ events: [] });
  }) });
  assert.equal(result.success, true);
  assert.equal(result.cdnFallback, "network-error");
  assert.equal(result.attempts[0].networkError, "fetch failed (ENOTFOUND)");
  assert.doesNotMatch(JSON.stringify(result), /private proxy detail/);
  assert.deepEqual(result.blocked, []);
});

test("a CDN redirect is labeled as deliberately not followed", async () => {
  const forwarded = [];
  const result = await runDiagnostic({ now, upstream: safeFetch(url => {
    forwarded.push(url.href);
    return url.hostname === "cdn.espn.com"
      ? new Response(null, { status: 302, headers: { Location: "https://redirect.example.invalid/" } })
      : Response.json({ events: [] });
  }) });
  assert.equal(result.success, true);
  assert.equal(result.acceptedSource, "site-api");
  assert.equal(result.cdnFallback, "redirect-not-followed");
  assert.deepEqual(result.attempts.map(attempt => attempt.status), [302, 200]);
  assert.deepEqual(forwarded, [cdn, siteApi]);
});

test("both source failures retain the poller's source labels without claiming production failure", async () => {
  const result = await runDiagnostic({ now, upstream: safeFetch(url =>
    new Response("Unavailable", { status: url.hostname === "cdn.espn.com" ? 503 : 403 })) });
  assert.equal(result.success, false);
  assert.equal(result.attribution, "score-feed-attempts");
  assert.match(result.message, /cdn: HTTP 503.*site-api: HTTP 403/);
  assert.deepEqual(result.attempts.map(attempt => attempt.status), [503, 403]);
  assert.deepEqual(result.blocked, []);
  assert.match(result.scope, /not evidence of Cloudflare execution, a production feed failure, or phone delivery/);
  assert.equal(result.deliveries, 0);
});

test("a database failure after a valid feed is attributed to the local poller", async t => {
  const fixture = database();
  t.after(() => fixture.sqlite.close());
  fixture.sqlite.exec("CREATE TRIGGER fail_success BEFORE INSERT ON poll_state WHEN NEW.id='last_good_score' BEGIN SELECT RAISE(ABORT, 'simulated local database failure'); END");
  const result = await runDiagnostic({ now, fixture, upstream: safeFetch(() => Response.json(cdnFeed())) });
  assert.equal(result.success, false);
  assert.equal(result.attribution, "local-poller");
  assert.match(result.message, /simulated local database failure/);
  assert.deepEqual(result.attempts.map(attempt => attempt.status), [200]);
  assert.deepEqual(result.blocked, []);
});

test("diagnostic allows the poller's identified adjacent-week CDN read", async () => {
  const boundary = Date.parse("2026-09-08T04:30:00Z");
  const entries = [
    { value: "1", startDate: "2026-08-22T07:00Z", endDate: "2026-09-08T06:59Z" },
    { value: "2", startDate: "2026-09-08T07:00Z", endDate: "2026-09-15T06:59Z" },
  ];
  const feed = week => ({ content: { sbData: { season: { year: 2026, type: 2 }, week: { number: week },
    leagues: [{ calendar: [{ value: "2", entries }] }], events: [] } } });
  const result = await runDiagnostic({ now: boundary, upstream: safeFetch(url =>
    Response.json(feed(url.searchParams.get("week") === "1" ? 1 : 2))) });
  assert.equal(result.success, true);
  assert.equal(result.acceptedSource, "cdn");
  assert.deepEqual(result.attempts.map(attempt => attempt.source), ["cdn", "cdn-week"]);
  assert.equal(new URL(result.attempts[1].url).searchParams.get("week"), "1");
  assert.deepEqual(result.blocked, []);
});

test("guard permits only exact GET feed URLs, caps fanout, and never forwards push traffic", async () => {
  const requests = [], blocked = [], forwarded = [];
  const fetch = guardedFetch(async (url, init) => {
    forwarded.push(url);
    assert.equal(init.redirect, "manual");
    assert.deepEqual(init.headers, { Accept: "application/json" });
    return new Response(null, { status: 200 });
  }, now, requests, blocked);
  assert.equal(classifyRequest(new URL(cdn), { headers: { Accept: "application/json" } }, now).source, "cdn");
  assert.equal(classifyRequest(new Request(siteApi), {}, now).source, "site-api");
  await fetch(cdn);
  await fetch(siteApi);
  for (const [url, init] of [
    [cdn, {}], [siteApi, {}],
    ["https://fcm.googleapis.com/fcm/send/device", { method: "POST", body: "no-send" }],
    ["https://cdn.espn.com/core/college-football/scoreboard?xhr=1&groups=80", {}],
    ["https://cdn.espn.com/core/college-football/scoreboard?xhr=1&group=80&dates=20260905", {}],
    ["http://cdn.espn.com/core/college-football/scoreboard?xhr=1&group=80", {}],
    ["https://cdn.espn.com:444/core/college-football/scoreboard?xhr=1&group=80", {}],
    ["https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard", {}],
    [siteApi.replace("groups=80", "groups=1"), {}],
    [cdn, { method: "POST" }],
    [cdn, { headers: { Authorization: "test-only" } }],
    [new Request(cdn, { headers: { Authorization: "test-only" } }), {}],
    ["https://updates.push.services.mozilla.com/push", {}],
  ]) await assert.rejects(fetch(url, init), /Diagnostic blocked/);
  assert.deepEqual(forwarded, [cdn, siteApi]);
  assert.equal(blocked.length, 13);
  assert.deepEqual(requests.map(attempt => attempt.status), [200, 200]);

  const cappedAttempts = [], cappedBlocks = [], cappedForwarded = [];
  const capped = guardedFetch(async url => { cappedForwarded.push(url); return new Response(null, { status: 200 }); }, now, cappedAttempts, cappedBlocks);
  await capped(cdn);
  for (const week of [1, 2, 3]) await capped(`${cdn}&year=2026&seasontype=2&week=${week}`);
  await assert.rejects(capped(`${cdn}&year=2026&seasontype=2&week=4`), /Diagnostic blocked/);
  assert.equal(cappedForwarded.length, 4);
  assert.equal(cappedBlocks.length, 1);
});

test("a seeded local subscription still cannot reach a real push destination", async t => {
  const fixture = database();
  t.after(() => fixture.sqlite.close());
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", receiver.publicKey)).toString("base64url");
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  fixture.sqlite.prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?)")
    .run("device", "https://fcm.googleapis.com/fcm/send/local-fixture", publicKey, auth, "local-owner", 1, 1, now - 60000, now - 60000);
  const event = { id: "local-game", date: "2026-09-05T22:00:00Z",
    status: { period: 4, clock: 120, type: { name: "STATUS_IN_PROGRESS", state: "in" } },
    competitions: [{ competitors: [
      { id: "away", homeAway: "away", score: "14", curatedRank: { current: 99 }, team: { id: "away", abbreviation: "AWAY" } },
      { id: "home", homeAway: "home", score: "21", curatedRank: { current: 99 }, team: { id: "home", abbreviation: "HOME" } },
    ] }],
  };
  const logs = [];
  t.mock.method(console, "error", message => logs.push(message));
  const forwarded = [];
  const result = await runDiagnostic({ now, fixture, upstream: safeFetch(url => {
    forwarded.push(url.href);
    return Response.json(cdnFeed([event]));
  }) });
  assert.equal(result.success, false);
  assert.equal(result.attribution, "diagnostic-allowlist");
  assert.deepEqual(forwarded, [cdn]);
  assert.ok(result.blocked.some(entry => entry.destination === "https://fcm.googleapis.com"));
  assert.ok(logs.some(message => message.includes("push_send_failed")));
  assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM deliveries WHERE status='uncertain'").get().n, 1);
});

test("CLI invocation through a symlink reports a failure instead of silently doing nothing", t => {
  const directory = mkdtempSync(join(tmpdir(), "alert-poll-link-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const link = join(directory, "check-alerts-poll.mjs"), mock = join(directory, "offline.mjs");
  symlinkSync(fileURLToPath(new URL("../scripts/check-alerts-poll.mjs", import.meta.url)), link);
  writeFileSync(mock, 'globalThis.fetch = async () => { throw new Error("Simulated offline feed"); };\n');
  const child = spawnSync(process.execPath, ["--import", mock, link], { encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 1, child.stderr);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /"success": false/);
  assert.match(child.stderr, /"attribution": "score-feed-attempts"/);
  assert.match(child.stderr, /Simulated offline feed/);
});

test("import with an unrelated nonexistent argv path does not start the CLI", t => {
  const directory = mkdtempSync(join(tmpdir(), "alert-poll-import-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const url = new URL("../scripts/check-alerts-poll.mjs", import.meta.url).href;
  // Node 22 warns about the test database's experimental SQLite import.
  const child = spawnSync(process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(url)});`, join(directory, "missing.mjs")],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});
