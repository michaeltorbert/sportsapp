import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { game } from "./helpers.mjs";

// The view bundle imports this test's own React, so one instance renders it.
const shared = { name: "shared-react", setup(b) { b.onResolve({ filter: /^(?:react(?:\/jsx-runtime)?|lucide-react)$/ }, args => ({ path: import.meta.resolve(args.path), external: true })); } };
const output = await build({
  stdin: { contents: "export { TeamScreen } from './components/team-screen.tsx'; export { GameScreen } from './components/game-screen.tsx'; export { scheduleSection, seasonStats } from './lib/team-season-server.ts'; export { defaultDukePreferences } from './lib/duke-visibility.ts';", resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "ts" },
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)), bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false, plugins: [shared],
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-team-season-${name}.json`, import.meta.url), "utf8"));
const DUKE = fixture("duke-2026"), UNC = fixture("unc-2026");
const CHECKED = "2026-10-19T05:04:44.000Z"; // 1:04 AM ET.
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const SHARED = "401858266";

function season(team = "150", changes = {}) {
  const duke = team === "150", raw = duke ? DUKE : UNC;
  return {
    v: 1, team: duke ? { id: "150", name: "Duke Blue Devils", shortName: "Duke", abbreviation: "DUKE", logo: null } : { id: "153", name: "North Carolina Tar Heels", shortName: "North Carolina", abbreviation: "UNC", logo: null },
    season: { year: 2026 }, record: duke ? "4-2" : null, stats: ui.seasonStats(raw.stats, team, 2026),
    regular: ui.scheduleSection(duke ? raw.regular : raw.schedule, team, 2026, 2, CHECKED), postseason: { status: "complete", entries: [] }, checkedAt: CHECKED, ...changes,
  };
}
const prefs = (changes = {}) => ({ ...ui.defaultDukePreferences(), ...changes });
function render(value, { team = value?.team.id ?? "150", p = prefs(), pending = false, failed = false, online = true, back } = {}) {
  return renderToStaticMarkup(createElement(ui.TeamScreen, {
    teamId: team, season: value, pending, failed, online, prefs: p,
    back: back ?? { title: "Scores", detail: "Today", label: "Back to scores, Today" }, onBack() {}, onRetry() {},
    gameHref: id => `/?event=${id}&team=${team}`, onOpenGame() {},
  }));
}
const links = html => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map(m => m[1].replaceAll("&amp;", "&"));

test("a complete Duke page: season, source record, four labeled pairs and all 12 games as in-app links", () => {
  const html = render(season(), { back: { title: "Game", detail: "TULN at DUKE", label: "Back to game, Tulane at Duke" } });
  assert.match(html, /<h1 class="team-title" tabindex="-1">Duke Blue Devils<\/h1>/);
  assert.match(text(html), /2026 season · Record 4–2/);
  assert.match(html, /<span class="sr-only">Record: 4 wins, 2 losses<\/span>/);
  assert.match(html, /aria-label="Back to game, Tulane at Duke"/);
  assert.match(html, /<caption>Regular season · per game<\/caption>/);
  assert.match(html, /<th scope="col" class="c-team">Duke<span class="sr-only"> \(Duke Blue Devils\)<\/span><\/th><th scope="col" class="c-opp">Opponents<\/th>/);
  const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th><td class="c-team">([^<]+)<\/td><td class="c-opp">([^<]+)<\/td><\/tr>/g)].map(m => m.slice(1));
  assert.deepEqual(rows, [["Points", "31.7", "16.0"], ["Total yards", "442.7", "292.7"], ["Passing yards", "233.2", "200.2"], ["Rushing yards", "209.5", "92.5"]]);
  // The narrow presentation carries the same values, each labeled with its side (CSS displays one of the two).
  const items = [...html.matchAll(/<div class="avg-stat"><dt>([^<]+)<\/dt><dd class="c-team"><span class="avg-side">Duke<\/span> <b>([^<]+)<\/b><\/dd><dd class="c-opp"><span class="avg-side">Opponents<\/span> <b>([^<]+)<\/b><\/dd><\/div>/g)].map(m => m.slice(1));
  assert.deepEqual(items, rows);
  assert.match(html, /<p class="team-averages-basis">Regular season · per game<\/p>/);
  assert.match(text(html), /Opponents shows what Duke allowed per game\./);
  // Every schedule game, and nothing else, is a same-root link carrying the team as context.
  const hrefs = links(html);
  assert.equal(hrefs.length, 12);
  for (const href of hrefs) assert.match(href, /^\/\?event=\d+&team=150$/);
  assert.doesNotMatch(html, /espn\.com|target="_blank"|Gamecast/);
  assert.match(text(html), /Regular season 12 games/);
  assert.match(text(html), /Postseason No postseason games are listed yet\./);
  assert.match(text(html), /Checked Oct 19, 1:04 AM ET Dates and kickoffs in Eastern Time/);
  assert.doesNotMatch(text(html), /\b(?:EDT|EST)\b/, "no single daylight or standard abbreviation for a season that spans both");
  // Genuine kickoffs on both sides of the November time change, each converted on its own date.
  const row = id => text(html.match(new RegExp(`<a class="sched-row" href="/\\?event=${id}[^"]*".*?</a>`))[0]);
  assert.match(row("401858271"), /Fri, Oct 23 , 7:00 PM/, "2026-10-23T23:00Z is 7:00 PM EDT");
  assert.match(row("401858303"), /Fri, Nov 20 , 7:30 PM/, "2026-11-21T00:30Z is 7:30 PM EST, on the Eastern day before the UTC date");
  // The first game: date, full opponent name, home, result for Duke, accessible result words.
  const first = html.match(/<li class="sched-item"><a class="sched-row" href="\/\?event=401858209[^"]*".*?<\/a><\/li>/)[0];
  assert.match(text(first), /Sat, Sep 5/);
  assert.match(first, /<span class="s-ha" aria-hidden="true">vs<\/span><span class="sr-only">, home versus <\/span>/);
  assert.match(first, /<span class="s-name">Tulane Green Wave<\/span>/);
  assert.match(first, /<span class="s-res w" aria-hidden="true"><b>W<\/b> 17–\d+<\/span>/);
  assert.match(first, /<span class="sr-only">, Won 17 to \d+<\/span>/);
  // Unconfirmed kickoffs say so; the next game is marked once.
  assert.match(text(html), /Time TBD/);
  assert.equal((html.match(/class="s-next"/g) || []).length, 1);
});

