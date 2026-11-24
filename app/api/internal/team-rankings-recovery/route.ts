import { handleRankingsRecovery } from "@/lib/cfbd-team-rankings";
import type { LeadersEnv } from "@/lib/cfbd-season-leaders";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  return handleRankingsRecovery(request, env as LeadersEnv);
}
