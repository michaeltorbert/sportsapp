import { validEventId, withoutScoring } from "@/lib/game-stats";
import { createStatsService } from "@/lib/stats-server";
export const dynamic = "force-dynamic";
const service = createStatsService();
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const event = params.get("event"), phase = params.get("phase"), refresh = params.get("refresh") ?? "0", scoring = params.get("scoring") ?? "0";
  // Only a bounded event ID and advisory hints are accepted; the upstream URL is fixed.
  if (!validEventId(event) || (phase !== "pregame" && phase !== "started" && phase !== "final") || (refresh !== "0" && refresh !== "1") || (scoring !== "0" && scoring !== "1"))
    return Response.json({ error: "Use a numeric event, phase pregame|started|final, refresh 0|1 and optional scoring 0|1." }, { status: 400, headers });
  // One cached snapshot serves both: clients that don't ask for scoring get the released body unchanged.
  const result = await service.get(event, phase, refresh === "1");
  if (result.status === 200) return Response.json(scoring === "1" ? result.stats : withoutScoring(result.stats), { headers });
  return Response.json({ error: result.error }, { status: result.status, headers: { ...headers, "Retry-After": String(result.retryAfter) } });
}
