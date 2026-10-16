import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { bundle } from "./helpers.mjs";

// Route upstream fetches go through this delegate so each test controls ESPN.
let upstream = async () => { throw new Error("unexpected upstream request"); };
globalThis.fetch = (...args) => upstream(...args);
const route = await bundle("app/api/stats/route.ts");
const { normalizeGameStats, parseGameStats, snapshotBytes, withoutScoring, STATS_MAX_BYTES } = await bundle("lib/game-stats.ts");
const { scoringDisplay, SCORING_MAX_PLAYS } = await bundle("lib/game-scoring.ts");
const { loadGameStats } = await bundle("lib/stats-client.ts");

const read = file => readFileSync(new URL(`./fixtures/${file}`, import.meta.url));
const fixture = name => JSON.parse(read(`espn-summary-${name}.json`));
const scoringFixture = name => JSON.parse(read(`espn-summary-scoring-${name}.json`));
// COMPOSED: a scoring fixture's genuine header and scoringPlays with the existing genuine boxscore for the same event.
const composed = (name, boxscore) => { const s = scoringFixture(name); return boxscore ? { ...fixture(boxscore), header: s.header, scoringPlays: s.scoringPlays } : s; };
const CHECKED = "2026-10-10T20:40:00.000Z";
const normalize = raw => normalizeGameStats(raw, raw.header.id, CHECKED);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const brief = items => items.map(p => [p.team, p.period, p.clock, p.away, p.home]);

test("scoring fixtures are the manifest's byte-identical excerpts, with no betting, media or unrelated person metadata", () => {
  const provenance = JSON.parse(read("espn-summary-scoring-provenance.json"));
  assert.deepEqual(Object.keys(provenance.fixtures).sort(), ["espn-summary-scoring-final-ot.json", "espn-summary-scoring-final.json", "espn-summary-scoring-live.json", "espn-summary-scoring-pregame.json"]);
  for (const [file, entry] of Object.entries(provenance.fixtures)) {
    const bytes = read(file);
    assert.equal(bytes.length, entry.fixtureBytes, file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.fixtureSha256, file);
    assert.match(entry.captureSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(bytes).header.id, entry.eventId);
    assert.doesNotMatch(bytes.toString(), /pickcenter|odds|againstTheSpread|predictor|winprobability|headshot|jersey|guid|logo|href|drives|news|video/i, file);
  }
});

test("genuine live (COMPOSED): supplied quarters only, real zeros, source-order plays, team by ID, nothing inferred", () => {
  const s = normalize(composed("live", "live"));
  assert.equal(s.sourcePhase, "started");
  assert.deepEqual(s.scoring.periods, { away: [7, 10, 0], home: [0, 7, 3], totals: [17, 10] });
  assert.deepEqual(brief(s.scoring.plays.items), [[0, 1, "6:56", 7, 0], [1, 2, "14:11", 7, 7], [0, 2, "10:09", 14, 7], [0, 2, "0:12", 17, 7], [1, 3, "10:56", 17, 10]]);
  assert.deepEqual(s.scoring.plays.items[1], { team: 1, period: 2, clock: "14:11", type: "Blocked Punt Touchdown", text: "Punt blocked by D. Okoye, recovered by D. Fields for a TD (T. Sandell KICK)", away: 7, home: 7 });
  assert.equal(s.scoring.plays.omitted, undefined); assert.equal(s.scoring.plays.inconsistent, undefined);
  // The released Team and Players sections are exactly what the boxscore alone produces.
  assert.deepEqual(withoutScoring(s), normalize(fixture("live")));
  assert.ok(parseGameStats(JSON.parse(JSON.stringify(s))));
  assert.equal(scoringDisplay(s, "started").mode, "scoring");
  // Season-only Team stats or a different expected phase never relabel scoring.
  assert.deepEqual(scoringDisplay(s, "final"), { mode: "catching-up", reason: "phase" });
});

