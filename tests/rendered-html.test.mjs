import assert from "node:assert/strict";
import test from "node:test";

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
});
