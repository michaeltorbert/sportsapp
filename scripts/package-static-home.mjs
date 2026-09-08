import assert from "node:assert/strict";
import { readFile, writeFile, stat, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export async function packageStaticHome(root, expectedCommit) {
await rm(new URL("dist/client/index.html", root), { force: true });
assert.match(expectedCommit, /^[a-f0-9]{40}$/, "Static homepage requires an exact source commit");
const version = JSON.parse(await readFile(new URL("package.json", root), "utf8")).version;
const index = JSON.parse(await readFile(new URL("dist/server/vinext-prerender.json", root), "utf8"));
assert.ok(index.routes.some(route => route.route === "/" && route.status === "rendered" && route.revalidate === false), "Homepage must be completely prerendered");
for (const name of ["/api/health", "/api/scores"]) assert.ok(index.routes.some(route => route.route === name && route.status === "skipped" && route.reason === "api"), `${name} must remain dynamic`);
assert.ok(index.routes.filter(route => route.route.startsWith("/api/")).every(route => route.status === "skipped" && route.reason === "api"), "Every API route must remain skipped");
const html = await readFile(new URL("dist/server/prerendered-routes/index.html", root), "utf8");
assert.match(html, /<html[\s>]/i);
assert.match(html, /<\/html>/i);
assert.match(html, /__VINEXT_RSC_DONE__/);
assert.match(html, /__VINEXT_RSC_CHUNKS__/);
// These shell-copy checks are completeness sentinels for the current page.
assert.match(html, /Your watchlist/);
assert.match(html, /Connecting to ESPN/);
// This build-time check requires the current compiled health route to remain
// importable in Node without Cloudflare-only bindings. Workerd is checked separately.
const { default: worker } = await import(new URL("dist/server/index.js", root));
const response = await worker.fetch(new Request("http://localhost/api/health"), {}, { waitUntil() {} });
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { version, commit: expectedCommit });
// Matches the pinned Vite/React output: double-quoted /assets/ references.
const scripts = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)[^"]*"/g)].map(match => match[1]);
assert.ok(scripts.length > 0, "Prerendered homepage must reference built assets");
for (const asset of new Set(scripts)) assert.ok((await stat(new URL(`dist/client${asset}`, root))).isFile(), asset);
const marker = `<!-- saturday-signal-static ${version} ${expectedCommit} -->`;
await writeFile(new URL("dist/client/index.html", root), `${marker}\n${html}`);
console.log(JSON.stringify({ staticHomepage: fileURLToPath(new URL("dist/client/index.html", root)), version, commit: expectedCommit, assets: new Set(scripts).size }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url);
  const commit = process.env.SOURCE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  await packageStaticHome(root, commit);
}
