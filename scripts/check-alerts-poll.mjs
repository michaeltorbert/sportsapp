// Read-only production-feed diagnostic. All database writes are in memory;
// no subscriptions are created and non-ESPN network requests are rejected.
import { bundle, database } from "../tests/helpers.mjs";
const { poll } = await bundle("services/alerts/worker.ts");
const { db, sqlite } = database();
const originalFetch = globalThis.fetch;
let feedStatus = null, feedUrl = null;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "site.api.espn.com" || url.pathname !== "/apis/site/v2/sports/football/college-football/scoreboard") throw new Error("Diagnostic permits only the ESPN scoreboard request");
  feedUrl = url.href;
  const response = await originalFetch(input, init);
  feedStatus = response.status;
  return response;
};
try {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", key.publicKey), jwk = await crypto.subtle.exportKey("jwk", key.privateKey);
  const now = Date.now();
  await poll({ DB: db, SITE_ORIGIN: "https://saturday-signal.mtorbert.chatgpt.site", VAPID_SUBJECT: "https://saturday-signal.mtorbert.chatgpt.site", VAPID_PUBLIC_KEY: Buffer.from(raw).toString("base64url"), VAPID_PRIVATE_KEY: jwk.d }, now);
  const states = sqlite.prepare("SELECT id,value FROM poll_state ORDER BY id").all();
  console.log(JSON.stringify({ success: true, checkedAt: new Date(now).toISOString(), feedUrl, feedStatus, games: sqlite.prepare("SELECT count(*) AS n FROM game_states").get().n, gamesByDay: sqlite.prepare("SELECT game_day,count(*) AS n FROM game_states GROUP BY game_day").all(), candidateAlerts: sqlite.prepare("SELECT trigger,count(*) AS n FROM alert_events GROUP BY trigger").all(), pollState: states, scope: "Local execution with live ESPN data and an empty in-memory subscription database; not a Cloudflare invocation or phone delivery test" }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, feedStatus, message: error instanceof Error ? error.message : String(error), scope: "Local poller diagnostic; Cloudflare invocation logs are still required to confirm the hosted failure" }, null, 2));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
}
