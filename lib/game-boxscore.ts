import { z } from "zod";

/** Version 1 positions are fixed by this registry, never by upstream array order. */
export const BOX_CATEGORIES = ["passing", "rushing", "receiving", "fumbles", "defensive", "interceptions", "kickReturns", "puntReturns", "kicking", "punting"] as const;
export type BoxCategory = typeof BOX_CATEGORIES[number];
export const BOXSCORE_MAX_BYTES = 64 * 1024;
export const BOXSCORE_MAX_ROWS = 256;
type Format = "count" | "yards" | "average" | "fraction" | "percent" | "ratio";
type Column = { key: string; label: string; meaning: string; format: Format; optional?: true };
const col = (key: string, label: string, meaning: string, format: Format = "count"): Column => ({ key, label, meaning, format });
export const BOX_REGISTRY: Record<BoxCategory, { title: string; columns: Column[] }> = {
  passing: { title: "Passing", columns: [col("completions/passingAttempts", "C/ATT", "completions/attempts", "ratio"), col("passingYards", "YDS", "yards", "yards"), col("yardsPerPassAttempt", "AVG", "yards per attempt", "average"), col("passingTouchdowns", "TD", "touchdowns"), col("interceptions", "INT", "interceptions thrown"), { ...col("adjQBR", "QBR", "Total QBR (0–100)", "percent"), optional: true }] },
  rushing: { title: "Rushing", columns: [col("rushingAttempts", "CAR", "carries"), col("rushingYards", "YDS", "yards", "yards"), col("yardsPerRushAttempt", "AVG", "yards per carry", "average"), col("rushingTouchdowns", "TD", "touchdowns"), col("longRushing", "LONG", "longest run in yards")] },
  receiving: { title: "Receiving", columns: [col("receptions", "REC", "receptions"), col("receivingYards", "YDS", "yards", "yards"), col("yardsPerReception", "AVG", "yards per reception", "average"), col("receivingTouchdowns", "TD", "touchdowns"), col("longReception", "LONG", "longest reception in yards")] },
  fumbles: { title: "Fumbles", columns: [col("fumbles", "FUM", "fumbles"), col("fumblesLost", "LOST", "fumbles lost"), col("fumblesRecovered", "REC", "fumbles recovered")] },
  defensive: { title: "Defense", columns: [col("totalTackles", "TOT", "total tackles"), col("soloTackles", "SOLO", "solo tackles"), col("sacks", "SACKS", "sacks", "fraction"), col("tacklesForLoss", "TFL", "tackles for loss", "fraction"), col("passesDefended", "PD", "passes defended"), col("hurries", "QB HUR", "quarterback hurries"), col("defensiveTouchdowns", "TD", "defensive touchdowns")] },
  interceptions: { title: "Interceptions", columns: [col("interceptions", "INT", "interceptions made"), col("interceptionYards", "YDS", "return yards", "yards"), col("interceptionTouchdowns", "TD", "return touchdowns")] },
  kickReturns: { title: "Kick returns", columns: [col("kickReturns", "NO", "returns"), col("kickReturnYards", "YDS", "return yards", "yards"), col("yardsPerKickReturn", "AVG", "yards per return", "average"), col("longKickReturn", "LONG", "longest return in yards"), col("kickReturnTouchdowns", "TD", "return touchdowns")] },
  puntReturns: { title: "Punt returns", columns: [col("puntReturns", "NO", "returns"), col("puntReturnYards", "YDS", "return yards", "yards"), col("yardsPerPuntReturn", "AVG", "yards per return", "average"), col("longPuntReturn", "LONG", "longest return in yards"), col("puntReturnTouchdowns", "TD", "return touchdowns")] },
  kicking: { title: "Kicking", columns: [col("fieldGoalsMade/fieldGoalAttempts", "FG", "field goals made/attempts", "ratio"), col("fieldGoalPct", "PCT", "field goal percentage (%)", "percent"), col("longFieldGoalMade", "LONG", "longest made field goal in yards"), col("extraPointsMade/extraPointAttempts", "XP", "extra points made/attempts", "ratio"), col("totalKickingPoints", "PTS", "kicking points")] },
  punting: { title: "Punting", columns: [col("punts", "NO", "punts"), col("puntYards", "YDS", "yards", "yards"), col("grossAvgPuntYards", "AVG", "yards per punt", "average"), col("touchbacks", "TB", "touchbacks"), col("puntsInside20", "In 20", "punts inside the 20-yard line"), col("longPunt", "LONG", "longest punt in yards")] },
};
export type BoxUnavailable = { unavailable: "missing" | "malformed" | "identity" | "mixed" | "too-many" | "too-large" };
export type BoxRow = { athleteId: string; name: string | null; values: (string | null)[] };
export type BoxRows = { rows: BoxRow[]; totals: (string | null)[] | null; partial?: true; unaligned?: true; totalsUnaligned?: true };
export type BoxTeam = { teamId: string; categories: Record<BoxCategory, BoxRows | BoxUnavailable>; partial?: true } | (BoxUnavailable & { teamId: string });
export type Boxscore = { v: 1; teams: [BoxTeam, BoxTeam]; partial?: true } | BoxUnavailable;
const FORMATS: Record<Format, RegExp> = {
  count: /^\d{1,5}$/, yards: /^-?\d{1,5}$/, average: /^-?\d{1,5}(?:\.\d{1,2})?$/,
  fraction: /^\d{1,5}(?:\.\d{1,2})?$/, percent: /^\d{1,3}(?:\.\d{1,2})?$/, ratio: /^\d{1,3}\/\d{1,3}$/,
};
export function validBoxValue(value: unknown, column: Column): value is string {
  if (typeof value !== "string" || value.length > 16 || !FORMATS[column.format].test(value)) return false;
  if (column.format === "percent" && Number(value) > 100) return false;
  if (column.format === "ratio") { const [made, attempts] = value.split("/").map(Number); if (made > attempts) return false; }
  return true;
}
type Raw = Record<string, unknown>;
const object = (value: unknown): Raw => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const id = (value: unknown, athlete = false) => {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  return typeof text === "string" && (athlete ? /^-?\d{1,12}$/ : /^\d{1,12}$/).test(text) ? text : null;
};
const nameOf = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64 ? value.trim() : null;
export const boxscoreBytes = (value: Boxscore) => new TextEncoder().encode(JSON.stringify(value)).length;

