import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle, game, scoreboard } from "./helpers.mjs";
const h = await bundle("lib/halftime.ts");
const { enrichPregameLines } = await bundle("lib/pregame-lines.ts");
const now = Date.parse("2026-09-06T04:01:00Z");
function half(id = "half") { return game({ id, halftime: true, period: 2, clock: 0, status: "Halftime" }); }
function summary(g, anchor = now - 425000) { return { header: { id: g.id, competitions: [{ competitors: g.teams.map((t, i) => ({ homeAway: i ? "home" : "away", team: { id: t.id } })), status: { period: 2, type: { name: "STATUS_HALFTIME", state: "in" } } }] }, drives: { current: { plays: [{ id: "end", type: { id: "2" }, period: { number: 2 }, clock: { displayValue: "0:00" }, wallclock: new Date(anchor).toISOString(), modified: new Date(now + 9999999).toISOString() }] } } }; }
const parse = (raw, g, at = now) => h.parseHalftime(raw, g, at, h.nextHalftimeGeneration(), h.halftimeEpoch());
function label(g, at = now, extras = {}) { return h.halftimeLabel(g, scoreboard([g], undefined, extras), false, at, true, true); }

test("real retained container fixture supports Awaiting after 22m19s", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/halftime-401868008.json", import.meta.url)));
  const competition = fixture.summary.header.competitions[0];
  assert.equal(competition.date, "2026-09-12T23:30Z");
  assert.equal(competition.date, fixture.scoreboard_event.date);
  assert.equal(competition.date, fixture.scoreboard_event.competitions[0].date);
  assert.equal(competition.date, fixture.date, "real supplied date activates the positive identity gate");
  const competitors = competition.competitors;
  const g = half("401868008"); g.date = fixture.date;
  g.teams.forEach((t, i) => { t.id = competitors.find(c => c.homeAway === (i ? "home" : "away")).team.id; });
  const at = Date.parse(fixture.provenance.capturedAt), observed = parse(fixture.summary, g, at);
  assert.equal(observed.status, "halftime"); assert.ok(at - observed.anchor > 22 * 60000);
  h.observeHalftime(g, observed);
  assert.equal(h.halftimeLabel(g, { fetchedAt: new Date(at).toISOString() }, false, at, true, true), "Halftime · Awaiting 3rd quarter");
});
test("structured current/previous marker deduplication and exact copy", () => {
  const g = half("parser"), raw = summary(g);
  raw.drives.previous = [structuredClone(raw.drives.current)];
  assert.equal(parse(raw, g).anchor, now - 425000);
  h.observeHalftime(g, parse(raw, g)); assert.equal(label(g), "Halftime 12:55"); assert.equal(label(g, now + 1000), "Halftime 12:54");
  raw.drives.previous[0].plays[0].wallclock = new Date(now - 426000).toISOString();
  assert.equal(parse(raw, g).reason, "conflict");
  raw.drives.previous[0].plays[0].id = "different"; assert.equal(parse(raw, g).reason, "conflict");
});
test("identity, malformed timing, Q1 and untimed Q2 never invent anchors", () => {
  const g = half("invalid");
  for (const change of [r => r.header.id = "wrong", r => r.header.competitions[0].competitors.reverse().forEach((c, i) => c.homeAway = i ? "home" : "away"), r => r.drives.current.plays[0].wallclock = "2026-09-06T03:53:55", r => r.drives.current.plays[0].wallclock = "invalidZ", r => r.drives.current.plays[0].wallclock = new Date(now + 1).toISOString(), r => r.drives.current.plays[0].wallclock = "2026-09-06T01:00:00Z"]) {
    const raw = summary(g); change(raw); assert.equal(parse(raw, g).status, "invalid");
  }
  for (const change of [r => r.drives.current.plays[0].period.number = 1, r => r.drives.current.plays[0].type.id = "24", r => r.drives.current.plays[0].clock.displayValue = "0:01"]) {
    const raw = summary(g); change(raw); assert.equal(parse(raw, g).anchor, undefined);
  }
  const resumed = summary(g); resumed.drives.previous = [{ plays: [{ period: { number: 3 } }] }]; assert.equal(parse(resumed, g).status, "resumed");
});
test("freshness gates apply each tick to both number and Awaiting; failures retain but do not renew", () => {
  const g = half("fresh"), observation = parse(summary(g), g); h.observeHalftime(g, observation);
  h.observeHalftime(g, parse({}, g, now + 80000));
  assert.equal(label(g, now + 90000), "Halftime 11:25"); assert.equal(label(g, now + 90001), "Halftime");
  h.observeHalftime(g, parse(summary(g), g, now + 90001));
  assert.equal(label(g, now + 90001, { fetchedAt: new Date(now + 90001).toISOString() }), "Halftime 11:25");
  for (const [error, online, visible] of [[true, true, true], [false, false, true], [false, true, false]]) assert.equal(h.halftimeLabel(g, scoreboard([g]), error, now, online, visible), "Halftime");
  h.observeHalftime(g, parse(summary(g, now - 1200000), g)); // Changed anchor conflict.
  assert.equal(label(g), "Halftime"); h.observeHalftime(g, parse(summary(g, now - 1200000), g));
  assert.equal(label(g), "Halftime · Awaiting 3rd quarter"); assert.equal(label(g, now + 90001), "Halftime");
});
test("reverse completions, global resumption, visibility generation and identities fail closed", () => {
  const g = half("race"), old = parse(summary(g), g), resumed = summary(g); resumed.header.competitions[0].status.period = 3;
  h.observeHalftime(g, parse(resumed, g)); h.observeHalftime(g, old); assert.equal(label(g), "Halftime");
  const current = half("epoch"); h.observeHalftime(current, parse(summary(current), current)); assert.equal(label(current), "Halftime 12:55");
  h.invalidateHalftime(); assert.equal(label(current), "Halftime");
  h.observeHalftime(current, parse(summary(current), current)); assert.equal(label(current), "Halftime 12:55");
  assert.equal(label({ ...current, date: "2026-09-06T03:00:00Z" }), "Halftime");
  assert.equal(label({ ...current, teams: [...current.teams].reverse() }), "Halftime");
  const stripped = h.stripHalftimeTiming(scoreboard([{ ...current, halftimeAnchor: now, halftimeVerifiedAt: now }]));
  assert.equal(stripped.games[0].halftimeAnchor, undefined); assert.equal(stripped.games[0].halftime, true);
});
test("slow device clock can recover once the fixed anchor is in its past", () => {
  const g = half("skew"), raw = summary(g, now + 60000);
  assert.equal(parse(raw, g).reason, "anchor-bounds"); assert.equal(parse(raw, g, now + 60001).status, "halftime");
});
test("registry bound removes obsolete evidence without trusting board timing", () => {
  const first = half("bounded0");
  for (let i = 0; i < 251; i++) { const g = half(`bounded${i}`); h.observeHalftime(g, parse(summary(g), g)); }
  assert.equal(label(first), "Halftime");
  assert.equal(label({ ...half("tampered"), halftimeAnchor: now - 425000, halftimeVerifiedAt: now }), "Halftime");
});
test("combined waves keep 4/12 per call, 12/36 normal and 8/24 manual Guide; rotate >12 games", async () => {
  for (const scopes of [1, 2, 3]) {
    const games = Array.from({ length: 30 }, (_, i) => half(`capacity-${scopes}-${i}`));
    let starts = 0, active = 0, peak = 0;
    const fetcher = async url => { starts++; peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 2)); active--; return Response.json(summary(games.find(g => url.endsWith(g.id)))); };
    await Promise.all(Array.from({ length: scopes }, () => enrichPregameLines(scoreboard(games), new AbortController().signal, fetcher)));
    assert.ok(starts <= scopes * 12, "completed cross-scope reuse may reduce starts");
    if (scopes === 1) assert.equal(starts, 12, "single saturated call uses its twelve slots");
    assert.ok(peak <= scopes * 4);
  }
  const games = Array.from({ length: 25 }, (_, i) => half(`rotate-${i}`)); games.forEach(g => g.pregameLine = { favoriteId: "a", spread: 1, source: "test" });
  const seen = new Set(), fetcher = async url => { const g = games.find(g => url.endsWith(g.id)); seen.add(g.id); return Response.json(summary(g)); };
  for (let i = 0; i < 3; i++) await enrichPregameLines(scoreboard(games), new AbortController().signal, fetcher);
  assert.equal(seen.size, 25);
});
test("same-call duplicate needs coalesce and in-flight requests retain separate cancellation", async () => {
  const g = half("coalesced"); let starts = 0;
  const fetcher = async () => { starts++; return Response.json(summary(g)); };
  await enrichPregameLines(scoreboard([g, g]), new AbortController().signal, fetcher); assert.equal(starts, 1);
  const pending = [], separate = (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const controller = new AbortController();
  const first = enrichPregameLines(scoreboard([g]), controller.signal, separate), second = enrichPregameLines(scoreboard([g]), new AbortController().signal, separate);
  assert.equal(pending.length, 2); controller.abort(); assert.equal(pending[1].signal.aborted, false);
  pending.forEach(p => p.resolve(Response.json(summary(g)))); await Promise.all([first, second]);
});

test("original odds completion parity under deterministic slow and failed responses", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now });
  const baseline = await bundle("tests/baselines/pregame-lines-1.7.1.ts");
  const games = Array.from({ length: 8 }, (_, i) => half(`baseline-${i}`));
  const extra = Array.from({ length: 8 }, (_, i) => ({ ...half(`extra-${i}`), pregameLine: { favoriteId: "a", spread: 1, source: "test" } }));
  async function run(enrich) {
    const completion = [], start = Date.now();
    const fetcher = async (url, options) => {
      const id = new URL(url).searchParams.get("event"), g = [...games, ...extra].find(g => g.id === id);
      const i = games.indexOf(g), delay = i === 0 ? 1400 : i === 1 ? 600 : 200;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Abort", "AbortError")); }, { once: true });
      });
      if (i === 1) throw new Error("simulated failure");
      completion.push({ id, elapsed: Date.now() - start }); return Response.json(summary(g));
    };
    const pending = enrich(scoreboard([...games, ...extra]), new AbortController().signal, fetcher);
    for (let elapsed = 0; elapsed < 1600; elapsed += 100) { t.mock.timers.tick(100); await new Promise(setImmediate); }
    await pending; return completion.filter(r => r.id.startsWith("baseline-"));
  }
  assert.deepEqual(await run(enrichPregameLines), await run(baseline.enrichPregameLines));
});

