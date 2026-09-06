# Cloudflare releases

## Destinations

- Production website: `https://saturday-signal.scythe-wildflower.workers.dev`
- Optional preview website: `https://saturday-signal-preview.scythe-wildflower.workers.dev`
- Existing alert Worker: `https://saturday-signal-alerts.scythe-wildflower.workers.dev`
- Existing Cloudflare account: Scythe Wildflower, `092f7a0a1516725ba2217cfb3760b38f`

The account subdomain and existing alert Worker were verified through the Cloudflare API on September 6, 2026. The website names are prepared targets; they are not live until deployed. No custom domain, DNS change, new database, or VAPID key rotation is needed.

## One-time GitHub setup

Create GitHub environments named `production` and `preview`. Add an environment secret named `CLOUDFLARE_API_TOKEN` to each environment you intend to deploy. Use a Cloudflare deployment token scoped to the existing account, with Worker deployment permissions and access to reference the existing D1 binding. Do not copy a local Wrangler OAuth credential into GitHub. Keep tokens out of source, issue bodies, PRs, and release notes.

The production environment should allow stable release tags (`v*`). The release script further requires `vMAJOR.MINOR.PATCH`, a tag matching the package, lockfile and displayed versions, a matching changelog entry, a clean checkout, and a commit already merged into `origin/main`. The preview environment should allow only trusted branches selected for testing. Both deployment workflows are serialized and never cancel an in-flight deployment.

Publishing a GitHub release with the Codex GitHub App can trigger this workflow. A workflow-created release using only GitHub's default `GITHUB_TOKEN` does not trigger another workflow; use the appropriate GitHub App identity for release creation. Pin the official action commits and review updates through PRs.

## Preview

After the workflow exists on main, run **Cloudflare preview** from GitHub Actions and choose the reviewed branch or commit. It builds/tests that source, deploys only the preview website, and checks its exact commit, page, manifest, service worker, and current scores. It never deploys the alert Worker, writes subscription records, or sends notifications. Preview is a public provider address, not a private review link; do not put private data there.

For a locally authorized preview deployment:

```sh
export CLOUDFLARE_ACCOUNT_ID=092f7a0a1516725ba2217cfb3760b38f
export CLOUDFLARE_ENV=preview
export SOURCE_COMMIT=$(git rev-parse HEAD)
npm test
npm run deploy:check
npm run deploy:app
DEPLOYMENT_URL=https://saturday-signal-preview.scythe-wildflower.workers.dev VERIFY_ALERTS=false npm run release:verify
```

Use an existing authenticated Wrangler session or a securely supplied token. Never deploy a preview build as production: rebuild with `CLOUDFLARE_ENV` unset first.

## Production

1. Merge the reviewed PR after its Tests check passes.
2. Give every published change a new semantic version in `package.json`, `package-lock.json`, `lib/releases.ts`, and `CHANGELOG.md`. Do not reuse or move existing tags.
3. Create the immutable version tag at the merged commit and publish its stable GitHub release using the Codex GitHub App. This triggers **Release to Cloudflare**. An existing stable tag can be redeployed through that workflow's manual `tag` input; the same validation applies.
4. The workflow checks the tag, installs locked dependencies, builds/tests the tagged source, and validates both deployment packages. It then deploys the existing alert Worker with both production origins allowed, followed by the website. No migrations are applied and no secrets are replaced.
5. The workflow verifies `/api/health` matches both the package version and exact source commit; checks the home page, manifest, service worker, and current score API; and verifies the alert service reports the same release and is ready from both production origins. It retries transient propagation/feed failures for a bounded period and uploads test and verification logs. Failure is reported as a failed workflow, never as a successful release deployment.
6. Confirm daily/ACC/Top 25 switching and score refreshes in the deployed browser. Reinstall/open the app at the new address and verify one authorized real-device notification before retiring the old installation. CI never sends push messages as a smoke test.

Keep Sites available during the transition. GitHub release notes should distinguish a published source release from a verified deployment until the workflow succeeds. The first production run needs the environment secret; this PR does not configure credentials or publish the migration.

## Score-feed behavior

The browser still reads ESPN directly first. The server first uses the date-specific ESPN API; if Cloudflare receives an error such as the observed HTTP 403, it can use ESPN's CDN feed only when that feed's calendar proves coverage of the entire requested Eastern-day range. The CDN ignores date queries. Unknown weeks and partial boundary days are rejected instead of silently returning an empty/wrong scoreboard. Dates outside the current CDN week still rely on the date-specific API or a recent cached success.

## Failure and rollback

A deployment error stops the workflow. A verification error marks the run failed; it does **not** automatically undo a deployment. Read the logs before deciding whether to retry a transient ESPN failure or roll back application code. The current release remains visible on GitHub even if deployment fails.

Use the Cloudflare dashboard or `wrangler rollback --name saturday-signal` with a verified prior version. For a release that also changed the alert Worker, assess its rollback separately with `wrangler rollback --name saturday-signal-alerts`; do not roll back its database or delete notification history. Prefer a new corrective release when configuration compatibility is uncertain. On the first Cloudflare website deployment there is no prior website version; the unchanged Sites publication is the fallback.

## References

- [Cloudflare GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare provider addresses](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Worker rollback behavior and limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [GitHub workflow trigger behavior](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)
