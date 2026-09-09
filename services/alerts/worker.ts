import { completeCdnRange } from "../../lib/espn-cdn";
import { VERSION } from "../../lib/releases";
import { normalizeScoreboard, scoreboardCdnUrl, scoreboardUrl } from "../../lib/espn-data";
import { easternDate, shiftDate, type Game } from "../../lib/football";
import { conditions, nextPollAt, transitions, type AlertEvent, type Snapshot, type Trigger } from "./rules";
import { retainExpectation } from "./expectation";
import { activationBaselines, forTrigger, preferences, preferenceTypes, status as preferenceStatus, validPatch, type Settings, type Preference } from "./preferences";
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
type StoredEvent = { id: string; game_id: string; trigger: Trigger; payload: string; created_at: number };
const setValue = (db: Database, id: string, value: number) => db.prepare("INSERT INTO poll_state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(id, value);

export async function claimDelivery(db: Database, eventId: string, subscriptionId: string, now: number) {
  const live = /^(.*):(one-score-fourth|ranked-trailing-fourth)$/.exec(eventId);
  const result = await db.prepare("INSERT OR IGNORE INTO deliveries(event_id,subscription_id,status,attempted_at) SELECT ?,?,'claimed',? WHERE NOT EXISTS(SELECT 1 FROM deliveries WHERE subscription_id=? AND event_id IN (?,?))")
    .bind(eventId, subscriptionId, now, subscriptionId, live ? `${live[1]}:one-score-fourth` : eventId, live ? `${live[1]}:ranked-trailing-fourth` : eventId).run();
  return result.meta.changes === 1;
}
export async function deliver(env: Env, now: number, games: Game[]) {
  const enabled = await env.DB.prepare("SELECT value FROM poll_state WHERE id='preferences_delivery_enabled'").first<{ value: number }>();
  if (enabled?.value !== 1) return;
  const subscriber = await env.DB.prepare("SELECT id FROM subscriptions WHERE active=1 LIMIT 1").first();
  if (!subscriber) return;
  const { results: events } = await env.DB.prepare("SELECT id,game_id,trigger,payload,created_at FROM alert_events WHERE created_at >= ? AND created_at > (SELECT value FROM poll_state WHERE id='preferences_epoch') ORDER BY created_at,CASE trigger WHEN 'ranked-trailing-fourth' THEN 0 ELSE 1 END,id").bind(now - 180000).all<StoredEvent>();
  const current = new Map(games.map(game => [game.id, game]));
  for (const event of events) {
    const game = current.get(event.game_id);
    if (!game || !Object.values(preferences).some(p => p.trigger === event.trigger) || !conditions(game, now)[event.trigger]) continue;
    const pref = forTrigger(event.trigger), flag = event.trigger === "acc-kickoff" ? "s.kickoff" : `p.${pref.column}`;
    const live = event.trigger === "one-score-fourth" || event.trigger === "ranked-trailing-fourth";
    let after = "";
    for (;;) {
      const { results: subscribers } = await env.DB.prepare(`SELECT s.*,p.revision FROM subscriptions s JOIN subscription_settings p ON p.subscription_id=s.id WHERE s.active=1 AND s.id>? AND s.created_at<=? AND ${flag}=1 AND (p.pending & ${pref.bit})=0 AND p.${pref.since}<? ORDER BY s.id LIMIT 100`).bind(after, event.created_at, event.created_at).all<StoredSubscription & { revision: number }>();
      if (!subscribers.length) break;
      for (let i = 0; i < subscribers.length; i += 8) await Promise.all(subscribers.slice(i, i + 8).map(async sub => {
        // Eligibility and both sibling attempts are tested in the same atomic
        // statement. A stale recipient page cannot bypass a concurrent opt-out.
        const claim = await env.DB.prepare(`INSERT OR IGNORE INTO deliveries(event_id,subscription_id,status,attempted_at)
          SELECT ?,s.id,'claimed',? FROM subscriptions s JOIN subscription_settings p ON p.subscription_id=s.id
          WHERE s.id=? AND s.active=1 AND p.revision=? AND ${flag}=1 AND (p.pending & ${pref.bit})=0 AND p.${pref.since}<?
          AND NOT EXISTS(SELECT 1 FROM deliveries WHERE subscription_id=s.id AND event_id IN (?,?))
          AND NOT EXISTS(SELECT 1 FROM alert_suppressions WHERE subscription_id=s.id AND game_id=? AND trigger=?)
          AND NOT EXISTS(SELECT 1 FROM rule_baselines WHERE game_id=? AND trigger=?)
          AND (SELECT value FROM poll_state WHERE id='preferences_delivery_enabled')=1
          AND (SELECT value FROM poll_state WHERE id='preferences_epoch')>0
          AND ?>(SELECT value FROM poll_state WHERE id='preferences_epoch')`)
          .bind(event.id, now, sub.id, sub.revision, event.created_at, live ? `${event.game_id}:one-score-fourth` : event.id, live ? `${event.game_id}:ranked-trailing-fourth` : event.id, event.game_id, event.trigger, event.game_id, event.trigger, event.created_at).run();
        if (claim.meta.changes !== 1) return;
        const stillActive = await env.DB.prepare("SELECT s.id FROM subscriptions s JOIN subscription_settings p ON p.subscription_id=s.id WHERE s.id=? AND s.active=1 AND p.revision=? AND (SELECT value FROM poll_state WHERE id='preferences_delivery_enabled')=1").bind(sub.id, sub.revision).first();
        if (!stillActive) { await env.DB.prepare("UPDATE deliveries SET status='suppressed' WHERE event_id=? AND subscription_id=?").bind(event.id, sub.id).run(); return; }
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
export async function saveGameStates(db: Database, games: Game[], now: number, baseline = false) {
  const { results } = await db.prepare("SELECT game_id,state_json,observed_at FROM game_states WHERE game_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(games.map(game => game.id))).all<{ game_id: string; state_json: string; observed_at: number }>();
  const stored = new Map(results.map(row => [row.game_id, row]));
  const events: AlertEvent[] = [], changed: { game: Game; json: string }[] = [];
  const retained: Game[] = [];
  for (const raw of games) {
    const previous = stored.get(raw.id);
    const snapshot: Snapshot | null = previous ? { game: JSON.parse(previous.state_json), observedAt: previous.observed_at } : null;
    const game = retainExpectation(raw, snapshot?.game, now); retained.push(game);
    const nextEvents = baseline ? [] : transitions(snapshot, game, now), json = JSON.stringify(game);
    events.push(...nextEvents);
    // Clock-based kickoff transitions still advance even when ESPN's game data is unchanged.
    if (!previous || previous.state_json !== json || nextEvents.length) changed.push({ game, json });
  }
  const statements: Statement[] = [];
  if (baseline) {
    const rows = retained.flatMap(game => Object.entries(conditions(game, now)).filter(([, value]) => value).map(([trigger]) => [game.id, trigger]));
    statements.push(db.prepare("INSERT OR IGNORE INTO rule_baselines(game_id,trigger,observed_at) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),? FROM json_each(?)").bind(now, JSON.stringify(rows)));
    statements.push(setValue(db, "preferences_epoch", now));
  }
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
  return retained;
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
        const signal = AbortSignal.timeout(15000);
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.json();
        const candidate = source === "cdn" ? await completeCdnRange(raw, previousDate, date, false, signal)
          : normalizeScoreboard(raw, previousDate, new Date(now).toISOString(), date);
        if (candidate.warnings?.length) throw new Error("scoreboard is incomplete");
        board = candidate;
        break;
      } catch (error) {
        failures.push(`${source}: ${error instanceof Error ? error.message : "unknown failure"}`);
      }
    }
    if (!board) throw new Error(`ESPN score feeds failed (${failures.join("; ")})`);
    const epoch = await env.DB.prepare("SELECT value FROM poll_state WHERE id='preferences_epoch'").first<{ value: number }>();
    const games = await saveGameStates(env.DB, board.games, now, !epoch?.value);
    await activationBaselines(env.DB, games, now);
    await deliver(env, now, games);
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
async function readSettings(db: Database, id: string) { return (await db.prepare("SELECT * FROM subscription_settings WHERE subscription_id=?").bind(id).first<Settings>())!; }
async function readStatus(db: Database, id: string) {
  const row = (await db.prepare("SELECT s.active,s.kickoff,p.* FROM subscriptions s JOIN subscription_settings p ON p.subscription_id=s.id WHERE s.id=?").bind(id).first<Settings & { active: number; kickoff: number }>())!;
  return preferenceStatus(row.active, row.kickoff, row);
}
async function changeSettings(db: Database, sub: StoredSubscription, patch: Partial<Record<Preference | "active", boolean>> & { revision?: number }, now: number) {
  const settings = await readSettings(db, sub.id);
  sub = (await db.prepare("SELECT * FROM subscriptions WHERE id=?").bind(sub.id).first<StoredSubscription>())!;
  if (patch.revision !== undefined && patch.revision !== settings.revision) return false;
  const active = patch.active === undefined ? sub.active : Number(patch.active);
  const kickoff = patch.kickoff === undefined ? sub.kickoff : Number(patch.kickoff);
  const values = { closeGame: settings.close_game, upsetWatch: settings.upset_watch, upsetFinal: settings.upset_final, kickoff };
  let pending = settings.pending;
  for (const key of preferenceTypes) {
    const p = preferences[key], was = p.column === "kickoff" ? sub.kickoff : settings[p.column];
    values[key] = patch[key] === undefined ? was : Number(patch[key]);
    if (!values[key]) pending &= ~p.bit;
    if (values[key] && (!was || (!sub.active && active))) { settings[p.since] = now; pending |= p.bit; }
  }
  const changed = active !== sub.active || kickoff !== sub.kickoff || values.closeGame !== settings.close_game || values.upsetWatch !== settings.upset_watch || values.upsetFinal !== settings.upset_final;
  if (!changed) return true;
  const result = await db.batch([
    db.prepare("UPDATE subscriptions SET active=?,kickoff=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM subscription_settings WHERE subscription_id=? AND revision=?)").bind(active, kickoff, now, sub.id, sub.id, settings.revision),
    db.prepare("UPDATE subscription_settings SET close_game=?,upset_watch=?,upset_final=?,close_since=?,upset_since=?,final_since=?,kickoff_since=?,pending=?,revision=revision+1 WHERE subscription_id=? AND revision=?")
      .bind(values.closeGame, values.upsetWatch, values.upsetFinal, settings.close_since, settings.upset_since, settings.final_since, settings.kickoff_since, pending, sub.id, settings.revision),
  ]);
  return result[1].meta.changes === 1;
}
async function api(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin"), url = new URL(request.url);
  const headers = corsHeaders(origin, env);
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (origin && !allowedOrigin(origin, env)) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (url.pathname === "/config" && request.method === "GET") {
    const ticks = await env.DB.prepare("SELECT id,value FROM poll_state WHERE id IN ('last_tick','last_good_score','preferences_delivery_enabled','preferences_epoch')").all<{ id: string; value: number }>();
    const state = Object.fromEntries(ticks.results.map(row => [row.id, row.value]));
    const now = Date.now();
    const readinessReason = !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY ? "missing-vapid-config"
      : state.preferences_delivery_enabled !== 1 ? "preferences-rollout-paused"
      : !state.preferences_epoch ? "awaiting-preferences-baseline"
      : !state.last_tick ? "awaiting-first-poll-tick"
      : state.last_tick <= now - 180000 ? "stale-poll-tick"
      : !state.last_good_score ? "awaiting-first-successful-poll"
      : state.last_good_score <= now - 20 * 60000 ? "stale-score-feed" : "ready";
    const preferencesReady = !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY && state.preferences_delivery_enabled === 1 && state.preferences_epoch > 0;
    return json({ ready: readinessReason === "ready", readinessReason, preferencesReady, lastTickAt: state.last_tick ? new Date(state.last_tick).toISOString() : null, lastSuccessfulPollAt: state.last_good_score ? new Date(state.last_good_score).toISOString() : null, publicKey: env.VAPID_PUBLIC_KEY || "", version: VERSION, preferencesVersion: 1 });
  }
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (request.method === "POST" && url.pathname === "/subscriptions") {
    if (!allowedOrigin(origin, env)) return json({ error: "Origin required" }, 403);
    const body = await readBody(request), sub = await validSubscription(body.subscription);
    if (!sub || typeof body.kickoff !== "boolean") return json({ error: "Invalid subscription" }, 400);
    const selected = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "subscription"));
    if (!validPatch(selected)) return json({ error: "Invalid preferences" }, 400);
    const id = await hash(sub.endpoint), existing = await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(id).first<StoredSubscription>();
    if (existing && (!token || await hash(token) !== existing.token_hash)) return json({ error: "Subscription already registered" }, 409);
    const secret = existing ? token : encode(crypto.getRandomValues(new Uint8Array(32)));
    const now = Date.now();
    if (existing) {
      if (!await changeSettings(env.DB, existing, { ...selected, active: true }, now)) return json({ error: "Settings changed. Reload and try again." }, 409);
      await env.DB.prepare("UPDATE subscriptions SET p256dh=?,auth=? WHERE id=? AND token_hash=?").bind(sub.keys.p256dh, sub.keys.auth, id, await hash(secret)).run();
    } else {
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO subscriptions(id,endpoint,p256dh,auth,token_hash,kickoff,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)").bind(id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, await hash(secret), body.kickoff ? 1 : 0, now, now),
        env.DB.prepare("UPDATE subscription_settings SET close_game=?,upset_watch=?,upset_final=?,close_since=?,upset_since=?,final_since=?,kickoff_since=?,pending=? WHERE subscription_id=? AND EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND token_hash=?)")
          .bind(Number(body.closeGame === true), Number(body.upsetWatch !== false), Number(body.upsetFinal === true), now, now, now, now, Number(body.closeGame === true) + 2 * Number(body.upsetWatch !== false) + 4 * Number(body.upsetFinal === true) + 8 * Number(body.kickoff === true), id, id, await hash(secret)),
      ]);
    }
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
    if (request.method === "GET") return json(await readStatus(env.DB, sub.id));
    if (!allowedOrigin(origin, env)) return json({ error: "Origin required" }, 403);
    if (request.method === "DELETE") { const ok = await changeSettings(env.DB, sub, { active: false }, Date.now()); return json({ ok }, ok ? 200 : 409); }
    if (request.method === "PATCH") {
      const body = await readBody(request);
      if (!validPatch(body)) return json({ error: "Invalid preference" }, 400);
      if (!await changeSettings(env.DB, sub, body, Date.now())) return json({ error: "Settings changed. Reload and try again." }, 409);
      return json(await readStatus(env.DB, sub.id));
    }
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