test("completed reuse never restamps status; saturation permits expiry then recovers", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const m = await bundle("tests/halftime-integration-entry.ts"), g = half("integration");
  g.pregameLine = { favoriteId: "a", spread: 1, source: "test" };
  let fail = false, calls = 0;
  const fetcher = async () => { calls++; if (fail) throw Error("offline"); return Response.json(summary(g)); };
  const load = () => m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  const label = () => m.halftimeLabel(g, { fetchedAt: new Date(Date.now()).toISOString() }, false, Date.now(), true, true);
  await load(); t.mock.timers.tick(29000); await load(); assert.equal(calls, 1);
  fail = true; t.mock.timers.tick(61001); await load(); assert.equal(label(), "Halftime");
  fail = false; await load(); assert.equal(label(), "Halftime 11:25");
  m.invalidateHalftime(); assert.equal(label(), "Halftime"); await load(); assert.equal(calls, 4, "resume bypasses a pre-boundary completed result");
  assert.equal(label(), "Halftime 11:25");
});

test("saturated odds allocation preserves coverage while halftime-only games recover on later polls", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const m = await bundle("tests/halftime-integration-entry.ts"), odds = Array.from({ length: 12 }, (_, i) => half(`mixed-odds-${i}`));
  const timers = Array.from({ length: 13 }, (_, i) => ({ ...half(`mixed-timer-${i}`), pregameLine: { favoriteId: "a", spread: 1, source: "test" } }));
  const games = [...odds, ...timers], fetcher = async url => Response.json(summary(games.find(g => url.endsWith(g.id))));
  const available = [];
  for (let poll = 0; poll < 3; poll++) {
    await m.enrichPregameLines(scoreboard(games), new AbortController().signal, fetcher);
    available.push(timers.filter(g => m.halftimeLabel(g, { fetchedAt: new Date(Date.now()).toISOString() }, false, Date.now(), true, true) !== "Halftime").length);
    t.mock.timers.tick(30000);
  }
  assert.deepEqual(available, [0, 12, 13]);
});

