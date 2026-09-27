// Opt-in local poll diagnostic. Only the poller's exact ESPN scoreboard reads
// may leave this process; push destinations and redirects are never followed.
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundle, database } from "../tests/helpers.mjs";

const [{ poll }, { scoreboardCdnUrl, scoreboardUrl }, { easternDate, shiftDate }] = await Promise.all([
  bundle("services/alerts/worker.ts"), bundle("lib/espn-data.ts"), bundle("lib/football.ts"),
]);

function requestUrl(input) {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  if (input instanceof Request) return new URL(input.url);
  throw new Error("Unsupported request type");
}

function safeDestination(input) {
  // A blocked push URL's path can contain a subscription identifier.
  try { const url = requestUrl(input); return url.origin; }
  catch { return "invalid URL"; }
}

export function classifyRequest(input, init = {}, now = Date.now()) {
  const url = requestUrl(input);
  const method = init.method || (input instanceof Request ? input.method : "GET");
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init.headers) for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  if (method.toUpperCase() !== "GET" || init.body != null || (input instanceof Request && input.body != null))
    throw new Error("Only scoreboard GET requests are permitted");
  if ([...headers].some(([name, value]) => name !== "accept" || value !== "application/json"))
    throw new Error("Only the scoreboard Accept header is permitted");
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Only plain HTTPS scoreboard URLs are permitted");

  const cdn = scoreboardCdnUrl();
  if (url.href === cdn) return { source: "cdn", url: url.href };

  const base = new URL(cdn);
  if (url.origin === base.origin && url.pathname === base.pathname) {
    const year = url.searchParams.get("year"), season = url.searchParams.get("seasontype"), week = url.searchParams.get("week");
    if (url.searchParams.size === 5 && [year, season, week].every(value => value !== null && /^[1-9]\d*$/.test(value))) {
      base.searchParams.set("year", year);
      base.searchParams.set("seasontype", season);
      base.searchParams.set("week", week);
      if (url.href === base.href) return { source: "cdn-week", url: url.href };
    }
  }

  const today = easternDate(new Date(now));
  if (url.href === scoreboardUrl(shiftDate(today, -1), today)) return { source: "site-api", url: url.href };
  throw new Error("Destination is outside the exact ESPN scoreboard allowlist");
}

export function guardedFetch(upstream, now, attempts, blocked) {
  const counts = { cdn: 0, "cdn-week": 0, "site-api": 0 };
  return async (input, init = {}) => {
    let request;
    try {
      request = classifyRequest(input, init, now);
      const cap = request.source === "cdn-week" ? 3 : 1;
      if (++counts[request.source] > cap || (request.source === "cdn-week" && !counts.cdn))
        throw new Error("Scoreboard request count or order exceeded the diagnostic limit");
    } catch (error) {
      blocked.push({ destination: safeDestination(input), reason: error instanceof Error ? error.message : "Invalid request" });
      throw new Error("Diagnostic blocked a non-allowlisted request");
    }
    const attempt = { source: request.source, url: request.url };
    attempts.push(attempt);
    try {
      // Rebuild the request so no caller body/credentials/headers can escape.
      const response = await upstream(request.url, {
        method: "GET", headers: { Accept: "application/json" },
        signal: init.signal || (input instanceof Request ? input.signal : undefined),
        redirect: "manual",
      });
      attempt.status = response.status;
      return response;
    } catch (error) {
      const code = error instanceof Error && typeof error.cause?.code === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.cause.code)
        ? ` (${error.cause.code})` : "";
      attempt.networkError = error instanceof Error ? `${error.message}${code}` : "Unknown request failure";
      throw error;
    }
  };
}

export async function runDiagnostic({ now = Date.now(), upstream = globalThis.fetch, fixture } = {}) {
  const ownDatabase = !fixture;
  const { db, sqlite } = fixture || database();
  const originalFetch = globalThis.fetch, attempts = [], blocked = [];
  const scope = "Local poll with live ESPN data only when run from the CLI; not evidence of Cloudflare execution, a production feed failure, or phone delivery";
  globalThis.fetch = guardedFetch(upstream, now, attempts, blocked);
  try {
    const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = await crypto.subtle.exportKey("raw", key.publicKey), jwk = await crypto.subtle.exportKey("jwk", key.privateKey);
    let failure;
    try {
      await poll({ DB: db, SITE_ORIGIN: "https://saturday-signal.mtorbert.chatgpt.site",
        VAPID_SUBJECT: "https://saturday-signal.mtorbert.chatgpt.site",
        VAPID_PUBLIC_KEY: Buffer.from(raw).toString("base64url"), VAPID_PRIVATE_KEY: jwk.d }, now);
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    const subscriptions = sqlite.prepare("SELECT count(*) AS n FROM subscriptions").get().n;
    const deliveries = sqlite.prepare("SELECT count(*) AS n FROM deliveries").get().n;
    const common = { checkedAt: new Date(now).toISOString(), attempts, blocked, subscriptions, deliveries, scope };
    if (blocked.length) return { success: false, attribution: "diagnostic-allowlist", message: "Diagnostic blocked a request outside its scoreboard allowlist", ...common };
    // The production poller has no typed error result. Match only its aggregate
    // feed error; a later database error must remain a local-poller failure.
    if (failure) return { success: false,
      attribution: failure.startsWith("ESPN score feeds failed (") ? "score-feed-attempts" : "local-poller",
      message: failure, ...common };
    if (!attempts.length) return { success: false, attribution: "poll-not-executed", message: "Poll made no scoreboard request", ...common };
    const acceptedSource = attempts.some(attempt => attempt.source === "site-api") ? "site-api" : "cdn";
    const cdnAttempts = attempts.filter(attempt => attempt.source.startsWith("cdn"));
    const cdnFallback = acceptedSource === "site-api" ?
      cdnAttempts.some(attempt => attempt.networkError) ? "network-error" :
      cdnAttempts.some(attempt => attempt.status >= 300 && attempt.status < 400) ? "redirect-not-followed" :
      cdnAttempts.some(attempt => !(attempt.status >= 200 && attempt.status < 300)) ? "http-error" : "response-rejected" : null;
    return { success: true, acceptedSource, cdnFallback,
      games: sqlite.prepare("SELECT count(*) AS n FROM game_states").get().n,
      gamesByDay: sqlite.prepare("SELECT game_day,count(*) AS n FROM game_states GROUP BY game_day").all(),
      candidateAlerts: sqlite.prepare("SELECT trigger,count(*) AS n FROM alert_events GROUP BY trigger").all(),
      pollState: sqlite.prepare("SELECT id,value FROM poll_state ORDER BY id").all(), ...common };
  } finally {
    globalThis.fetch = originalFetch;
    if (ownDatabase) sqlite.close();
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isDirectInvocation()) {
  try {
    const result = await runDiagnostic();
    (result.success ? console.log : console.error)(JSON.stringify(result, null, 2));
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ success: false, attribution: "local-diagnostic", message: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