function categoryRows(raw: Raw, category: BoxCategory): BoxRows | BoxUnavailable {
  if (!Array.isArray(raw.athletes)) return { unavailable: "malformed" };
  if (raw.athletes.length > BOXSCORE_MAX_ROWS) return { unavailable: "too-many" };
  const columns = BOX_REGISTRY[category].columns;
  const keys = array(raw.keys), labels = array(raw.labels);
  const known = new Set(columns.map(c => c.key));
  const metadata = new Set(["name", "keys", "text", "labels", "descriptions", "athletes", "totals"]);
  let partial = Object.keys(raw).some(key => !metadata.has(key)) || keys.some(key => typeof key !== "string" || !known.has(key)) || labels.length > keys.length;
  const uniqueKeys = keys.every(key => typeof key === "string") && new Set(keys).size === keys.length;
  // Only the observed trailing optional QBR may have a key without its label/value.
  const shape = Array.isArray(raw.keys) && Array.isArray(raw.labels) && uniqueKeys &&
    (keys.length === labels.length || (category === "passing" && keys.length === labels.length + 1 && keys.at(-1) === "adjQBR")) &&
    (raw.descriptions === undefined || (Array.isArray(raw.descriptions) && raw.descriptions.length === labels.length));
  const indexes = columns.map(column => {
    const index = keys.indexOf(column.key);
    return shape && index >= 0 && labels[index] === column.label ? index : -1;
  });
  const unaligned = !shape || indexes.some((index, i) => index < 0 && !columns[i].optional);
  if (unaligned) partial = true;
  const mapValues = (values: unknown[]): (string | null)[] => columns.map((column, i) => {
    const value = indexes[i] >= 0 && values.length === labels.length ? values[indexes[i]] : undefined;
    const clean = typeof value === "string" ? value.trim() : value;
    if (validBoxValue(clean, column)) return clean;
    if (!column.optional || (value !== undefined && value !== null && value !== "-" && value !== "--")) partial = true;
    return null;
  });
  const seen = new Set<string>();
  const rows: BoxRow[] = [];
  for (const rawRow of raw.athletes) {
    const row = object(rawRow), athlete = object(row.athlete), athleteId = id(athlete.id, true);
    if (Object.keys(row).some(key => key !== "athlete" && key !== "stats")) partial = true;
    if (!athleteId || seen.has(athleteId)) return { unavailable: "malformed" };
    seen.add(athleteId);
    const values = mapValues(array(row.stats));
    if (!Array.isArray(row.stats) || row.stats.length !== labels.length) partial = true;
    const name = nameOf(athlete.displayName);
    if (name === null) partial = true;
    rows.push({ athleteId, name, values });
  }
  const suppliedTotals = array(raw.totals);
  const totalsUnaligned = raw.totals !== undefined && (!Array.isArray(raw.totals) || (suppliedTotals.length !== 0 && suppliedTotals.length !== labels.length));
  if (totalsUnaligned) partial = true;
  const totals = suppliedTotals.length ? mapValues(suppliedTotals) : null;
  return { rows, totals, ...(partial ? { partial: true } : {}), ...(unaligned ? { unaligned: true } : {}), ...(totalsUnaligned ? { totalsUnaligned: true } : {}) };
}