test("a hidden Duke game shows only its date: no opponent, score, result, link or record and averages", () => {
  const value = season(), finalGame = value.regular.entries[0];
  const html = render(value, { p: prefs({ manual: { [finalGame.game.id]: true } }) });
  assert.doesNotMatch(html, new RegExp(`${finalGame.game.id}|Tulane|TULN|Won 17`));
  assert.match(html, /<div class="sched-row is-hidden"><span class="s-when"><span class="s-date">Sat, Sep 5<\/span><\/span><span class="s-opp">Duke game hidden by your settings<\/span>/);
  assert.equal(links(html).length, 11);
  assert.match(text(html), /Record hidden/);
  assert.doesNotMatch(html, /Record <b>4–2|4 wins|<table/);
  assert.match(text(html), /Record and season statistics hidden They include a Duke game your settings are hiding\./);
  // A hidden game that hasn't started hides its row only.
  const upcoming = value.regular.entries.find(e => e.game.state === "upcoming").game.id;
  const later = render(value, { p: prefs({ manual: { [upcoming]: true } }) });
  assert.equal(links(later).length, 11);
  assert.match(later, /<table/); assert.match(text(later), /Record 4–2/);
});

test("before preferences load, every Duke game is concealed and aggregates wait", () => {
  const html = render(season(), { p: null });
  assert.equal(links(html).length, 0);
  assert.equal((html.match(/is-hidden/g) || []).length, 12);
  assert.match(text(html), /Checking your Duke settings…/);
  assert.doesNotMatch(html, /<table|Record <b>4–2|4 wins/);
});

test("the opponent's page conceals the shared Duke game and withholds its aggregates once that game has started (SYNTHETIC state)", () => {
  const value = season("153");
  const entry = value.regular.entries.find(e => e.game.id === SHARED);
  Object.assign(entry.game, { state: "final", started: true });
  const hide = prefs({ manual: { [SHARED]: true } });
  const html = render(value, { p: hide });
  assert.doesNotMatch(html, new RegExp(SHARED));
  assert.match(text(html), /Duke game hidden by your settings/);
  assert.match(text(html), /Record and season statistics hidden/);
  assert.doesNotMatch(html, /<table/);
  // Shown normally: the full name of the opponent and the same in-app link pattern.
  const shown = render(value);
  assert.match(shown, /<span class="s-name">Duke Blue Devils<\/span>/);
  assert.ok(links(shown).includes(`/?event=${SHARED}&team=153`));
  assert.match(text(shown), /Record unavailable/);
});

test("incomplete coverage, missing statistics and missing values are explicit", () => {
  const partial = render(season("150", { postseason: { status: "unavailable" } }));
  assert.match(text(partial), /Record not shown yet/);
  assert.match(text(partial), /Record and season statistics not shown yet/);
  assert.match(text(partial), /Postseason games couldn’t be loaded/);
  assert.equal(links(partial).length, 12);
  const noStats = render(season("150", { stats: null }));
  assert.match(text(noStats), /Season averages unavailable/);
  assert.match(text(noStats), /Record 4–2/);
  const gaps = season(); gaps.stats = { ...gaps.stats, rushingYards: ["209.5", null] };
  const html = render(gaps);
  assert.match(html, /<td class="c-opp"><span class="stat-missing" aria-label="Unavailable">—<\/span><\/td>/);
  assert.match(text(html), /— means a value is unavailable\./);
  const noRegular = render(season("150", { regular: { status: "unavailable" } }));
  assert.match(text(noRegular), /Regular season games couldn’t be loaded/);
  const stale = render(season("150", { stale: true }));
  assert.match(text(stale), /Couldn’t refresh this team\. Showing the season checked Oct 19, 1:04 AM ET\./);
});