test("genuine final and Final/OT: four and five periods, supplied zeros, trimmed source text, equal OT 0:00 clocks kept in source order", () => {
  const f = normalize(composed("final", "final"));
  assert.deepEqual(f.scoring.periods, { away: [3, 0, 3, 14], home: [10, 0, 0, 7], totals: [20, 17] });
  assert.equal(f.scoring.plays.items[0].text, "Kyle Cunanan 28 Yd Field Goal");
  assert.equal(f.scoring.plays.items.length, 7);
  const ot = normalize(composed("final-ot"));
  assert.deepEqual(ot.scoring.periods, { away: [10, 7, 3, 7, 7], home: [7, 14, 0, 6, 8], totals: [34, 35] });
  assert.deepEqual(brief(ot.scoring.plays.items.slice(-2)), [[0, 5, "0:00", 34, 27], [1, 5, "0:00", 34, 35]]);
  assert.equal(ot.scoring.plays.items.at(-1).text, "CJ Baxter 1 Yd Run (Kenny Minchey Run for Two-Point Conversion)");
  assert.equal(ot.scoring.plays.inconsistent, undefined);
  // No boxscore in this source: Team and Players are unavailable, scoring is not.
  assert.deepEqual([ot.team, ot.players], [{ unavailable: "missing" }, { unavailable: "missing" }]);
  assert.equal(scoringDisplay(ot, "final").mode, "scoring");
  // Pregame sources (historical and current) carry no scoring.
  assert.equal(normalize(scoringFixture("pregame")).scoring, undefined);
  assert.equal(normalize(fixture("pregame")).scoring, undefined);
  // Legacy fixtures without any scoring fields: no scoring key at all.
  assert.equal("scoring" in normalize(fixture("final")), false);
});

test("SYNTHETIC periods: unequal arrays keep known cells and mark the whole table; missing is never zero; sum mismatches are flagged, not fixed", () => {
  const unequal = composed("live", "live");
  unequal.header.competitions[0].competitors.find(c => c.homeAway === "home").linescores.pop();
  assert.deepEqual(normalize(unequal).scoring.periods, { away: [7, 10, 0], home: [0, 7, null], totals: [17, 10], incomplete: true });
  const unreadable = composed("live", "live");
  unreadable.header.competitions[0].competitors.find(c => c.homeAway === "away").linescores[1].displayValue = "ten";
  assert.deepEqual(normalize(unreadable).scoring.periods.away, [7, null, 0]);
  const off = composed("live", "live");
  off.header.competitions[0].competitors.find(c => c.homeAway === "away").score = "20";
  const p = normalize(off).scoring;
  assert.equal(p.periods.mismatch, true); assert.deepEqual(p.periods.totals, [20, 10]);
  assert.equal(p.plays.inconsistent, true, "the last play no longer matches the header total");
  const many = composed("live", "live");
  for (const c of many.header.competitions[0].competitors) c.linescores = Array.from({ length: 21 }, () => ({ displayValue: "0" }));
  assert.deepEqual(normalize(many).scoring.periods, { unavailable: "too-many" });
  const none = composed("live", "live");
  for (const c of none.header.competitions[0].competitors) delete c.linescores;
  const s = normalize(none).scoring;
  assert.deepEqual(s.periods, { unavailable: "missing" });
  assert.equal(s.plays.items.length, 5, "plays stay available without periods");
});

