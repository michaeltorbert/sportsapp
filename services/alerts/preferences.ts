import type { Database, Statement } from "./worker";
import { conditions, type Trigger } from "./rules";
import type { Game } from "../../lib/football";

export const preferenceTypes = ["closeGame", "upsetWatch", "upsetFinal", "kickoff"] as const;
export type Preference = typeof preferenceTypes[number];
export const preferences = {
  closeGame: { column: "close_game", since: "close_since", bit: 1, trigger: "one-score-fourth" },
  upsetWatch: { column: "upset_watch", since: "upset_since", bit: 2, trigger: "ranked-trailing-fourth" },
  upsetFinal: { column: "upset_final", since: "final_since", bit: 4, trigger: "upset-final" },
  kickoff: { column: "kickoff", since: "kickoff_since", bit: 8, trigger: "acc-kickoff" },
} as const;
export type Settings = { subscription_id: string; close_game: number; upset_watch: number; upset_final: number; revision: number; pending: number; close_since: number; upset_since: number; final_since: number; kickoff_since: number };
export const forTrigger = (trigger: Trigger) => preferences[preferenceTypes.find(key => preferences[key].trigger === trigger)!];
export function status(active: number, kickoff: number, settings: Settings) {
  return { active: !!active, kickoff: !!kickoff, closeGame: !!settings.close_game, upsetWatch: !!settings.upset_watch, upsetFinal: !!settings.upset_final, revision: settings.revision, preferencesVersion: 1 };
}
export function validPatch(value: unknown): value is Partial<Record<Preference | "active", boolean>> & { revision?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.some(([key]) => key !== "revision") && entries.every(([key, v]) => key === "revision" ? Number.isSafeInteger(v) && v >= 0 : [...preferenceTypes, "active"].includes(key) && typeof v === "boolean");
}

// Resolve a pending activation against one fully accepted board. The revision
// predicate prevents a racing PATCH from being accidentally baselined by this poll.
export async function activationBaselines(db: Database, games: Game[], now: number) {
  let after = "";
  for (;;) {
    const { results } = await db.prepare("SELECT * FROM subscription_settings WHERE pending<>0 AND subscription_id>? AND max(close_since,upset_since,final_since,kickoff_since)<? ORDER BY subscription_id LIMIT 100").bind(after, now).all<Settings>();
    if (!results.length) break;
    for (const settings of results) {
      const statements: Statement[] = [];
      const rows = games.flatMap(game => preferenceTypes.filter(key => (settings.pending & preferences[key].bit) && conditions(game, now)[preferences[key].trigger]).map(key => [game.id, preferences[key].trigger]));
      for (let i = 0; i < rows.length; i += 40) {
        statements.push(db.prepare("INSERT OR IGNORE INTO alert_suppressions(subscription_id,game_id,trigger,observed_at) SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM subscription_settings WHERE subscription_id=? AND revision=?)")
          .bind(settings.subscription_id, now, JSON.stringify(rows.slice(i, i + 40)), settings.subscription_id, settings.revision));
      }
      statements.push(db.prepare("UPDATE subscription_settings SET pending=0 WHERE subscription_id=? AND revision=?").bind(settings.subscription_id, settings.revision));
      await db.batch(statements);
    }
    after = results.at(-1)!.subscription_id;
  }
}
