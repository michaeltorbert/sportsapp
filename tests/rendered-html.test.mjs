import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const installName = "Saturday Signal — Sports Scores & Stats";
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const decodeHtml = (value) => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#x27;", "'");
const meta = (name, content) => new RegExp(`<meta(?=[^>]*name="${name}")(?=[^>]*content="([^"]*)")${content === undefined ? "" : `(?=[^>]*content="${escapeHtml(content)}")`}[^>]*>`);
const metaValue = (html, name) => decodeHtml(html.match(meta(name))?.[1] ?? "");

// Install metadata (#112) on Scores and Guide, rendered or packaged. Only the install name changes; the
// remaining installed-app chrome is pinned as it was. None of this shows how iOS names an existing
// Home Screen install or what native Search matches.
function assertInstallMetadata(html, route) {
  const rawTitle = html.match(/<title>([^<]*)<\/title>/)?.[1];
  assert.equal(rawTitle, `${escapeHtml(installName)} | College Football Watchlist`, route);
  assert.equal(decodeHtml(rawTitle ?? ""), `${installName} | College Football Watchlist`, route);
  for (const name of ["application-name", "apple-mobile-web-app-title"]) {
    assert.match(html, meta(name), route);
    assert.equal(metaValue(html, name), installName, `${route} ${name} has the exact semantic name`);
    assert.match(html, new RegExp(`name="${name}" content="${escapeHtml(installName)}"`), route);
  }
  assert.equal(html.match(/name="(?:application-name|apple-mobile-web-app-title)"/g)?.length, 2, `${route} has one of each name element`);
  assert.match(html, meta("apple-mobile-web-app-status-bar-style", "black-translucent"), route);
  assert.match(html, meta("mobile-web-app-capable", "yes"), route);
  assert.match(html, meta("theme-color", "#0a0e16"), route);
  const viewports = html.match(/<meta[^>]*name="viewport"[^>]*>/g) ?? [];
  assert.equal(viewports.length, 1, `${route} has one viewport element`);
  assert.match(viewports[0], /width=device-width/); assert.match(viewports[0], /viewport-fit=cover/);
  for (const link of ['rel="manifest" href="/manifest.webmanifest"', 'rel="apple-touch-icon" href="/apple-touch-icon.png"', 'rel="icon" href="/favicon.svg"']) {
    assert.ok(html.includes(`<link ${link}`), `${route}: ${link}`);
  }
  assert.match(html, /aria-label="Saturday Signal home"/, `${route} keeps the in-app wordmark`);
}

test("serves the install name with unchanged manifest identity, colors and icons", () => {
  const source = readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");
  assert.equal(readFileSync(new URL("../dist/client/manifest.webmanifest", import.meta.url), "utf8"), source, "compiled asset matches source");
  assert.deepEqual(JSON.parse(source), {
    id: "/", name: installName, short_name: installName,
    description: "ACC scores, one-score games, and Top 25 upset watch.",
    start_url: "/", scope: "/", display: "standalone", background_color: "#0a0e16", theme_color: "#0a0e16",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  });
});

test("packages Scores and Guide with the install metadata", () => {
  for (const file of ["index.html", "guide.html"]) {
    const html = readFileSync(new URL(`../dist/client/${file}`, import.meta.url), "utf8");
    assert.ok(html.startsWith(`<!-- saturday-signal-static ${packageVersion} `), `${file} is the current packaged build`);
    assertInstallMetadata(html, file);
  }
});

test("renders the mobile scoreboard shell and app metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const guide = await worker.fetch(new Request("http://localhost/guide", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(guide.status, 200);
  const guideHtml = await guide.text();
  assert.match(guideHtml, /All times Eastern/);
  assertInstallMetadata(guideHtml, "/guide");

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
  // Scope contract through 1.13.5 (#116), extended by #112: only the install name changed.
  assertInstallMetadata(html, "/");
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
