import { completeCdnRange } from "../../lib/espn-cdn";
import { VERSION } from "../../lib/releases";
import { normalizeScoreboard, scoreboardCdnUrl, scoreboardUrl } from "../../lib/espn-data";
import { easternDate, shiftDate, type Game } from "../../lib/football";
import { nextPollAt, transitions, type AlertEvent, type Snapshot } from "./rules";
import { encode, hash, sendPush, validSubscription } from "./web-push";

type Result<T = Record<string, unknown>> = { results: T[]; meta: { changes: number } };
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<Result<T>>;
  run(): Promise<Result>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<Result[]> }
export type Env = { DB: Database; SITE_ORIGIN: string; ADDITIONAL_SITE_ORIGINS?: string; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };
type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string; token_hash: string; kickoff: number; active: number; created_at: number };
type StoredEvent = { id: string; trigger: string; payload: string; created_at: number };
const setValue = (db: Database, id: string, value: number) => db.prepare("INSERT INTO poll_state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(id, value);

export async function claimDelivery(db: Database, eventId: string, subscriptionId: string, now: number) {
  const result = await db.prepare("INSERT OR IGNORE INTO deliveries(event_id,subscription_id,status,attempted_at) VALUES(?,?,?,?)").bind(eventId, subscriptionId, "claimed", now).run();
  return result.meta.changes === 1;
}
async function deliver(env: Env, now: number) {
  const subscriber = await env.DB.prepare("SELECT id FROM subscriptions WHERE active=1 LIMIT 1").first();
  if (!subscriber) return;
  const { results: events } = await env.DB.prepare("SELECT id,trigger,payload,created_at FROM alert_events WHERE created_at >= ? ORDER BY created_at,id").bind(now - 180000).all<StoredEvent>();
  for (const event of events) {
    let after = "";
    for (;;) {
      const { results: subscribers } = await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND id>? AND created_at<=? AND (?<> 'acc-kickoff' OR kickoff=1) ORDER BY id LIMIT 100").bind(after, event.created_at, event.trigger).all<StoredSubscription>();
      if (!subscribers.length) break;
      for (let i = 0; i < subscribers.length; i += 8) await Promise.all(subscribers.slice(i, i + 8).map(async sub => {
        if (!await claimDelivery(env.DB, event.id, sub.id, now)) return;
        let status = "uncertain";
        try {
          const code = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.parse(event.payload), { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });
          status = code >= 200 && code < 300 ? "accepted" : `http-${code}`;
          if (code === 404 || code === 410) await env.DB.prepare("UPDATE subscriptions SET active=0,updated_at=? WHERE id=?").bind(now, sub.id).run();
        } catch { /* An ambiguous network failure is not retried: no duplicate attempts. */ }
        await env.DB.prepare("UPDATE deliveries SET status=? WHERE event_id=? AND subscription_id=?").bind(status, event.id, sub.id).run();
      }));
      after = subscribers[subscribers.length - 1].id;
    }
  }
}
// Tests use the delivery ledger only: never create a football event for a device test.
// The caller must prove ownership of one active subscription and supply a stable UUID.
async function testNotification(request: Request, env: Env, sub: StoredSubscription, origin: string) {
  const body = await readBody(request);
  if (typeof body.testId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.testId)) {
    return { body: { error: "A UUID v4 testId is required" }, status: 400 };
  }
  const eventId = `test:${body.testId}`;
  const read = () => env.DB.prepare("SELECT status,attempted_at FROM deliveries WHERE event_id=? AND subscription_id=?").bind(eventId, sub.id).first<{ status: string; attempted_at: number }>();
  const result = (row: { status: string; attempted_at: number }, attempted: boolean) => ({
    body: {
      testId: body.testId,
      // attempted describes this request only; a saved claim cannot establish
      // whether an earlier request reached sendPush before being interrupted.
      attempted,
      attemptHistory: !attempted && row.status === "claimed" ? "unknown" : "attempted",
      ...(!attempted && row.status === "claimed" ? {
        warning: "An earlier request may have attempted this notification. This request did not attempt another send. Do not send another test.",
      } : {}),
      status: row.status, attemptedAt: new Date(row.attempted_at).toISOString(), receiptConfirmed: false,
    },
    status: row.status === "claimed" ? 202 : 200,
  });
  const previous = await read();
  if (previous) return result(previous, false);
  if (!sub.active) return { body: { error: "Enable alerts on this device first" }, status: 409 };
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { body: { error: "Push configuration is unavailable" }, status: 503 };
  const now = Date.now();
  // One atomic statement prevents parallel UUIDs from bypassing a per-device cooldown.
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO deliveries(event_id,subscription_id,status,attempted_at) SELECT ?,?,'claimed',? WHERE NOT EXISTS (SELECT 1 FROM deliveries WHERE subscription_id=? AND event_id LIKE 'test:%' AND attempted_at>?)")
    .bind(eventId, sub.id, now, sub.id, now - 60000).run();
  if (claim.meta.changes !== 1) {
    const concurrent = await read();
    return concurrent ? result(concurrent, false) : { body: { error: "Wait one minute before requesting another test" }, status: 429 };
  }
  let status = "uncertain";
  try {
    const code = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, {
      title: "Saturday Signal: TEST",
      body: "This is a test notification, not a game alert. Tap to open Saturday Signal.",
      eventId, url: `${origin}/`,
    }, { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });
    status = code >= 200 && code < 300 ? "accepted" : `http-${code}`;
  } catch { /* Preserve the claim after an ambiguous failure; never resend automatically. */ }
  const changes = [env.DB.prepare("UPDATE deliveries SET status=? WHERE event_id=? AND subscription_id=?").bind(status, eventId, sub.id)];
  if (status === "http-404" || status === "http-410") changes.push(env.DB.prepare("UPDATE subscriptions SET active=0,updated_at=? WHERE id=?").bind(now, sub.id));
  // If persistence fails, leave the original claim intact and fail the request.
  // A repeat can inspect that claim, but cannot repeat the possibly completed send.
  try { await env.DB.batch(changes); }
  catch {
    return { status: 503, body: { ...result({ status: "claimed", attempted_at: now }, true).body,
      error: "An attempt was made but its result could not be saved. Do not send another test." } };
  }
  return result({ status, attempted_at: now }, true);
}
export async function saveGameStates(db: Database, games: Game[], now: number) {
  const { results } = await db.prepare("SELECT game_id,state_json,observed_at FROM game_states WHERE game_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(games.map(game => game.id))).all<{ game_id: string; state_json: string; observed_at: number }>();
  const stored = new Map(results.map(row => [row.game_id, row]));
  const events: AlertEvent[] = [], changed: { game: Game; json: string }[] = [];
  for (const game of games) {
    const previous = stored.get(game.id);
    const snapshot: Snapshot | null = previous ? { game: JSON.parse(previous.state_json), observedAt: previous.observed_at } : null;
    const nextEvents = transitions(snapshot, game, now), json = JSON.stringify(game);
    events.push(...nextEvents);
    // Clock-based kickoff transitions still advance even when ESPN's game data is unchanged.
    if (!previous || previous.state_json !== json || nextEvents.length) changed.push({ game, json });
  }
  const statements: Statement[] = [];
  for (let i = 0; i < events.length; i += 16) {
    const rows = events.slice(i, i + 16);
    statements.push(db.prepare(`INSERT OR IGNORE INTO alert_events(id,game_id,trigger,game_day,created_at,payload) VALUES ${rows.map(() => "(?,?,?,?,?,?)").join(",")}`).bind(...rows.flatMap(event => [event.id, event.gameId, event.trigger, event.gameDay, event.createdAt, JSON.stringify(event.payload)])));
  }
  for (let i = 0; i < changed.length; i += 25) {
    const rows = changed.slice(i, i + 25);
    statements.push(db.prepare(`INSERT INTO game_states(game_id,game_day,state_json,observed_at) VALUES ${rows.map(() => "(?,?,?,?)").join(",")} ON CONFLICT(game_id) DO UPDATE SET state_json=excluded.state_json,observed_at=excluded.observed_at`).bind(...rows.flatMap(({ game, json }) => [game.id, easternDate(new Date(game.date)), json, now])));
  }
  // A transactional batch keeps the baseline and alert history together. Bulk writes
  // stay below D1's 100 bound parameters and avoid one query per Saturday game.
  if (statements.length) await db.batch(statements);
}
export async function poll(env: Env, now = Date.now()) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  await setValue(env.DB, "last_tick", now).run();
  const due = await env.DB.prepare("SELECT value FROM poll_state WHERE id='next_poll'").first<{ value: number }>();
  if (due && due.value > now) return;
  const owner = crypto.randomUUID();
  const locked = await env.DB.prepare("INSERT INTO poll_lock(id,owner,expires_at) VALUES('scores',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE poll_lock.expires_at<=?").bind(owner, now + 10 * 60000, now).run();
  if (locked.meta.changes !== 1) return;
  try {
    const date = easternDate(new Date(now)), previousDate = shiftDate(date, -1);
    const failures: string[] = [];
    let board: ReturnType<typeof normalizeScoreboard> | null = null;
    for (const [source, url] of [["cdn", scoreboardCdnUrl()], ["site-api", scoreboardUrl(previousDate, date)]] as const) {
      try {
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.json();
        const candidate = source === "cdn" ? await completeCdnRange(raw, previousDate, date, false, AbortSignal.timeout(15000))
          : normalizeScoreboard(raw, previousDate, new Date(now).toISOString(), date);
        if (candidate.warnings?.length) throw new Error("scoreboard is incomplete");
        board = candidate;
        break;
      } catch (error) {
        failures.push(`${source}: ${error instanceof Error ? error.message : "unknown failure"}`);
      }
    }
    if (!board) throw new Error(`ESPN score feeds failed (${failures.join("; ")})`);
    await saveGameStates(env.DB, board.games, now);
    await deliver(env, now);
    await env.DB.batch([setValue(env.DB, "last_good_score", now), setValue(env.DB, "next_poll", nextPollAt(board.games, now))]);
  } finally {
    await env.DB.prepare("DELETE FROM poll_lock WHERE id='scores' AND owner=?").bind(owner).run();
  }
}
async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Use application/json");
  if (Number(request.headers.get("content-length")) > 12000) throw new Error("Request too large");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Missing body");
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12000) { await reader.cancel(); throw new Error("Request too large"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(buffer));
}
function allowedOrigin(origin: string | null, env: Env): origin is string {
  return !!origin && [env.SITE_ORIGIN, ...(env.ADDITIONAL_SITE_ORIGINS || "").split(",").map(value => value.trim())].includes(origin);
}
function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  return {
    ...(allowedOrigin(origin, env) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff",
  };
}
async function api(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin"), url = new URL(request.url);
  const headers = corsHeaders(origin, env);
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (origin && !allowedOrigin(origin, env)) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (url.pathname === "/config" && request.method === "GET") {
    const ticks = await env.DB.prepare("SELECT id,value FROM poll_state WHERE id IN ('last_tick','last_good_score')").all<{ id: string; value: number }>();
    const state = Object.fromEntries(ticks.results.map(row => [row.id, row.value]));
    const now = Date.now();
    const readinessReason = !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY ? "missing-vapid-config"
      : !state.last_tick ? "awaiting-first-poll-tick"
      : state.last_tick <= now - 180000 ? "stale-poll-tick"
      : !state.last_good_score ? "awaiting-first-successful-poll"
      : state.last_good_score <= now - 20 * 60000 ? "stale-score-feed" : "ready";
    return json({ ready: readinessReason === "ready", readinessReason, lastTickAt: state.last_tick ? new Date(state.last_tick).toISOString() : null, lastSuccessfulPollAt: state.last_good_score ? new Date(state.last_good_score).toISOString() : null, publicKey: env.VAPID_PUBLIC_KEY || "", version: VERSION });
  }
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (request.method === "POST" && url.pathname === "/subscriptions") {
    if (!allowedOrigin(origin, env)) return json({ error: "Origin required" }, 403);
    const body = await readBody(request), sub = await validSubscription(body.subscription);
    if (!sub || typeof body.kickoff !== "boolean") return json({ error: "Invalid subscription" }, 400);
    const id = await hash(sub.endpoint), existing = await env.DB.prepare("SELECT token_hash FROM subscriptions WHERE id=?").bind(id).first<{ token_hash: string }>();
    if (existing && (!token || await hash(token) !== existing.token_hash)) return json({ error: "Subscription already registered" }, 409);
    const secret = existing ? token : encode(crypto.getRandomValues(new Uint8Array(32)));
    const now = Date.now();
    await env.DB.prepare("INSERT INTO subscriptions(id,endpoint,p256dh,auth,token_hash,kickoff,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,kickoff=excluded.kickoff,active=1,updated_at=excluded.updated_at WHERE subscriptions.token_hash=excluded.token_hash").bind(id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, await hash(secret), body.kickoff ? 1 : 0, now, now).run();
    // A simultaneous registration may have won the unique key after our read.
    const actual = await env.DB.prepare("SELECT token_hash FROM subscriptions WHERE id=?").bind(id).first<{ token_hash: string }>();
    if (actual?.token_hash !== await hash(secret)) return json({ error: "Subscription already registered" }, 409);
    return json({ id, token: secret });
  }
  const match = /^\/subscriptions\/([A-Za-z0-9_-]{43})(\/test)?$/.exec(url.pathname);
  if (match) {
    const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(match[1]).first<StoredSubscription>();
    if (!sub || !token || await hash(token) !== sub.token_hash) return json({ error: "Subscription not found" }, 404);
    if (match[2]) {
      if (request.method !== "POST") return json({ error: "Not found" }, 404);
      if (!allowedOrigin(origin, env)) return json({ error: "Origin required" }, 403);
      const test = await testNotification(request, env, sub, origin);
      return json(test.body, test.status);
    }
    if (request.method === "GET") return json({ active: !!sub.active, kickoff: !!sub.kickoff });
    if (!allowedOrigin(origin, env)) return json({ error: "Origin required" }, 403);
    if (request.method === "DELETE") { await env.DB.prepare("UPDATE subscriptions SET active=0,updated_at=? WHERE id=?").bind(Date.now(), sub.id).run(); return json({ ok: true }); }
    if (request.method === "PATCH") { const body = await readBody(request); if (typeof body.kickoff !== "boolean") return json({ error: "Invalid preference" }, 400); await env.DB.prepare("UPDATE subscriptions SET kickoff=?,updated_at=? WHERE id=?").bind(body.kickoff ? 1 : 0, Date.now(), sub.id).run(); return json({ ok: true }); }
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(request: Request, env: Env) {
    try { return await api(request, env); }
    catch { return Response.json({ error: "Alert service request failed" }, { status: 400, headers: corsHeaders(request.headers.get("Origin"), env) }); }
  },
  async scheduled(_controller: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }) {
    context.waitUntil(poll(env).catch(error => { console.error(JSON.stringify({ event: "alert_poll_failed", message: error instanceof Error ? error.message : "Unknown failure" })); throw error; }));
  },
};
