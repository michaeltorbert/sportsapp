import { getScoreboard } from "@/lib/espn";
import { easternDate, validDate } from "@/lib/football";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") || easternDate();
  if (!validDate(date)) return Response.json({ error: "Use a valid YYYY-MM-DD date." }, { status: 400 });
  try { return Response.json(await getScoreboard(date), { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
  catch { return Response.json({ error: "ESPN scores are temporarily unavailable. Please retry." }, { status: 502, headers: { "Cache-Control": "no-store", "Retry-After": "30" } }); }
}
