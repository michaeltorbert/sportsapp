import { createTrace } from "@/lib/schedule-diagnostics";
import { getScoreboard } from "@/lib/espn";
import { easternDate, shiftDate, validDate } from "@/lib/football";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date") || easternDate(), end = params.get("end") || date;
  if (!validDate(date) || !validDate(end) || end < date || end > shiftDate(date, 4)) return Response.json({ error: "Use valid YYYY-MM-DD dates spanning at most five days." }, { status: 400 });
  const trace = createTrace(date, end, "standalone", "server");
  try { const board = await getScoreboard(date, end, params.get("acc") === "1", trace); return Response.json({ ...board, scheduleDiagnostics: trace.data }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
  catch { return Response.json({ error: "ESPN scores are temporarily unavailable. Please retry.", scheduleDiagnostics: trace.data }, { status: 502, headers: { "Cache-Control": "no-store", "Retry-After": "30" } }); }
}
