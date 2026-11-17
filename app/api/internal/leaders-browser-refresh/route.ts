import { handleBrowserRefresh } from "@/lib/leaders-browser-server";
import type { LeadersEnv } from "@/lib/cfbd-season-leaders";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  return handleBrowserRefresh(request,env as LeadersEnv);
}
