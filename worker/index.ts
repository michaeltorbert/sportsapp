// Preserve vinext's fetch handler; only the controlled snapshot publisher runs on cron.
import app from "vinext/server/app-router-entry";
import { refreshSeasonLeaders, type LeadersEnv } from "../lib/cfbd-season-leaders";
export default {
  ...app,
  scheduled(_controller: ScheduledController, env: LeadersEnv, ctx: ExecutionContext) {
    ctx.waitUntil(refreshSeasonLeaders(env).then(result => { console.log(JSON.stringify({ event: "season_leaders_refresh", ...result })); }));
  },
};
