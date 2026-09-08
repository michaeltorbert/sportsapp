// The build has already selected the preview environment. Applying it again to
// an explicit compiled config makes Wrangler append a second "-preview" suffix.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { unstable_readConfig } from "wrangler";

export const PREVIEW_WORKER = "saturday-signal-preview";
export function previewDeployment(cwd = process.cwd(), dryRun = false, environment = process.env) {
  const configPath = resolve(cwd, "dist/server/wrangler.json");
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  if (raw.name !== PREVIEW_WORKER) throw new Error(`Expected compiled preview Worker ${PREVIEW_WORKER}; rebuild with CLOUDFLARE_ENV=preview.`);
  // Use the pinned Wrangler resolver, with the same explicit empty environment
  // passed to the deploy command, to verify the effective destination pre-write.
  const config = unstable_readConfig({ config: configPath, env: "" });
  if (config.name !== PREVIEW_WORKER) throw new Error("Resolved preview Worker does not match the expected destination.");
  const env = { ...environment };
  delete env.CLOUDFLARE_ENV;
  return { name: config.name, env, args: [resolve(cwd, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", configPath, "--env", "", ...(dryRun ? ["--dry-run"] : [])] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== "--dry-run") || flags.length > 1) throw new Error("Only --dry-run is supported.");
  const plan = previewDeployment(process.cwd(), flags.includes("--dry-run"));
  console.log(JSON.stringify({ event: "preview_deployment_target", name: plan.name, dryRun: flags.includes("--dry-run") }));
  const result = spawnSync(process.execPath, plan.args, { env: plan.env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
