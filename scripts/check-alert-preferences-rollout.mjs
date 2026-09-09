// Read-only release guard. Migration, old-worker drain and activation are an
// explicitly authorized operator procedure, never automatic release side effects.
export function checkRollout(config) {
  if (config?.preferencesVersion !== 1 || config?.ready !== true) throw new Error("Complete docs/alert-preferences-rollout.md before deploying this paired release.");
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const response = await fetch("https://saturday-signal-alerts.scythe-wildflower.workers.dev/config", { headers: { Origin: "https://saturday-signal.scythe-wildflower.workers.dev" }, signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!response.ok) throw new Error(`Alert rollout preflight failed: HTTP ${response.status}`);
  checkRollout(await response.json());
  console.log("Compatible alert preferences service is ready; operator drain evidence remains required.");
}
