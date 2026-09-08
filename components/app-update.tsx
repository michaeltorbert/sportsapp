import type { AppUpdate } from "@/lib/use-app-update";
export function AppUpdateNotice({ update }: { update: AppUpdate }) {
  return <><div role="status" aria-live="polite" className={update.target ? "app-update" : "sr-only"}>
    {update.target ? <><span>An app update is available.</span><div className="app-update-actions"><button onClick={update.refresh} disabled={update.refreshing}>Refresh app</button><button onClick={update.dismiss} disabled={update.refreshing}>Later</button></div></> : update.status}
  </div>{update.target && update.status && update.status !== "An app update is available." && <p className="app-update-status" role="status">{update.status}</p>}</>;
}
