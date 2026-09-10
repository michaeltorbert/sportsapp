import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle, game, scoreboard } from "./helpers.mjs";
const g = await bundle("lib/guide.ts");
const { normalizeScoreboard } = await bundle("lib/espn-data.ts");
const { gameDay } = await bundle("lib/football.ts");
const { conditions, transitions } = await bundle("services/alerts/rules.ts");
const { parseGuide, guideUrl } = await bundle("lib/guide-state.ts");
const { refreshUrl } = await bundle("lib/app-update.ts");
const fixture = JSON.parse(readFileSync(new URL("fixtures/guide-2026-09-12.json", import.meta.url)));

test("archived full slate conserves unique selected-day games, including non-Watchlist and multi-network listings", () => {
  const board = normalizeScoreboard(fixture, "2026-09-12");
  const all = g.guideBoard(board, "all"), watch = g.guideBoard(board, "watch");
  assert.equal(fixture.events.length, 80); assert.ok(board.games.length > 25);
  assert.deepEqual(new Set(all.games.map(g => g.id)), new Set(board.games.map(g => g.id)));
  assert.ok(watch.games.length < all.games.length);
  assert.equal(all.start, watch.start); assert.equal(all.end, watch.end);
  for (const game of all.games) assert.equal(all.lanes.flatMap(l => l.games).filter(p => p.game.id === game.id).length, g.kickoff(game) === null ? 0 : g.networks(game).length);
  assert.ok(all.lanes.some(l => l.name === "ESPN+"));
  // The provider spells out these labels; keep them distinct from SECN/ACCN.
  for (const name of ["SEC Network", "ACC Network", "BTN"]) {
    assert.ok(all.lanes.some(l => l.name === name));
    assert.ok(g.networkOrder(name, "ESPN+") < 0);
  }
  const labels = g.guideBoard(scoreboard([game({ broadcasts: ["SECN", "SEC Network", "ACCN", "ACC Network"] })]), "all").lanes.map(l => l.name);
  assert.equal(labels.length, 4);
});

test("quarter-hour kickoffs and 210-minute windows use exact coordinates; collisions never hide entries", () => {
  const games = ["12:00", "12:45", "15:45", "16:15"].map((time, i) => game({ id: String(i), date: `2026-09-12T${time}:00-04:00`, broadcasts: ["SECN", "ESPN+"] }));
  const model = g.guideBoard(scoreboard(games, "2026-09-12"), "all");
  assert.deepEqual(games.map(game => g.coordinate(g.kickoff(game), model.start, 100)), [0, 75, 375, 425]);
  for (const lane of model.lanes) {
    assert.equal(lane.games.length, 4); assert.equal(lane.tracks, 2);
    for (const placement of lane.games) assert.equal(placement.end - placement.start, 210 * 60_000);
  }
  const adjacent = g.guideBoard(scoreboard([games[0], { ...games[0], id: "later", date: "2026-09-12T15:30:00-04:00" }]), "all");
  assert.equal(adjacent.lanes[0].tracks, 1);
});

test("optional malformed broadcasts retain game without warnings and preserve overnight hold and normalized kickoff body", () => {
  const raw = structuredClone(fixture.events[0]);
  raw.date = "2026-09-12T23:30:00-04:00"; raw.competitions[0].date = raw.date;
  raw.competitions[0].broadcasts = [null, { names: [" ESPN ", 3, null, "espn", "ESPN+", ""] }, "bad"];
  const board = normalizeScoreboard({ events: [raw] }, "2026-09-12");
  assert.equal(board.games.length, 1); assert.equal(board.warnings, undefined);
  assert.deepEqual(board.games[0].broadcasts, ["ESPN", "ESPN+"]);
  assert.equal(gameDay(new Date("2026-09-13T04:30:00Z"), board), "2026-09-12");
  const kickoff = { ...board.games[0], state: "upcoming", timeValid: true }; kickoff.teams[0].conferenceId = "1";
  const time = Date.parse(kickoff.date), before = { game: kickoff, observedAt: time - 11 * 60_000 };
  const event = transitions(before, kickoff, time - 5 * 60_000).find(e => e.trigger === "acc-kickoff");
  assert.ok(event); assert.ok(event.payload.body.endsWith(" · ESPN / ESPN+"));
  assert.equal(event.id, `${kickoff.id}:acc-kickoff`);
  assert.equal(conditions({ ...kickoff, timeValid: false }, time - 5 * 60_000)["acc-kickoff"], false);
});