test("eviction cannot re-admit an older response after global Q3 suppression", () => {
  const g = half("evicted-q3"), pending = parse(summary(g), g);
  const resumed = summary(g); resumed.header.competitions[0].status.period = 3;
  h.observeHalftime(g, parse(resumed, g));
  for (let i = 0; i < 251; i++) { const other = half(`evict-q3-${i}`); h.observeHalftime(other, parse(summary(other), other)); }
  h.observeHalftime(g, pending); assert.equal(label(g), "Halftime");
});
test("summary kickoff identity rejects a rescheduled matchup", () => {
  const g = half("date-identity"), raw = summary(g); raw.header.competitions[0].date = "2026-09-06T03:00:00Z";
  assert.equal(parse(raw, g).reason, "date-identity");
});

test("same play ID with conflicting structured fields is rejected", () => {
  const g = half("structured-conflict"), raw = summary(g);
  raw.drives.previous = [structuredClone(raw.drives.current)]; raw.drives.previous[0].plays[0].clock.displayValue = "0:01";
  assert.equal(parse(raw, g).reason, "conflict");
});

test("CODEX-01 later observed Q3 dominates a newer-started halftime request", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const m = await bundle("tests/halftime-integration-entry.ts"), g = half("positive-resumption");
  const pending = [], fetcher = () => new Promise(resolve => pending.push(resolve));
  const first = m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  const second = m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  pending[1](Response.json(summary(g))); await second;
  const display = () => m.halftimeLabel(g, scoreboard([g]), false, Date.now(), true, true);
  assert.equal(display(), "Halftime 12:55");
  t.mock.timers.tick(1); const resumed = summary(g); resumed.header.competitions[0].status.period = 3;
  pending[0](Response.json(resumed)); await first;
  assert.equal(display(), "Halftime", "existing halftime snapshot immediately sees positive Q3 evidence");

  const other = half("positive-scoreboard"), generation = m.nextHalftimeGeneration();
  m.observeHalftime(other, m.parseHalftime(summary(other), other, now, m.nextHalftimeGeneration(), m.halftimeEpoch()));
  m.observeHalftimeBoard(scoreboard([{ ...other, halftime: false, period: 3 }]), generation);
  assert.equal(m.halftimeLabel(other, scoreboard([other]), false, Date.now(), true, true), "Halftime");
});