test("loading, unavailable and offline states keep a focusable heading and a way back", () => {
  assert.match(render(null, { team: "150", pending: true }), /<h1 class="team-title" tabindex="-1">Loading team…<\/h1>/);
  const failed = render(null, { team: "150", failed: true, back: { title: "Scores", detail: "Today", label: "Back to scores, Today" } });
  assert.match(text(failed), /This team isn’t available Its season couldn’t be loaded\. Try again\. Retry Back to scores/);
  assert.match(text(render(null, { team: "150", online: false })), /You’re offline\. It will load when you reconnect\./);
});

test("the game screen's team links are quiet, in-app, outside the aria-hidden score grid, and absent when the game is unavailable", () => {
  const g = game({ id: "401858209", state: "final", status: "Final", teams: [
    { id: "2655", name: "Tulane", abbreviation: "TULN", logo: null, score: 10, rank: null, record: "", conferenceId: null },
    { id: "150", name: "Duke", abbreviation: "DUKE", logo: null, score: 17, rank: null, record: "", conferenceId: null },
  ] });
  const props = { game: g, loading: false, board: null, scopeError: false, backLabel: "Today", section: "team", onSection() {}, onBack() {},
    teamLinks: [{ id: "2655", name: "Tulane", href: "/?team=2655" }, { id: "150", name: "Duke", href: "/?team=150" }], onOpenTeam() {},
    back: { title: "Duke", detail: "Schedule", label: "Back to Duke schedule" } };
  const html = renderToStaticMarkup(createElement(ui.GameScreen, props));
  assert.match(html, /<nav class="team-links" aria-label="Team seasons"><span class="team-links-label" aria-hidden="true">Season &amp; schedule<\/span><a href="\/\?team=2655" data-focus-key="team-2655" aria-label="Tulane season and schedule">/);
  assert.deepEqual(links(html), ["/?team=2655", "/?team=150"]);
  // After the masthead (whose score grid is aria-hidden), before the section navigation.
  assert.ok(html.indexOf('class="team-links"') > html.indexOf("</section>"));
  assert.ok(html.indexOf('class="team-links"') < html.indexOf('class="view-nav"'));
  assert.match(html, /aria-label="Back to Duke schedule"/);
  assert.match(text(html), /Duke Schedule/);
  const hidden = renderToStaticMarkup(createElement(ui.GameScreen, { ...props, game: null }));
  assert.equal(links(hidden).length, 0);
  assert.match(text(hidden), /It isn’t on this team’s schedule, or it’s hidden by your settings\. Back to Duke/);
  // Without a team target, the existing Scores wording is unchanged.
  const plain = renderToStaticMarkup(createElement(ui.GameScreen, { ...props, back: undefined, teamLinks: undefined }));
  assert.match(plain, /aria-label="Back to scores, Today"/);
  assert.equal(links(plain).length, 0);
});

const leaderRows = { year: 2026, seasonType: 2, passingYards: { athleteId: "4870906", name: "Arch Manning", yards: 1295 }, rushingYards: { athleteId: "4871053", name: "Hollywood Smothers", yards: 289 }, receivingYards: { athleteId: "5218633", name: "Ryan Wingo", yards: 345 } };
test("season leaders precede unchanged averages, with full names, regular-season basis and total-yard units", () => {
  const html = render(season("150", { leaders: leaderRows }));
  assert.ok(html.indexOf("Season leaders") < html.indexOf("Season averages"));
  for (const name of ["Arch Manning", "Hollywood Smothers", "Ryan Wingo"]) assert.match(html, new RegExp(name));
  assert.match(text(html), /Season leaders Regular season Duke’s yard leaders. Passing Arch Manning 1,295 total yards Rushing Hollywood Smothers 289 total yards Receiving Ryan Wingo 345 total yards/);
  assert.equal(links(html).length, 12, "no fictitious player routes");
  const partial = render(season("150", { leaders: { ...leaderRows, rushingYards: null } }));
  assert.match(text(partial), /Rushing Leader unavailable/); assert.doesNotMatch(partial, /Hollywood Smothers|>289</);
  assert.match(text(partial), /Some season leaders couldn’t be loaded/);
  assert.match(render(season("150", { leaders: null }), { online: false }), /data-focus-key="leaders-retry" disabled=""/);
});
test("every aggregate withholding reason omits leader names and totals from all markup", () => {
  const full = season("150", { leaders: leaderRows });
  for (const [value, p] of [[full, null], [full, prefs({ rules: [{ from: 0, mode: "hide" }] })], [{ ...full, postseason: { status: "unavailable" } }, prefs()]]) {
    const html = render(value, { p });
    assert.doesNotMatch(html, /Arch Manning|Hollywood Smothers|Ryan Wingo|1,295|>289<|>345<|team-leader-row/);
  }
  // SYNTHETIC complete Duke-free coverage: null preferences must not blanket-hide aggregates.
  const dukeFree = { ...full, regular: { status: "complete", entries: [] } };
  assert.match(render(dukeFree, { p: null }), /Arch Manning/);
});
