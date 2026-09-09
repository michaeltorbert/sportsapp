// Generate reviewed operator SQL only. This helper never connects to a database.
import { pathToFileURL } from "node:url";

export const stateIds = ["preferences_epoch", "next_poll", "preferences_delivery_enabled", "preferences_cutover_complete"];
const ids = stateIds.map(id => `'${id}'`).join(",");
// Database time, not the time at which an operator generated the SQL file.
const now = "(CAST(strftime('%s','now') AS INTEGER)*1000)";
export function fenceSql(action, owner) {
  if (!/^cutover-[a-f0-9-]{36}$/.test(owner || "")) throw new Error("Use a fresh cutover-UUID owner for this attempt");
  const owns = `EXISTS(SELECT 1 FROM poll_lock WHERE id='scores' AND owner='${owner}' AND expires_at>${now})`;
  // Acquisition always uses the fixed two-hour lease above. This minimum is
  // additional to the operator's verified provider/replacement drain evidence.
  const drained = `EXISTS(SELECT 1 FROM poll_lock WHERE id='scores' AND owner='${owner}' AND ${now}>expires_at-7200000+960000)`;
  const paused = "EXISTS(SELECT 1 FROM poll_state WHERE id='preferences_delivery_enabled' AND value=0)";
  const complete = `(SELECT count(*) FROM poll_state WHERE id IN (${ids}))=4`;
  const statements = {
    acquire: `INSERT INTO poll_lock(id,owner,expires_at) VALUES('scores','${owner}',${now}+7200000) ON CONFLICT(id) DO NOTHING;`,
    activate: `UPDATE poll_state SET value=CASE WHEN id IN ('preferences_epoch','next_poll') THEN 0 ELSE 1 END WHERE id IN (${ids}) AND ${owns} AND ${complete} AND ${drained} AND ${paused};`,
    pause: `UPDATE poll_state SET value=0 WHERE id='preferences_delivery_enabled';`,
    release: `DELETE FROM poll_lock WHERE id='scores' AND owner='${owner}';`,
    inspect: `SELECT ${now} AS database_now, ${owns} AS owns_unexpired_fence, ${complete} AS all_four_rows_exist, ${drained} AS minimum_acquisition_drain_elapsed, ${paused} AS delivery_paused;`,
  };
  if (!(action in statements)) throw new Error("Action must be acquire, inspect, activate, pause or release");
  return `${statements[action]}\n${action === "inspect" ? "" : "SELECT changes() AS changed_rows;\n"}SELECT id,owner,expires_at FROM poll_lock WHERE id='scores';\nSELECT id,value FROM poll_state WHERE id IN (${ids});\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error("Usage: node scripts/alert-preferences-fence.mjs ACTION cutover-UUID (prints SQL; does not execute)");
  process.stdout.write(fenceSql(process.argv[2], process.argv[3]));
}
