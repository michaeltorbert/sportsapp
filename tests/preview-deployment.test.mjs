import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_readConfig } from "wrangler";
import { previewDeployment, PREVIEW_WORKER } from "../scripts/deploy-preview.mjs";

function compiled(t, name = PREVIEW_WORKER) {
  const cwd = mkdtempSync(join(tmpdir(), "preview-target-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "dist/server"), { recursive: true });
  const config = join(cwd, "dist/server/wrangler.json");
  writeFileSync(config, JSON.stringify({ name, main: "index.js", compatibility_date: "2026-09-01" }));
  return { cwd, config };
}

test("compiled preview deployment clears build environment and resolves the intended Worker", t => {
  const { cwd, config } = compiled(t);
  // Exercise the actual locked Wrangler parser, not a copied naming algorithm.
  assert.equal(unstable_readConfig({ config, env: "preview" }).name, "saturday-signal-preview-preview");
  for (const dryRun of [true, false]) {
    const plan = previewDeployment(cwd, dryRun, { CLOUDFLARE_ENV: "preview", PATH: "preserved" });
    assert.equal(plan.name, PREVIEW_WORKER);
    assert.equal(plan.env.CLOUDFLARE_ENV, undefined);
    assert.equal(plan.env.PATH, "preserved");
    assert.equal(plan.args[plan.args.indexOf("--env") + 1], "");
    assert.equal(unstable_readConfig({ config, env: plan.args[plan.args.indexOf("--env") + 1] }).name, PREVIEW_WORKER);
    assert.equal(plan.args.includes("--dry-run"), dryRun);
  }
});

for (const name of ["saturday-signal", "saturday-signal-alerts", "saturday-signal-preview-preview"]) test(`preview guard rejects ${name} before deployment`, t => {
  const { cwd } = compiled(t, name);
  assert.throws(() => previewDeployment(cwd), /Expected compiled preview Worker/);
});

test("preview workflow guards both dry run and deploy without changing production commands", () => {
  const workflow = readFileSync(new URL("../.github/workflows/preview.yml", import.meta.url), "utf8");
  assert.match(workflow, /node scripts\/deploy-preview\.mjs --dry-run/);
  assert.match(workflow, /node scripts\/deploy-preview\.mjs\n/);
  assert.doesNotMatch(workflow, /npm run deploy:(app|check)/);
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).scripts;
  assert.equal(scripts["deploy:app"], "WRANGLER_LOG_PATH=.wrangler/logs wrangler deploy --config dist/server/wrangler.json");
});