test("SYNTHETIC plays: unknown teams omitted, missing fields null, conflicting duplicates dropped, contradictions unavailable, corrections flagged", () => {
  const raw = composed("live", "live");
  raw.scoringPlays.push({ ...raw.scoringPlays[0], id: "x1", team: { id: "999" } }, { ...raw.scoringPlays[0], id: "x2", team: { id: "abc" } });
  delete raw.scoringPlays[0].clock; delete raw.scoringPlays[0].period; raw.scoringPlays[1].awayScore = -1; raw.scoringPlays[2].text = "x".repeat(513);
  let s = normalize(raw).scoring.plays;
  assert.equal(s.omitted, 2);
  assert.deepEqual(brief(s.items), [[0, null, null, 7, 0], [1, 2, "14:11", null, 7], [0, 2, "10:09", 14, 7], [0, 2, "0:12", 17, 7], [1, 3, "10:56", 17, 10]]);
  assert.equal(s.items[2].text, null, "over-long text is unavailable, never shortened");
  // No team named: kept without attribution.
  const anon = composed("live", "live"); delete anon.scoringPlays[0].team;
  assert.equal(normalize(anon).scoring.plays.items[0].team, null);
  // Identical repeated IDs are one play; disagreeing copies assert nothing.
  const dup = composed("live", "live"); dup.scoringPlays.splice(1, 0, structuredClone(dup.scoringPlays[0]));
  assert.equal(normalize(dup).scoring.plays.items.length, 5);
  const conflict = composed("live", "live"); conflict.scoringPlays.splice(1, 0, { ...structuredClone(conflict.scoringPlays[0]), awayScore: 6 });
  s = normalize(conflict).scoring.plays;
  assert.equal(s.items.length, 4); assert.equal(s.omitted, 2);
  // A period or clock running backwards contradicts source order: unavailable, never re-sorted.
  const backwards = composed("live", "live"); [backwards.scoringPlays[0], backwards.scoringPlays[4]] = [backwards.scoringPlays[4], backwards.scoringPlays[0]];
  assert.deepEqual(normalize(backwards).scoring.plays, { unavailable: "order" });
  const clock = composed("live", "live"); clock.scoringPlays[2].clock.displayValue = "14:30";
  assert.deepEqual(normalize(clock).scoring.plays, { unavailable: "order" });
  assert.deepEqual(normalize(clock).scoring.periods.totals, [17, 10], "periods are independent of the play list");
  // A score correction (running score going down) is shown with a caveat, not rejected.
  const corrected = composed("live", "live"); corrected.scoringPlays[3].awayScore = 13; corrected.scoringPlays[4].awayScore = 13;
  corrected.header.competitions[0].competitors.find(c => c.homeAway === "away").score = "13";
  s = normalize(corrected).scoring.plays;
  assert.equal(s.items.length, 5); assert.equal(s.inconsistent, true);
  // Supplied [] is "none supplied yet"; with points on the board it carries a caveat; absent is unavailable.
  const empty = composed("live", "live"); empty.scoringPlays = [];
  assert.deepEqual(normalize(empty).scoring.plays, { items: [], inconsistent: true });
  const scoreless = composed("live", "live"); scoreless.scoringPlays = [];
  for (const c of scoreless.header.competitions[0].competitors) { c.score = "0"; c.linescores = [{ displayValue: "0" }]; }
  assert.deepEqual(normalize(scoreless).scoring.plays, { items: [] });
  const absent = composed("live", "live"); delete absent.scoringPlays;
  assert.deepEqual(normalize(absent).scoring.plays, { unavailable: "missing" });
  const malformed = composed("live", "live"); malformed.scoringPlays = { 0: {} };
  assert.deepEqual(normalize(malformed).scoring.plays, { unavailable: "malformed" });
  const tooMany = composed("live", "live"); tooMany.scoringPlays = Array.from({ length: SCORING_MAX_PLAYS + 1 }, () => tooMany.scoringPlays[0]);
  assert.deepEqual(normalize(tooMany).scoring.plays, { unavailable: "too-many" });
});

// Grows the Players section with supplied-looking rows until the snapshot without scoring is `gap` bytes under the bound.
function nearLimit(gap) {
  const raw = composed("final", "final"), base = () => snapshotBytes(withoutScoring(normalize(raw)));
  const rows = raw.boxscore.players.flatMap(t => t.statistics).filter(c => ["passing", "rushing", "receiving"].includes(c.name));
  const added = [];
  for (let i = 0; base() < STATS_MAX_BYTES - gap - 200; i++) {
    const c = rows[i % rows.length], athlete = { athlete: { id: String(2e6 + i), displayName: `P${i}` }, stats: c.athletes[0].stats };
    c.athletes.push(athlete); added.push(athlete);
  }
  let need = STATS_MAX_BYTES - gap - base();
  for (const a of added) { const grow = Math.min(need, 64 - a.athlete.displayName.length); a.athlete.displayName += "n".repeat(grow); need -= grow; if (!need) break; }
  assert.equal(base(), STATS_MAX_BYTES - gap);
  return raw;
}

test("budget: Team and Players are decided first; scoring uses only what remains and degrades first", () => {
  // Plenty of room: everything fits.
  const roomy = normalize(composed("final", "final"));
  assert.ok("periods" in roomy.scoring);
  // 300 bytes left: Players stay exactly as released; scoring becomes an explicit too-large marker.
  const tight = nearLimit(300), t = normalize(tight);
  assert.deepEqual(t.scoring, { unavailable: "too-large" });
  assert.ok("teams" in t.players, "previously fitting Players are never displaced");
  // Identical to the same summary with no scoring fields at all.
  const plain = structuredClone(tight); delete plain.scoringPlays;
  for (const c of plain.header.competitions[0].competitors) delete c.linescores;
  assert.deepEqual(withoutScoring(t), normalize(plain));
  assert.ok(snapshotBytes(t) <= STATS_MAX_BYTES);
  assert.equal(scoringDisplay(t, "final").mode, "unavailable");
  // 20 bytes left: not even the marker fits, so scoring is absent (read as unavailable) and nothing else changes.
  const full = normalize(nearLimit(20));
  assert.equal("scoring" in full, false);
  assert.ok("teams" in full.players);
  assert.equal(snapshotBytes(full), STATS_MAX_BYTES - 20);
  // Players already too large without scoring are dropped exactly as released; scoring may then fit.
  const huge = composed("final", "final");
  for (const team of huge.boxscore.players) for (const c of team.statistics) c.athletes = Array.from({ length: 250 }, (_, i) => ({ athlete: { id: String(1e6 + i), displayName: `Participant with a long name ${i}` }, stats: c.athletes[0].stats }));
  const h = normalize(huge);
  assert.deepEqual(h.players, { unavailable: "too-large" });
  assert.ok("periods" in h.scoring);
  assert.ok(snapshotBytes(h) <= STATS_MAX_BYTES);
});

