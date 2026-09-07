import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";

// The committed Workers declarations must describe the website's actual
// configuration: the generated Env lists exactly the configured bindings, and
// the runtime section matches the pinned local runtime and compatibility date.
// `npm run typecheck` additionally asks Wrangler itself whether the file is stale.
const root = new URL("..", import.meta.url);
const declarations = readFileSync(new URL("worker-configuration.d.ts", root), "utf8");
const config = parse(readFileSync(new URL("wrangler.jsonc", root), "utf8"));
const runtime = JSON.parse(readFileSync(new URL("node_modules/workerd/package.json", root), "utf8")).version;

test("generated Worker declarations match wrangler.jsonc bindings and the pinned runtime", () => {
  const env = /interface __BaseEnv_Env \{\n([\s\S]*?)\}/.exec(declarations)?.[1].trim();
  assert.equal(env, `${config.assets.binding}: Fetcher;`, "the website declares only its assets binding");
  assert.equal(config.d1_databases, undefined, "the production website has no database binding");
  assert.match(declarations, new RegExp(`Runtime types generated with workerd@${runtime.replaceAll(".", "\\.")} ${config.compatibility_date} ${config.compatibility_flags.join(" ")}\\n`));
  assert.match(declarations, /declare module 'cloudflare:workers'/);
  assert.match(declarations, /export const env: Cloudflare\.Env;/);
});
