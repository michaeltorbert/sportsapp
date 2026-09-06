import { VERSION } from "@/lib/releases";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ version: VERSION, commit: process.env.SOURCE_COMMIT || "development" }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
