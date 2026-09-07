import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  // This opt-in example is not a configured website binding. Keep its optional
  // type local rather than adding DB to the generated production environment.
  const { DB } = env as Cloudflare.Env & { DB?: D1Database };
  if (!DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. This optional starter example requires an explicitly configured D1 binding in wrangler.jsonc. The production website does not use a database."
    );
  }

  return drizzle(DB, { schema });
}
