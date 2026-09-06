import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

test("renders the mobile scoreboard shell and app metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /Saturday Signal/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /manifest.webmanifest/);
  assert.match(html, /Your watchlist/);
  assert.match(html, /Connecting to ESPN/);
  assert.doesNotMatch(html, /Starter Project/);
  const invalid = await worker.fetch(new Request("http://localhost/api/scores?date=2026-02-30"), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(invalid.status, 400);
  const health = await worker.fetch(new Request("http://localhost/api/health"), {}, { waitUntil() {} });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  const metadata = await health.json();
  assert.equal(metadata.version, packageVersion);
  assert.match(metadata.commit, /^(development|[a-f0-9]{40})$/);
});