/** Receives identities already validated by the game summary normalizer. No source requests. */
export function normalizeBoxscore(raw: unknown, teamIds: [string, string]): Boxscore {
  const entries = array(raw);
  if (!entries.length) return { unavailable: "missing" };
  const byTeam = new Map<string, Raw>();
  for (const value of entries) {
    const entry = object(value), teamId = id(object(entry.team).id);
    if (!teamId || !teamIds.includes(teamId) || byTeam.has(teamId)) return { unavailable: "identity" };
    if (entry.homeAway !== undefined && entry.homeAway !== (teamId === teamIds[0] ? "away" : "home")) return { unavailable: "identity" };
    byTeam.set(teamId, entry);
  }
  let partial = false;
  const teams = teamIds.map((teamId): BoxTeam => {
    const entry = byTeam.get(teamId);
    if (!entry) { partial = true; return { teamId, unavailable: "missing" }; }
    if (!Array.isArray(entry.statistics)) { partial = true; return { teamId, unavailable: "malformed" }; }
    const groups = new Map<string, Raw[]>();
    let teamPartial = false;
    for (const item of entry.statistics) {
      const group = object(item);
      if (typeof group.name !== "string" || !(BOX_CATEGORIES as readonly string[]).includes(group.name)) { teamPartial = true; continue; }
      groups.set(group.name, [...(groups.get(group.name) || []), group]);
    }
    const categories = Object.fromEntries(BOX_CATEGORIES.map(category => {
      const found = groups.get(category);
      const data: BoxRows | BoxUnavailable = !found ? { unavailable: "missing" } : found.length > 1 ? { unavailable: "malformed" } : categoryRows(found[0], category);
      if ("unavailable" in data || data.partial) teamPartial = true;
      return [category, data];
    })) as Record<BoxCategory, BoxRows | BoxUnavailable>;
    if (teamPartial) partial = true;
    return { teamId, categories, ...(teamPartial ? { partial: true } : {}) };
  }) as [BoxTeam, BoxTeam];
  const result: Boxscore = { v: 1, teams, ...(partial ? { partial: true } : {}) };
  return boxscoreBytes(result) <= BOXSCORE_MAX_BYTES ? result : { unavailable: "too-large" };
}

const unavailableSchema = z.object({ unavailable: z.enum(["missing", "malformed", "identity", "mixed", "too-many", "too-large"]) }).strict();
const flag = z.literal(true).optional();
function valuesSchema(category: BoxCategory) {
  const columns = BOX_REGISTRY[category].columns;
  return z.array(z.string().max(16).nullable()).length(columns.length).superRefine((values, context) => {
    values.forEach((value, i) => { if (i >= columns.length || (value !== null && !validBoxValue(value, columns[i]))) context.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: "Invalid box-score value" }); });
  });
}
const categoriesSchema = z.object(Object.fromEntries(BOX_CATEGORIES.map(category => {
  const values = valuesSchema(category);
  return [category, z.union([unavailableSchema, z.object({
    rows: z.array(z.object({ athleteId: z.string().regex(/^-?\d{1,12}$/), name: z.string().min(1).max(64).nullable(), values }).strict()).max(BOXSCORE_MAX_ROWS),
    totals: values.nullable(), partial: flag, unaligned: flag, totalsUnaligned: flag,
  }).strict()])];
}))).strict();
const teamSchema = z.union([unavailableSchema.extend({ teamId: z.string().regex(/^\d{1,12}$/) }).strict(), z.object({ teamId: z.string().regex(/^\d{1,12}$/), categories: categoriesSchema, partial: flag }).strict()]);
export const boxscoreSchema = z.union([unavailableSchema, z.object({ v: z.literal(1), teams: z.tuple([teamSchema, teamSchema]), partial: flag }).strict()]).superRefine((value, context) => {
  if (boxscoreBytes(value as Boxscore) > BOXSCORE_MAX_BYTES) context.addIssue({ code: z.ZodIssueCode.custom, message: "Box score exceeds budget" });
  if ("teams" in value) {
    if (value.teams[0].teamId === value.teams[1].teamId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate box-score teams" });
    for (const [side, team] of value.teams.entries()) if ("categories" in team) for (const category of BOX_CATEGORIES) {
      const data = team.categories[category];
      if (data && "rows" in data && new Set(data.rows.map(row => row.athleteId)).size !== data.rows.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["teams", side, "categories", category], message: "Duplicate participant" });
    }
  }
});

/** Independent of legacy offense availability; identity and phase remain shared trust gates. */
export function boxscoreDisplay(stats: { teamIds: [string, string]; sourcePhase: string; boxscore?: Boxscore }, expected: string): "available" | "limited" | "unavailable" | "catching-up" {
  if (stats.sourcePhase !== expected) return "catching-up";
  if (!stats.boxscore) return "limited";
  if (!("teams" in stats.boxscore) || expected === "pregame") return "unavailable";
  if (stats.boxscore.teams.some((team, i) => team.teamId !== stats.teamIds[i])) return "unavailable";
  return stats.boxscore.teams.some(team => "categories" in team && BOX_CATEGORIES.some(category => "rows" in team.categories[category])) ? "available" : "unavailable";
}
