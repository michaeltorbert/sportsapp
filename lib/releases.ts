export const VERSION = "1.3.3";
export const releases = [
  { version: "1.3.3", date: "September 7, 2026", changes: "Restored automated TypeScript checks and strengthened regression coverage and support documentation for alert feeds and paused-game history." },
  { version: "1.3.2", date: "September 7, 2026", changes: "Improved alert-feed coverage checks and preserved one-score game history across delays and reloads. Repaired the standalone TypeScript check." },
  { version: "1.3.1", date: "September 6, 2026", changes: "Added a secure single-device notification test for support checks, with duplicate protection. Expanded automated checks for mobile navigation, overnight rollover, alert recovery, and notification handling." },
  { version: "1.3.0", date: "September 6, 2026", changes: "Prioritized games by team relevance, live drama, and upset significance. Added meaningful unranked ACC/SEC upset watches and improved favorite-data recovery and paused-game history. Existing phone-alert rules are preserved." },
  { version: "1.2.0", date: "September 6, 2026", changes: "Prepared Cloudflare hosting with automated release checks and support for alerts at the new address. Added upcoming Top 25 games across the football week." },
  { version: "1.1.5", date: "September 6, 2026", changes: "Kept daily and weekly ACC tab counts available when switching views. Clarified retained finals and limited the overnight Today notice to daily views." },
  { version: "1.1.4", date: "September 6, 2026", changes: "Restored background score polling through ESPN's complete CDN feed, with the prior score API retained as a fallback." },
  { version: "1.1.3", date: "September 5, 2026", changes: "Fixed inclusive score-feed date ranges. Prepared overtime alerts, first-seen live-game catch-up, and clearer service diagnostics. Cloudflare update pending." },
  { version: "1.1.2", date: "September 5, 2026", changes: "Connected alert-service settings with automatic availability checks. Alerts become available after scheduled polling is running." },
  { version: "1.1.1", date: "September 5, 2026", changes: "Prepared the cloud alert service and reduced database work during busy game days. Alert activation is pending." },
  { version: "1.1.0", date: "September 5, 2026", changes: "Top 25 view, consistent sorting, retained finals, weekly ACC schedule, overnight game days, and alert setup." },
  { version: "1.0.1", date: "September 5, 2026", changes: "Direct ESPN scores in the browser, with a server fallback and the full FBS slate." },
  { version: "1.0.0", date: "September 5, 2026", changes: "First public release: mobile watchlist, ACC, one-score games, and upset watch." },
];
