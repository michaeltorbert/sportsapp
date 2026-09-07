import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// The website's wrangler.jsonc declares only the ASSETS binding, so the generated
// Cloudflare.Env has no database. This optional starter example alone knows about
// a D1 binding that a deployment could add; it stays out of the shared Env type.
const bindings = env as Cloudflare.Env & { DB?: D1Database };

export function getDb() {
  if (!bindings.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. This optional starter example requires an explicitly configured D1 binding in wrangler.jsonc. The production website does not use a database."
    );
  }

  return drizzle(bindings.DB, { schema });
}
