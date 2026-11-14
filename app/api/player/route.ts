import { parsePlayerRequest } from "@/lib/player-season";
import { createPlayerSeasonService } from "@/lib/player-season-server";
import type { LeadersEnv } from "@/lib/cfbd-season-leaders";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const parsed = parsePlayerRequest(new URL(request.url).searchParams);
  if (!parsed) return Response.json({ error: "Invalid player, season or entry context." }, { status: 400, headers });
  const { env } = await import("cloudflare:workers");
  const result = await createPlayerSeasonService(env as LeadersEnv).get(parsed);
  return Response.json(result.season ?? { error: result.error }, { status: result.status, headers: { ...headers, ...(result.status === 503 ? { "Retry-After": "300" } : {}) } });
}
