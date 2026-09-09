// Read-only release guard. Migration, old-worker drain and activation are an
// explicitly authorized operator procedure, never automatic release side effects.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
export function checkRollout(config) {
  if (config?.preferencesVersion !== 1 || config?.preferencesCutoverComplete !== true) throw new Error("Complete docs/alert-preferences-rollout.md before deploying this paired release.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = JSON.parse(await readFile(new URL("../public/alerts-config.json", import.meta.url), "utf8"));
  const service = new URL(settings.serviceUrl);
  if (service.protocol !== "https:") throw new Error("Alert service must use HTTPS");
  const response = await fetch(new URL("/config", service), { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!response.ok) throw new Error(`Alert rollout preflight failed: HTTP ${response.status}`);
  checkRollout(await response.json());
  console.log("Alert preference cutover is complete; normal post-deployment readiness verification still applies.");
}
