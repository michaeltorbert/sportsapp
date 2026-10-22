import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, Response as SyntheticResponse } from "miniflare";

// Unlike an injected Node fetch mock, this runs the real helper through workerd's native
// RequestInit boundary. EVERY outbound request terminates in the synthetic handler below;
// no handler uses Node fetch, DNS or live provider access. Metadata fetch/telemetry are off.
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/espn-season-leaders-texas-2026.json", import.meta.url), "utf8"));
const base = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/";
const leaderUrl = `${base}types/2/teams/251/leaders?lang=en&region=us`;
const routes = new Map([[leaderUrl, fixture.leaders], ...Object.entries(fixture.athletes).map(([id, athlete]) => [`${base}athletes/${id}?lang=en&region=us`, athlete])]);

test("native Worker fetch accepts leaders and refuses redirects/denials without following or retrying", { timeout: 20_000 }, async () => {
  const output = await build({
    stdin: { contents: `import {loadSeasonLeaders} from './lib/team-season-leaders-server.ts';
      export default {async fetch(){return Response.json(await loadSeasonLeaders(fetch,'251',2026,new AbortController().signal,1000));}};`, resolveDir: root, loader: "ts" },
    bundle: true, platform: "browser", format: "esm", write: false,
  });
  let scenario = "good", calls = [], unexpected = [];
  const outboundService = request => {
    calls.push(request.url);
    if (!routes.has(request.url)) { unexpected.push(request.url); return new SyntheticResponse("unexpected outbound blocked", { status: 599 }); }
    // SYNTHETIC access/redirect responses test semantics; they are not observed provider states.
    if (scenario === "redirect") return new SyntheticResponse("", { status: 302, headers: { Location: "https://reserved.invalid/never-follow" } });
    if (scenario === "denied") return new SyntheticResponse("synthetic forbidden", { status: 403 });
    return new SyntheticResponse(JSON.stringify(routes.get(request.url)), { headers: { "content-type": "application/json" } });
  };
  // Installed v5 public converter translates supported script/modules/outboundService v4 options.
  // Compatibility date/flag match the application; no config or dependency is modified by this test.
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: "season-leaders-offline", script: output.outputFiles[0].text, modules: true,
    compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    cf: false, telemetry: { enabled: false }, outboundService,
  }));
  try {
    const success = await (await mf.dispatchFetch("https://worker.invalid/")).json();
    assert.deepEqual([success.passingYards.name, success.passingYards.yards, success.rushingYards.name, success.rushingYards.yards, success.receivingYards.name, success.receivingYards.yards], ["Arch Manning", 1295, "Hollywood Smothers", 289, "Ryan Wingo", 345]);
    assert.deepEqual(new Set(calls), new Set(routes.keys()));
    assert.equal(calls.length, 4, "one leaders + three distinct athlete requests");
    for (const mode of ["redirect", "denied"]) {
      scenario = mode; calls = [];
      assert.equal(await (await mf.dispatchFetch("https://worker.invalid/")).json(), null);
      assert.deepEqual(calls, [leaderUrl], `${mode}: exactly one attempt, no follow/retry/athlete requests`);
    }
    assert.deepEqual(unexpected, [], "all egress is fixture-only and the redirect target was never requested");
  } finally { await mf.dispose(); }
});
