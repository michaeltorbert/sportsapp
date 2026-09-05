import { normalizeScoreboard, scoreboardUrl } from "../../lib/espn-data";
import { easternDate, shiftDate } from "../../lib/football";
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
export type Env = { DB: Database; SITE_ORIGIN: string; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };
type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string; token_hash: string; kickoff: number; active: number; created_at: number };
type StoredEvent = { id: string; trigger: string; payload: string; created_at: number };
const setValue = (db: Database, id: string, value: number) => db.prepare("INSERT INTO poll_state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(id, value);

export async function claimDelivery(db: Database, eventId: string, subscriptionId: string, now: number) {
  const result = await db.prepare("INSERT OR IGNORE INTO deliveries(event_id,subscription_id,status,attempted_at) VALUES(?,?,?,?)").bind(eventId, subscriptionId, "claimed", now).run();
  return result.meta.changes === 1;
}
async function deliver(env: Env, now: number) {
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
    const response = await fetch(scoreboardUrl(previousDate, date), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
    const board = normalizeScoreboard(await response.json(), previousDate, new Date(now).toISOString(), date);
    if (board.warnings?.length) throw new Error("Scoreboard is incomplete");
    for (const game of board.games) {
      const previous = await env.DB.prepare("SELECT state_json,observed_at FROM game_states WHERE game_id=?").bind(game.id).first<{ state_json: string; observed_at: number }>();
      const snapshot: Snapshot | null = previous ? { game: JSON.parse(previous.state_json), observedAt: previous.observed_at } : null;
      const events: AlertEvent[] = transitions(snapshot, game, now);
      // D1 batch is transactional: do not advance game state without saving its events.
      await env.DB.batch([
        ...events.map(event => env.DB.prepare("INSERT OR IGNORE INTO alert_events(id,game_id,trigger,game_day,created_at,payload) VALUES(?,?,?,?,?,?)").bind(event.id, event.gameId, event.trigger, event.gameDay, event.createdAt, JSON.stringify(event.payload))),
        env.DB.prepare("INSERT INTO game_states(game_id,game_day,state_json,observed_at) VALUES(?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET state_json=excluded.state_json,observed_at=excluded.observed_at").bind(game.id, easternDate(new Date(game.date)), JSON.stringify(game), now),
      ]);
    }
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
async function api(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin"), url = new URL(request.url);
  const headers = { "Access-Control-Allow-Origin": env.SITE_ORIGIN, "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (origin && origin !== env.SITE_ORIGIN) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (url.pathname === "/config" && request.method === "GET") {
    const ticks = await env.DB.prepare("SELECT id,value FROM poll_state WHERE id IN ('last_tick','last_good_score')").all<{ id: string; value: number }>();
    const state = Object.fromEntries(ticks.results.map(row => [row.id, row.value]));
    return json({ ready: !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY && state.last_tick > Date.now() - 180000 && state.last_good_score > Date.now() - 20 * 60000, publicKey: env.VAPID_PUBLIC_KEY || "", version: "1.1.0" });
  }
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (request.method === "POST" && url.pathname === "/subscriptions") {
    if (origin !== env.SITE_ORIGIN) return json({ error: "Origin required" }, 403);
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
  const match = /^\/subscriptions\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  if (match) {
    const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(match[1]).first<StoredSubscription>();
    if (!sub || !token || await hash(token) !== sub.token_hash) return json({ error: "Subscription not found" }, 404);
    if (request.method === "GET") return json({ active: !!sub.active, kickoff: !!sub.kickoff });
    if (origin !== env.SITE_ORIGIN) return json({ error: "Origin required" }, 403);
    if (request.method === "DELETE") { await env.DB.prepare("UPDATE subscriptions SET active=0,updated_at=? WHERE id=?").bind(Date.now(), sub.id).run(); return json({ ok: true }); }
    if (request.method === "PATCH") { const body = await readBody(request); if (typeof body.kickoff !== "boolean") return json({ error: "Invalid preference" }, 400); await env.DB.prepare("UPDATE subscriptions SET kickoff=?,updated_at=? WHERE id=?").bind(body.kickoff ? 1 : 0, Date.now(), sub.id).run(); return json({ ok: true }); }
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(request: Request, env: Env) {
    try { return await api(request, env); }
    catch { return Response.json({ error: "Alert service request failed" }, { status: 400, headers: { "Access-Control-Allow-Origin": env.SITE_ORIGIN, "Cache-Control": "no-store" } }); }
  },
  async scheduled(_controller: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }) {
    context.waitUntil(poll(env).catch(error => { console.error(JSON.stringify({ event: "alert_poll_failed", message: error instanceof Error ? error.message : "Unknown failure" })); throw error; }));
  },
};
