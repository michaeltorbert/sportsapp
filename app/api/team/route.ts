import { readTeamRankings } from "@/lib/cfbd-team-rankings";
import { validTeamId } from "@/lib/team-season";
import { readSeasonLeaders, type LeadersEnv } from "@/lib/cfbd-season-leaders";
import { createTeamSeasonService } from "@/lib/team-season-server";
export const dynamic = "force-dynamic";
// Load runtime bindings only while handling a request: Node prerender imports route modules too.
const service = createTeamSeasonService(fetch, Date.now, async (id, year, name, shortName) => {
  const { env } = await import("cloudflare:workers");
  return readSeasonLeaders((env as LeadersEnv).SEASON_LEADERS_KV, id, year, name, shortName);
}, async (id, year, name, shortName) => {
  const { env } = await import("cloudflare:workers");
  return readTeamRankings((env as LeadersEnv).SEASON_LEADERS_KV, id, year, name, shortName);
});
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const teams = new URL(request.url).searchParams.getAll("team");
  // Only one bounded numeric team ID is accepted; every upstream URL is fixed.
  if (teams.length !== 1 || !validTeamId(teams[0])) return Response.json({ error: "Use one numeric team." }, { status: 400, headers });
  const result = await service.get(teams[0]);
  if (result.status === 200) return Response.json(result.season, { headers });
  return Response.json({ error: result.error }, { status: result.status, headers: { ...headers, "Retry-After": String(result.retryAfter) } });
}
