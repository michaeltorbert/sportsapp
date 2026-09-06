export const VERSION = "1.1.4";
export const releases = [
  { version: "1.1.4", date: "September 6, 2026", changes: "Restored background score polling through ESPN's complete CDN feed, with the prior score API retained as a fallback." },
  { version: "1.1.3", date: "September 5, 2026", changes: "Fixed inclusive score-feed date ranges. Prepared overtime alerts, first-seen live-game catch-up, and clearer service diagnostics. Cloudflare update pending." },
  { version: "1.1.2", date: "September 5, 2026", changes: "Connected alert-service settings with automatic availability checks. Alerts become available after scheduled polling is running." },
  { version: "1.1.1", date: "September 5, 2026", changes: "Prepared the cloud alert service and reduced database work during busy game days. Alert activation is pending." },
  { version: "1.1.0", date: "September 5, 2026", changes: "Top 25 view, consistent sorting, retained finals, weekly ACC schedule, overnight game days, and alert setup." },
  { version: "1.0.1", date: "September 5, 2026", changes: "Direct ESPN scores in the browser, with a server fallback and the full FBS slate." },
  { version: "1.0.0", date: "September 5, 2026", changes: "First public release: mobile watchlist, ACC, one-score games, and upset watch." },
];
