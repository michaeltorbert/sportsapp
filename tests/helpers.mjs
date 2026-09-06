import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function bundle(entry) {
  const output = await build({ entryPoints: [entry], absWorkingDir: fileURLToPath(new URL("..", import.meta.url)), bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
}
export function game(changes = {}) {
  const team = (id, extra = {}) => ({ id, name: `Team ${id}`, abbreviation: id, logo: null, score: 14, rank: null, rankKnown: true, record: "0-0", conferenceId: "2", ...extra });
  return { id: "game1", date: "2026-09-06T02:30:00Z", timeValid: true, state: "live", status: "4th", period: 4, clock: 180, clockKnown: true, intermission: false, started: true, teams: [team("a"), team("b", { score: 21, rank: 20 })], broadcast: "ESPN", possession: null, downDistance: "", redZone: false, url: "https://www.espn.com/college-football/game/_/gameId/game1", ...changes };
}
export function scoreboard(games, date = "2026-09-05", extra = {}) { return { date, endDate: date, fetchedAt: "2026-09-06T04:01:00.000Z", games, ...extra }; }
export function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../services/alerts/migrations/0001_alerts.sql", import.meta.url), "utf8"));
  const db = {
    prepare(sql) {
      let args = [];
      return { bind(...values) { args = values; return this; }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async all() { return { results: sqlite.prepare(sql).all(...args), meta: { changes: 0 } }; }, async run() { const r = sqlite.prepare(sql).run(...args); return { results: [], meta: { changes: r.changes } }; } };
    },
    async batch(statements) { sqlite.exec("BEGIN"); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; } catch (e) { sqlite.exec("ROLLBACK"); throw e; } },
  };
  return { db, sqlite };
}
