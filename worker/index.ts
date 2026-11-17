// Preserve vinext's fetch handler; only the controlled snapshot publisher runs on cron.
import app from "vinext/server/app-router-entry";
import { refreshSeasonLeaders, type LeadersEnv } from "../lib/cfbd-season-leaders";
import { refreshTeamRankings } from "../lib/cfbd-team-rankings";
import { refreshBrowserSources } from "../lib/leaders-browser-server";
export default {
  ...app,
  scheduled(_controller: ScheduledController, env: LeadersEnv, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const leaders = await refreshSeasonLeaders(env);
      console.log(JSON.stringify({ event: "season_leaders_refresh", ...leaders }));
      // Serial, shared denial state: a denied source cannot be called by the next product.
      if (leaders.status === "blocked" || leaders.reason === "storage-unavailable") return;
      const rankings = await refreshTeamRankings(env);
      console.log(JSON.stringify({ event: "team_rankings_refresh", ...rankings }));
      if (rankings.status === "blocked" || rankings.reason === "storage-unavailable") return;
      const browser = await refreshBrowserSources(env);
      console.log(JSON.stringify({ event: "leaders_browser_refresh", ...browser }));
    })());
  },
};
