import { parseTeamDefenseQuery } from "@/lib/team-defense";
import { createPlayerSeasonService } from "@/lib/player-season-server";
import type { LeadersEnv } from "@/lib/cfbd-season-leaders";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
/** #181: a selected team's current regular-season defensive leaders, from the same admitted player pack.
 *  Malformed, duplicate or unknown parameters are rejected before any storage or source work. */
export async function GET(request: Request) {
  const parsed = parseTeamDefenseQuery(new URL(request.url).searchParams);
  if (!parsed) return Response.json({ error: "Invalid team or season." }, { status: 400, headers });
  const { env } = await import("cloudflare:workers");
  const result = await createPlayerSeasonService(env as LeadersEnv).teamDefense(parsed.team, parsed.year);
  return Response.json(result.defense ?? { error: result.error }, { status: result.status, headers: { ...headers, ...(result.status === 503 ? { "Retry-After": "300" } : {}) } });
}
