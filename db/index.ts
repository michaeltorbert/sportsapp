import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. This optional starter example requires an explicitly configured D1 binding in wrangler.jsonc. The production website does not use a database."
    );
  }

  return drizzle(env.DB, { schema });
}
