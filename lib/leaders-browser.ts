import { z } from "zod";
export const LEADER_YEARS = [2026, 2025] as const;
export const LEADER_CATEGORIES = ["passing", "rushing", "receiving"] as const;
export type LeaderCategory = typeof LEADER_CATEGORIES[number];
export const LEADER_LABELS: Record<LeaderCategory, string> = { passing: "Passing", rushing: "Rushing", receiving: "Receiving" };
export type LeadersQuery = { year: number; category: LeaderCategory; team: string; conference: string; page: number };
export const LEADERS_PAGE_SIZE = 25;
const name = z.string().min(1).max(120).refine(v => v.trim() === v && !/[\u0000-\u001f\u007f<>]/.test(v));
const id = z.string().regex(/^[1-9]\d{0,11}$/), teamId = z.string().regex(/^[1-9]\d{0,5}$/);
const stamp = z.string().max(40).refine(v => Number.isFinite(Date.parse(v)));
const member = z.object({ id: teamId, school: name, mascot: name, conference: name.nullable() });
const row = z.object({ id, name, team: teamId, yards: z.number().int().min(-999999).max(999999) });
const side = z.object({ id: teamId, name, homeAway: z.enum(["away", "home"]) });
export const privacyGameSchema = z.object({ id, date: stamp, timeValid: z.boolean(), neutralSite: z.boolean(), state: z.enum(["upcoming", "live", "final", "delayed", "other", "unknown"]), started: z.boolean().nullable(), teams: z.tuple([side, side]) });
export type LeadersPrivacyGame = z.infer<typeof privacyGameSchema>;
const snapshotSchema = z.object({ v: z.literal(1), year: z.union([z.literal(2025), z.literal(2026)]), basis: z.literal("regular"), checkedAt: stamp,
  members: z.array(member).min(1).max(300), tables: z.object({ passing: z.array(row).max(10000), rushing: z.array(row).max(10000), receiving: z.array(row).max(10000) }),
  privacy: z.object({ checkedAt: stamp, games: z.array(privacyGameSchema).max(30) }).nullable() });
export type LeadersSnapshot = z.infer<typeof snapshotSchema>;
export type LeadersMember = z.infer<typeof member>;
export type LeadersRow = z.infer<typeof row>;
export const browserSnapshotKey = (year: number) => `leaders-browser:v1:${year}:regular`;
export const leadersMaxAge = (year: number) => year === 2026 ? 36 * 3600000 : 365 * 86400000;
export const leadersRefreshAge = (year: number) => year === 2026 ? 12 * 3600000 : 30 * 86400000;
export function parseLeadersQuery(params: URLSearchParams): LeadersQuery | null {
  const keys = ["season", "category", "team", "conference", "page"];
  if ([...params.keys()].some(k => !keys.includes(k) || params.getAll(k).length !== 1)) return null;
  const year = params.get("season") ?? "2026", category = params.get("category") ?? "passing", team = params.get("team") ?? "all", conference = params.get("conference") ?? "all", page = params.get("page") ?? "1";
  if (!/^\d{4}$/.test(year) || !LEADER_CATEGORIES.includes(category as LeaderCategory) || !(team === "all" || /^[1-9]\d{0,5}$/.test(team)) || !(conference === "all" || (conference.length > 0 && conference.length <= 120 && !/[\u0000-\u001f\u007f<>]/.test(conference))) || !/^[1-9]\d{0,4}$/.test(page)) return null;
  return { year: Number(year), category: category as LeaderCategory, team, conference, page: Number(page) };
}
export function leadersSearch(q: LeadersQuery) { return new URLSearchParams({ season: String(q.year), category: q.category, conference: q.conference, team: q.team, page: String(q.page) }).toString(); }
export const leadersHref = (q: LeadersQuery) => `/leaders?${leadersSearch(q)}`;
/** A return destination is exactly this in-app route, never a caller-controlled origin/path. */
export function leadersReturn(value: string | null): string | null {
  if (!value || value.length > 1000 || !value.startsWith("/leaders?") || value.includes("#")) return null;
  const query = parseLeadersQuery(new URLSearchParams(value.slice(9)));
  return query && LEADER_YEARS.includes(query.year as 2025 | 2026) ? leadersHref(query) : null;
}
export function parseLeadersSnapshot(raw: unknown, year: number, now = Date.now()): LeadersSnapshot | null {
  const parsed = snapshotSchema.safeParse(raw); if (!parsed.success || parsed.data.year !== year) return null;
  const s = parsed.data, age = now - Date.parse(s.checkedAt);
  if (age < 0 || age > leadersMaxAge(year)) return null;
  const ids = new Set(s.members.map(t => t.id)), schools = new Set(s.members.map(t => t.school));
  if (ids.size !== s.members.length || schools.size !== s.members.length) return null;
  for (const rows of Object.values(s.tables)) if (new Set(rows.map(r => `${r.team}:${r.id}`)).size !== rows.length || rows.some(r => !ids.has(r.team)) || !rows.length) return null;
  if (s.privacy) {
    const pAge = now - Date.parse(s.privacy.checkedAt);
    if (pAge < 0 || pAge > leadersMaxAge(year) || new Set(s.privacy.games.map(g => g.id)).size !== s.privacy.games.length || s.privacy.games.some(g => g.teams[0].id === g.teams[1].id || g.teams[0].homeAway === g.teams[1].homeAway || !g.teams.some(t => t.id === "150") || (g.state !== "unknown" && g.started === null))) return null;
  }
  return s;
}
export function selectLeaders(snapshot: LeadersSnapshot, query: LeadersQuery, excluded: Set<string>) {
  const member = snapshot.members.find(t => t.id === query.team);
  const unavailable = query.year !== snapshot.year || (query.team !== "all" && !member) || (query.conference !== "all" && !snapshot.members.some(t => t.conference === query.conference));
  const scope = snapshot.members.filter(t => (query.team === "all" || t.id === query.team) && (query.conference === "all" || t.conference === query.conference));
  const visible = new Set(scope.filter(t => !excluded.has(t.id)).map(t => t.id));
  // No rank, count, page boundary, tie or sort input depends on an excluded row.
  const rows = snapshot.tables[query.category].filter(r => visible.has(r.team)).sort((a,b) => b.yards - a.yards || a.team.localeCompare(b.team) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  let previous: number | undefined, rank = 0;
  const ranked = rows.map((row,index) => { if (row.yards !== previous) rank = index + 1; previous = row.yards; return { ...row, rank }; });
  const pages = Math.max(1, Math.ceil(rows.length / LEADERS_PAGE_SIZE));
  return { unavailable, protectedScope: scope.some(t => excluded.has(t.id)), count: rows.length, pages, rows: ranked.slice((query.page - 1) * LEADERS_PAGE_SIZE, query.page * LEADERS_PAGE_SIZE) };
}