test("TBD, missing networks, other states, and unreadable dates remain honest", () => {
  const games = [game({ id: "tbd", timeValid: false, broadcasts: [] }), game({ id: "unknown", state: "other", broadcast: "", broadcasts: [] }), game({ id: "final", state: "final" })];
  const model = g.guideBoard(scoreboard(games), "all");
  assert.equal(model.games.length, 3); assert.equal(model.tbd[0].id, "tbd");
  assert.ok(model.lanes.some(l => l.name === "Network TBD"));
  assert.deepEqual(g.networks(game({ broadcast: "ESPN / ABC" })), ["ESPN / ABC"]);
  const raw = structuredClone(fixture.events[0]); raw.competitions[0].date = "bad";
  const board = normalizeScoreboard({ events: [raw, fixture.events[1]] }, "2026-09-12");
  assert.ok(board.warnings?.length); assert.ok(!board.games.some(g => g.id === raw.id));
});

test("Eastern membership, midnight extension and real DST labels", () => {
  const raw = structuredClone(fixture.events[0]); raw.date = "2026-09-13T03:30:00Z"; raw.competitions[0].date = raw.date;
  const board = normalizeScoreboard({ events: [raw] }, "2026-09-12"), model = g.guideBoard(board, "all");
  assert.equal(board.games.length, 1); assert.equal(new Date(model.end).toISOString(), "2026-09-13T07:00:00.000Z");
  assert.equal(normalizeScoreboard({ events: [raw] }, "2026-09-13").games.length, 0);
  assert.equal(g.tickLabel(Date.parse("2026-03-08T06:00:00Z")), "1 AM EST");
  assert.equal(g.tickLabel(Date.parse("2026-03-08T07:00:00Z")), "3 AM EDT");
  assert.equal(g.tickLabel(Date.parse("2026-11-01T05:00:00Z")), "1 AM EDT");
  assert.equal(g.tickLabel(Date.parse("2026-11-01T06:00:00Z")), "1 AM EST");
  assert.match(g.fullGameLabel(game({ date: "2026-11-01T05:30:00Z" })), /2026-11-01, 1:30 AM EDT/);
  assert.match(g.fullGameLabel(game({ date: "2026-11-01T06:30:00Z" })), /2026-11-01, 1:30 AM EST/);
});

test("Watchlist uses classification, not finals preference or focused IDs, and empty filter preserves domain", () => {
  const plain = game({ state: "upcoming" }); plain.teams.forEach(t => { t.rank = null; t.conferenceId = "2"; });
  const final = game({ id: "final", state: "final", retainedCategories: { acc: false, top25: false, close: false, upset: true } });
  const all = g.guideBoard(scoreboard([plain]), "all"), watch = g.guideBoard(scoreboard([plain]), "watch");
  assert.equal(watch.games.length, 0); assert.equal(watch.start, all.start);
  assert.equal(g.guideBoard(scoreboard([plain, final]), "watch").games[0].id, "final");
});

test("Guide URL and update restoration keep explicit date/view and remove inherited Scores keys", () => {
  assert.deepEqual(parseGuide("?date=bad&view=bad"), { date: null, view: "all" });
  const selection = parseGuide("?date=2026-09-12&view=watch");
  assert.equal(guideUrl("https://test/guide?tab=acc&_ss_focus=abc", selection), "/guide?date=2026-09-12&view=watch");
  const url = new URL(refreshUrl("https://test/guide?tab=acc&_ss_hide_finals=1", "a".repeat(40), { page: "guide", date: selection.date, view: selection.view, followToday: false }));
  assert.equal(url.pathname, "/guide"); assert.equal(url.searchParams.get("view"), "watch"); assert.equal(url.searchParams.get("date"), "2026-09-12");
  assert.equal(url.searchParams.has("tab"), false); assert.equal(url.searchParams.has("_ss_hide_finals"), false);
  const today = new URL(refreshUrl(url.href, "a".repeat(40), { page: "guide", date: "2026-09-12", view: "all", followToday: true }));
  assert.equal(today.searchParams.has("date"), false); assert.equal(today.searchParams.has("view"), false);
});

test("fixed palette has at least eight swatches, white-text contrast, and stable game identity", () => {
  assert.ok(new Set(g.PALETTE).size >= 8);
  for (const color of g.PALETTE) {
    const channels = color.slice(1).match(/../g).map(h => parseInt(h, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    assert.ok(1.05 / (luminance + .05) >= 4.5, color);
  }
  assert.equal(g.gameColor("example"), g.gameColor("example"));
});


test("Time TBD uses network, team names and ID ordering in both its section and text-schedule tail", () => {
  const make = (id, name, network) => {
    const result = game({ id, timeValid: false, broadcasts: [network] });
    result.teams[0].name = name; result.teams[1].name = "Common"; return result;
  };
  const games = [make("01", "Alpha", "FOX"), make("02", "Zed", "ABC"), make("99", "Aaa", "ABC"), make("98", "Aaa", "ABC"), game({ id: "timed" })];
  const model = g.guideBoard(scoreboard(games), "all");
  assert.deepEqual(model.tbd.map(g => g.id), ["98", "99", "02", "01"]);
  assert.deepEqual(model.games.map(g => g.id), ["timed", "98", "99", "02", "01"]);
});
