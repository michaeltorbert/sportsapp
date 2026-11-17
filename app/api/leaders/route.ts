import { LEADER_YEARS, parseLeadersQuery } from "@/lib/leaders-browser";
import { readBrowserSnapshot } from "@/lib/leaders-browser-server";
import type { LeadersEnv } from "@/lib/cfbd-season-leaders";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const query = parseLeadersQuery(new URL(request.url).searchParams);
  if (!query || !LEADER_YEARS.includes(query.year as 2025 | 2026)) return Response.json({error:"That season or selection isn’t supported. Choose 2025 or 2026."},{status:400,headers});
  const { env } = await import("cloudflare:workers");
  const snapshot = await readBrowserSnapshot((env as LeadersEnv).SEASON_LEADERS_KV,query.year);
  return snapshot ? Response.json({query,snapshot},{headers}) : Response.json({error:"Leaders are temporarily unavailable for the selected season."},{status:503,headers:{...headers,"Retry-After":"300"}});
}