test("contract: strict scoring schema, optional for older Workers, and the released body for clients that don't ask", () => {
  const s = JSON.parse(JSON.stringify(normalize(composed("final-ot"))));
  assert.ok(parseGameStats(s));
  assert.ok(parseGameStats(withoutScoring(s)), "a Worker from before scoring stays valid");
  for (const bad of [
    { ...s, scoring: { ...s.scoring, extra: 1 } },
    { ...s, scoring: { ...s.scoring, periods: { ...s.scoring.periods, away: [1, 2] } } },
    { ...s, scoring: { ...s.scoring, periods: { ...s.scoring.periods, totals: [-1, 3] } } },
    { ...s, scoring: { ...s.scoring, plays: { items: [{ ...s.scoring.plays.items[0], team: 2 }] } } },
    { ...s, scoring: { ...s.scoring, plays: { items: [{ ...s.scoring.plays.items[0], clock: "9:99" }] } } },
    { ...s, scoring: { ...s.scoring, plays: { items: [{ ...s.scoring.plays.items[0], text: "x".repeat(513) }] } } },
    { ...s, scoring: { ...s.scoring, plays: { items: [{ ...s.scoring.plays.items[0], id: "1" }] } } },
    { ...s, scoring: { unavailable: "missing" } },
  ]) assert.equal(parseGameStats(bad), null, JSON.stringify(bad.scoring).slice(0, 80));
});

test("route: optional scoring 0|1 is validated; one cached upstream summary serves old and new clients; old clients get the released body", async () => {
  let calls = 0;
  upstream = async () => { calls++; return json(composed("live", "live")); };
  for (const q of ["scoring=2", "scoring=", "scoring=true"]) {
    const bad = await route.GET(new Request(`http://local/api/stats?event=401856717&phase=started&${q}`));
    assert.equal(bad.status, 400, q);
  }
  assert.equal(calls, 0);
  const asked = await (await route.GET(new Request("http://local/api/stats?event=401856717&phase=started&scoring=1"))).json();
  const legacy = await (await route.GET(new Request("http://local/api/stats?event=401856717&phase=started"))).json();
  const zero = await (await route.GET(new Request("http://local/api/stats?event=401856717&phase=started&scoring=0"))).json();
  assert.equal(calls, 1, "no separate fetch or cache for scoring");
  assert.deepEqual(asked.scoring.periods.totals, [17, 10]);
  for (const body of [legacy, zero]) {
    assert.equal("scoring" in body, false);
    assert.deepEqual(Object.keys(body), ["v", "eventId", "teamIds", "sourceDate", "sourcePhase", "sourceStatus", "checkedAt", "team", "players"]);
    assert.equal(JSON.stringify(body), JSON.stringify(withoutScoring(asked)));
  }
});

test("client: asks for scoring once on the same request; accepts an older Worker without it; rejects a malformed one", async () => {
  const request = { eventId: "401856717", teamIds: ["251", "201"], phase: "started", refresh: false };
  const full = normalize(composed("live", "live")), urls = [];
  const fetcher = body => async url => { urls.push(String(url)); return json(body); };
  const ok = await loadGameStats(request, Date.now() + 8000, new AbortController().signal, fetcher(full));
  assert.deepEqual(urls, ["/api/stats?event=401856717&phase=started&refresh=0&scoring=1"]);
  assert.deepEqual(ok.stats.scoring, JSON.parse(JSON.stringify(full.scoring)));
  const old = await loadGameStats(request, Date.now() + 8000, new AbortController().signal, fetcher(withoutScoring(full)));
  assert.equal(old.kind, "ok"); assert.equal(old.stats.scoring, undefined);
  assert.equal(scoringDisplay(old.stats, "started").mode, "unavailable");
  const broken = await loadGameStats(request, Date.now() + 8000, new AbortController().signal, fetcher({ ...full, scoring: { periods: full.scoring.periods } }));
  assert.equal(broken.reason, "invalid");
  // Identity is checked on the whole snapshot before scoring is trusted.
  const swapped = await loadGameStats(request, Date.now() + 8000, new AbortController().signal, fetcher({ ...full, teamIds: ["201", "251"] }));
  assert.equal(swapped.reason, "identity");
});