test("CODEX-02 markerless status cannot rehabilitate disputed numeric or expired anchors", () => {
  for (const elapsed of [425000, 1200000]) for (const reason of ["conflict", "malformed-marker", "anchor-bounds"]) {
    const g = half(`disputed-${elapsed}-${reason}`), raw = summary(g, now - elapsed);
    h.observeHalftime(g, parse(raw, g));
    const expected = elapsed === 425000 ? "Halftime 12:55" : "Halftime · Awaiting 3rd quarter";
    assert.equal(label(g), expected);
    const bad = structuredClone(raw);
    if (reason === "conflict") {
      bad.drives.previous = [structuredClone(bad.drives.current)];
      bad.drives.previous[0].plays[0].wallclock = new Date(now - elapsed - 1000).toISOString();
    } else bad.drives.current.plays[0].wallclock = reason === "malformed-marker" ? "no timestamp" : new Date(now + 1000).toISOString();
    assert.equal(parse(bad, g).reason, reason); h.observeHalftime(g, parse(bad, g)); assert.equal(label(g), "Halftime");
    const markerless = structuredClone(raw); delete markerless.drives;
    h.observeHalftime(g, parse(markerless, g)); assert.equal(label(g), "Halftime", reason);
    h.observeHalftime(g, parse(raw, g)); assert.equal(label(g), expected, "explicit consistent marker clears dispute");
  }
});


