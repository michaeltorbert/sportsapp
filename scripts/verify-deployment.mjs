import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { parse, printParseErrorCode } from "jsonc-parser";

const root = new URL("../", import.meta.url);
export function readAlertConfig(source = readFileSync(new URL("services/alerts/wrangler.jsonc", root), "utf8")) {
  const errors = [];
  const config = parse(source, errors, { allowTrailingComma: true });
  assert.equal(errors.length, 0, `Invalid alert configuration: ${errors.map(error => printParseErrorCode(error.error)).join(", ")}`);
  assert.equal(typeof config?.vars?.SITE_ORIGIN, "string", "Alert SITE_ORIGIN is required");
  assert.equal(new URL(config.vars.SITE_ORIGIN).origin, config.vars.SITE_ORIGIN, "SITE_ORIGIN must be an exact origin");
  return config;
}
export async function verifyDeployment({ origin, commit, version, fetcher = fetch, alertsUrl, alertOrigins = [] }) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  const request = async (url, options = {}) => {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000), redirect: "error" });
    assert.equal(response.ok, true, `${url} returned HTTP ${response.status}`);
    return response;
  };
  const health = await (await request(`${origin}/api/health`)).json();
  assert.equal(health.version, version, "Wrong deployed app version");
  assert.equal(health.commit, commit, "Wrong deployed source commit");
  assert.match(await (await request(origin)).text(), /Saturday Signal/);
  const manifest = await (await request(`${origin}/manifest.webmanifest`)).json();
  assert.equal(manifest.start_url, "/");
  const serviceWorker = await request(`${origin}/sw.js`);
  assert.match(serviceWorker.headers.get("content-type") || "", /javascript/);
  assert.match(await serviceWorker.text(), /push/);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const scores = await (await request(`${origin}/api/scores?date=${date}`)).json();
  assert.equal(scores.date, date);
  assert.equal(scores.endDate, date);
  assert.ok(Array.isArray(scores.games) && Number.isFinite(Date.parse(scores.fetchedAt)), "Invalid scores");
  assert.ok(!scores.stale && !scores.warnings?.length, "Score feed is stale or partial");
  if (alertsUrl) for (const allowedOrigin of alertOrigins) {
    const response = await request(`${alertsUrl}/config`, { headers: { Origin: allowedOrigin } });
    assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin, "Alert origin was not accepted");
    const alerts = await response.json();
    assert.equal(alerts.version, version, "Wrong deployed alert version");
    assert.equal(alerts.ready, true, `Alerts are not ready: ${alerts.readinessReason}`);
  }
  return { origin, version, commit, scoreDate: date, games: scores.games.length, alertOrigins };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = readAlertConfig();
  const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const { serviceUrl: alertsUrl } = JSON.parse(readFileSync(new URL("public/alerts-config.json", root), "utf8"));
  const origin = process.env.DEPLOYMENT_URL || "https://saturday-signal.scythe-wildflower.workers.dev";
  // Preview checks never subscribe a device or use the alert database.
  const checkAlerts = process.env.VERIFY_ALERTS !== "false";
  let error;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      console.log(JSON.stringify(await verifyDeployment({ origin, commit: process.env.SOURCE_COMMIT, version,
        alertsUrl: checkAlerts ? alertsUrl : undefined,
        alertOrigins: checkAlerts ? [config.vars.SITE_ORIGIN, origin] : [],
      })));
      error = null; break;
    } catch (failure) {
      error = failure;
      console.error(`Deployment verification attempt ${attempt + 1}: ${failure.message}`);
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
  if (error) throw error;
}
