// Read-only verification using the same game-day resolver shipped to the app.
// Run with Node 24 and NODE_USE_ENV_PROXY=1 when this environment requires a proxy.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir(new URL("../.sites-runtime/", import.meta.url), { recursive: true });
const path = new URL("../.sites-runtime/midnight-check.mjs", import.meta.url);
await build({ stdin: { contents: 'export * from "./lib/football.ts"; export * from "./lib/espn-data.ts";', resolveDir: new URL("..", import.meta.url).pathname }, bundle: true, platform: "node", format: "esm", outfile: path.pathname });
const { easternDate, shiftDate, normalizeScoreboard, scoreboardUrl, gameDay, unfinished } = await import(path.href);
const now = new Date(), calendar = easternDate(now), previousDate = shiftDate(calendar, -1);
const response = await fetch(scoreboardUrl(previousDate), { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
const previous = normalizeScoreboard(await response.json(), previousDate);
if (previous.warnings?.length) throw new Error("Incomplete feed: cannot verify rollover");
const unfinishedGames = previous.games.filter(unfinished);
const effective = gameDay(now, previous, previousDate);
console.log(JSON.stringify({ checkedAt: now.toISOString(), calendarET: calendar, effectiveGameDay: effective, previousDate, previousGames: previous.games.length, unfinishedGames: unfinishedGames.map(g => ({ id: g.id, teams: g.teams.map(t => t.name), status: g.status, state: g.state })), passed: effective === (unfinishedGames.length ? previousDate : calendar), scope: "Live ESPN data with the shipped resolver; not a Safari visual or device push test." }, null, 2));