test("CL-2 conflicting fresh scope statuses hide conservatively and recover when feeds agree", t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const g = half("scope-status-disagreement"), earlier = parse(summary(g), g);
  const laterGeneration = h.nextHalftimeGeneration();
  h.observeHalftimeBoard(scoreboard([{ ...g, halftime: false, status: "0:10 - 2nd", clock: 10 }]), laterGeneration);
  h.observeHalftime(g, earlier);
  assert.equal(label(g), "Halftime", "accept temporary loss rather than override newer non-halftime evidence");
  h.observeHalftime(g, parse(summary(g), g));
  assert.equal(label(g), "Halftime 12:55", "a later agreeing summary restores the estimate");
});

function lineSummary(g) {
  return { ...summary(g), pickcenter: [{ spread: -7, provider: { name: "halftime-source" },
    awayTeamOdds: { favorite: false, team: { id: "a" } }, homeTeamOdds: { favorite: true, team: { id: "b" } } }] };
}
const extraGame = id => ({ ...half(id), pregameLine: { favoriteId: "a", spread: 1, source: "board" } });

test("CL-A1 extra claims coalesce overlapping scopes without sharing cancellation or promises", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const m = await bundle("tests/halftime-integration-entry.ts"), g = extraGame("claim-cancel"), pending = [];
  const fetcher = (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const owner = new AbortController();
  const first = m.enrichPregameLines(scoreboard([g]), owner.signal, fetcher);
  const loser = new AbortController();
  await m.enrichPregameLines(scoreboard([g]), loser.signal, fetcher);
  assert.equal(pending.length, 1, "second scope completes without awaiting the owner");
  loser.abort(); assert.equal(pending[0].signal.aborted, false, "loser cancellation is isolated");
  owner.abort();
  const next = m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  await new Promise(setImmediate);
  assert.equal(pending.length, 2, "owner abort immediately frees claim even if its fetch is hanging");
  pending[0].resolve(Response.json(lineSummary(g))); await first;
  await m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  assert.equal(pending.length, 2, "old owner's finally cannot release the replacement owner's token");
  pending[1].resolve(Response.json(lineSummary(g))); await next;
  assert.equal(m.halftimeLabel(g, scoreboard([g]), false, now, true, true), "Halftime 12:55");
});

test("CL-A1 timeout releases claims and new epochs do not wait for old work", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const m = await bundle("tests/halftime-integration-entry.ts"), g = extraGame("claim-epoch"), pending = [];
  const fetcher = (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const first = m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  await new Promise(setImmediate);
  t.mock.timers.tick(1500);
  assert.equal(pending[0].signal.aborted, true);
  const second = m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  await new Promise(setImmediate);
  assert.equal(pending.length, 2, "deadline frees claim without relying on fetch settlement");
  m.invalidateHalftime();
  const third = m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  await new Promise(setImmediate);
  assert.equal(pending.length, 3, "new visibility epoch has an independent claim");
  pending[1].resolve(Response.json(lineSummary(g))); await second;
  assert.equal(m.halftimeLabel(g, scoreboard([g]), false, Date.now(), true, true), "Halftime", "old epoch cannot authorize new display");
  pending[0].resolve(Response.json(lineSummary(g))); await first;
  await m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  assert.equal(pending.length, 3, "old epoch completion cannot release current claim");
  pending[2].resolve(Response.json(lineSummary(g))); await third;
  assert.equal(m.halftimeLabel(g, scoreboard([g]), false, Date.now(), true, true), "Halftime 12:54");
});

