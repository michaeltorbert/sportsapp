# Saturday Signal

- GitHub repository: `michaeltorbert/sportsapp`; verify `origin` agrees before writes.
- Codex GitHub writes use the `games-codex` App profile (`codex-bot-mt`). Claude-attributed writes use `claude` (`claude-bot-mt`). Do not use the personal GitHub identity.
- Every PR has exactly one actual-author marker, normally `<!-- ai-author: codex -->`.
- Run `npm test`, `npm run deploy:check`, and `npm run deploy:alerts -- --dry-run` for deployment changes. Preview builds use `CLOUDFLARE_ENV=preview`; rebuild without it for production.
- Production is Cloudflare Workers in the existing Scythe Wildflower account. Versioned Wrangler configuration and `docs/releases.md` describe the release path; GitHub is the source of truth. A PR or merge alone does not deploy production.
- Preserve the existing alerts Worker, D1 database, cron, VAPID secrets, trigger IDs, subscriptions, and delivery ledger. No reset or key rotation during a hosting migration.
- Allow only explicitly configured alert origins. Preserve the old Sites origin until the transition is verified. Do not authorize wildcard preview origins.
- Never claim phone notification delivery from unit tests or `/config` readiness alone. Deployment verification must report exact app version and commit; a failed workflow is not a successful release.