test("CL-A2 preferred extra lines survive noneligible halftime cache pressure", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const m = await bundle("tests/halftime-integration-entry.ts"), preferred = extraGame("cache-preferred"), byId = new Map([[preferred.id, preferred]]);
  const requests = [], fetcher = async url => { const id = new URL(url).searchParams.get("event"); requests.push(id); return Response.json(lineSummary(byId.get(id))); };
  await m.enrichPregameLines(scoreboard([preferred]), new AbortController().signal, fetcher);
  const unrelated = Array.from({ length: 251 }, (_, i) => {
    const g = half(`cache-unranked-${i}`); g.teams.forEach(team => { team.rank = null; team.rankKnown = true; team.conferenceId = "151"; }); byId.set(g.id, g); return g;
  });
  for (let index = 0; index < unrelated.length; index += 12) {
    const board = await m.enrichPregameLines(scoreboard(unrelated.slice(index, index + 12)), new AbortController().signal, fetcher);
    assert.ok(board.games.every(g => !g.pregameLine), "unranked nonpreferred extras cannot attach odds lines");
  }
  t.mock.timers.tick(30001);
  const missingLine = { ...preferred, halftime: false, period: 3 }; delete missingLine.pregameLine;
  const refreshed = await m.enrichPregameLines(scoreboard([missingLine]), new AbortController().signal, fetcher);
  assert.equal(refreshed.games[0].pregameLine.source, "halftime-source");
  assert.equal(requests.filter(id => id === preferred.id).length, 1, "ineligible extras do not evict the preferred game's six-hour odds entry");
});

test("CL-A4 board sweeps emit once while preserving generation and sticky resumption", t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const g = half("batch-resumption"); h.observeHalftime(g, parse(summary(g), g));
  let notifications = 0; const stop = h.subscribeHalftime(() => notifications++);
  const pending = parse(summary(half("batch-other")), half("batch-other"));
  const games = [ ...Array.from({ length: 100 }, (_, i) => game({ id: `batch-${i}`, halftime: false, period: 2 })), { ...g, halftime: false, period: 3 }, { ...half("batch-other"), halftime: false } ];
  h.observeHalftimeBoard(scoreboard(games), h.nextHalftimeGeneration());
  assert.equal(notifications, 1); assert.equal(label(g), "Halftime");
  h.observeHalftime(half("batch-other"), pending);
  assert.equal(label(half("batch-other")), "Halftime", "batched records still fence older observations");
  h.observeHalftime(g, parse(summary(g), g)); assert.equal(label(g), "Halftime", "resumption stays terminal");
  h.observeHalftimeBoard(scoreboard(games), h.nextHalftimeGeneration()); assert.equal(notifications, 2, "even repeated finals are one notification per sweep");
  stop();
});

test("CL-A2 eligibility changes promote completed line evidence without restamping expiry", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const m = await bundle("tests/halftime-integration-entry.ts"), g = half("eligibility-change");
  g.teams.forEach(team => { team.rank = null; team.rankKnown = true; team.conferenceId = "151"; });
  let requests = 0; const fetcher = async () => { requests++; return Response.json(lineSummary(g)); };
  const initial = await m.enrichPregameLines(scoreboard([g]), new AbortController().signal, fetcher);
  assert.equal(initial.games[0].pregameLine, undefined);
  t.mock.timers.tick(29000);
  const ranked = { ...g, halftime: false, teams: g.teams.map((team, i) => ({ ...team, rank: i === 0 ? 5 : null })) };
  const second = await m.enrichPregameLines(scoreboard([ranked]), new AbortController().signal, fetcher);
  assert.equal(second.games[0].pregameLine.source, "halftime-source"); assert.equal(requests, 1);
  t.mock.timers.tick(6 * 3600000 - 29000 + 1);
  await m.enrichPregameLines(scoreboard([ranked]), new AbortController().signal, fetcher);
  assert.equal(requests, 2, "six-hour expiry anchors to original observation, not eligibility promotion");
});
