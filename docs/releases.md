# Cloudflare releases

## Destinations

- Production website: `https://saturday-signal.scythe-wildflower.workers.dev`
- Optional preview website: `https://saturday-signal-preview.scythe-wildflower.workers.dev`
- Existing alert Worker: `https://saturday-signal-alerts.scythe-wildflower.workers.dev`
- Existing Cloudflare account: Scythe Wildflower, `092f7a0a1516725ba2217cfb3760b38f`

Production was verified on September 9, 2026 as version `1.4.4`, commit `97066e910c13ea0d9149e364b3059fd3666d20c1`, with a successful [release workflow](https://github.com/michaeltorbert/sportsapp/actions/runs/34269244404). The first [preview run](https://github.com/michaeltorbert/sportsapp/actions/runs/34234423073) selected the earlier `1.4.2` commit but failed verification after creating `saturday-signal-preview-preview`; the intended preview address remained unavailable. Subsequent preview run results are recorded in [issue #11](https://github.com/michaeltorbert/sportsapp/issues/11). A deployed identity or passing build alone does not establish score coverage or alert readiness. No custom domain, DNS change, new database, or VAPID key rotation is needed.

## One-time GitHub setup

Use separate GitHub environments named `production` and `preview`, each with its own encrypted environment secret named `CLOUDFLARE_API_TOKEN`. Production requires deployment permissions for the website and existing alert Worker, including access to reference its existing D1 binding. Preview needs a dedicated token scoped to the existing account with Workers Scripts Edit (Write) permission only; its configuration has no D1 binding and does not require D1 permissions. This permission is account-scoped, with no documented per-Worker resource restriction, so the token itself does not isolate the preview Worker from either the production website or `saturday-signal-alerts`. The reviewed `main`-only workflow and environment policy narrow its intended use; verify operationally that production remains unchanged after deployment. Do not reuse the production credential. Do not copy a local Wrangler OAuth credential into GitHub. Provision the secret directly through a secure GitHub environment-secret interface; keep its value out of chat, source, issue bodies, PRs, command arguments, logs, and release notes.

The production environment must restrict deployment to explicitly reviewed compatible stable tags after the preferences cutover; a broad `v*` rule permits old paired code and is insufficient. Before cutover, inspect the live rule and record the authorized decision to replace it with the exact frozen compatible release tag; add only reviewed compatible tags for future releases. Verify the effective rule after any authorized change. GitHub environment rules do not block provider-dashboard/manual Worker rollback: that remains subject to the durable prohibition below and operator discipline. If only documentation protection is available, explicitly record accepted residual human-error risk; never claim mechanical enforcement. The release script further requires `vMAJOR.MINOR.PATCH`, a tag matching the package, lockfile and displayed versions, a matching changelog entry, a clean checkout, and a commit already merged into `origin/main`. The preview environment allows only the exact branch `main`; deploy reviewed changes after they have merged there. Both deployment workflows are serialized and never cancel an in-flight deployment.

Publishing a GitHub release with the Codex GitHub App can trigger this workflow. A workflow-created release using only GitHub's default `GITHUB_TOKEN` does not trigger another workflow; use the appropriate GitHub App identity for release creation. Pin the official action commits and review updates through PRs.

## Preview

The `preview` environment allows only the exact branch `main`, so this deployment tests reviewed changes after merge rather than offering a pre-merge branch preview. At 13:33:44 UTC on September 8, 2026, a dedicated account-scoped Workers Scripts Edit token without D1 permission was created and stored as the encrypted preview environment secret `CLOUDFLARE_API_TOKEN`. It expires December 7, 2026; @michaeltorbert owns renewal. The first workflow run deployed an incorrectly suffixed Worker, demonstrating deployment permission but not acceptance at the intended preview destination. Track each run’s acceptance and renewal in [issue #11](https://github.com/michaeltorbert/sportsapp/issues/11), without recording any token value.

Renew before expiry by securely replacing the environment secret, then verify a new preview run. If exposure is suspected, immediately revoke the affected token in Cloudflare, securely provision a replacement with the same reviewed scope, and replace the GitHub environment secret before another dispatch. Do not broaden permissions merely to make a failed run pass; inspect the specific failure first.

For every preview run:

1. Select **main** in **Cloudflare preview → Run workflow** after the intended changes have been reviewed and merged. Record the intended commit and the production website and alert Worker deployment/configuration baseline before dispatch.
2. Retain the run URL and authoritative `head_sha`. Require the run head and preview `/api/health` version/commit to match the intended reviewed source. If `main` advanced during dispatch, stop acceptance and review the actual run commit before deciding whether to dispatch again. A successful run for another commit does not verify the intended commit.
3. Require a successful workflow. It checks out its own run ref, builds/tests that source, deploys only the preview website, and checks the exact commit, page, manifest, service worker, and current scores. There is no separate ref input that bypasses the environment policy.
4. Check daily/ACC/Top 25 switching and score refresh in the deployed browser, plus the manifest, service worker, and referenced app assets. Preview is a public provider address; do not put private data there.
5. Before calling preview verified, compare the retained baseline with production website `/api/health`, production deployment identity, alert Worker deployment identity/configuration, and both allowed-origin `/config` responses. Require unchanged deployment versions and configuration. Readiness timestamps may advance through normal scheduled polling; ordinary production cron activity is not a preview write. Investigate unexplained differences and leave acceptance incomplete.
6. Confirm the preview workflow performed no subscription or delivery mutations. It does not deploy the alert Worker or send notifications. Preserve the exact alert-origin allowlist: preview is not an allowed alert origin, so unavailable alert setup there is expected. Do not subscribe, invoke notification tests, or add wildcard preview origins.

A missing credential, failed workflow, or incomplete acceptance check leaves preview setup incomplete even if a build or deployment step passed.

For a locally authorized preview deployment:

```sh
export CLOUDFLARE_ACCOUNT_ID=092f7a0a1516725ba2217cfb3760b38f
export CLOUDFLARE_ENV=preview
export SOURCE_COMMIT=$(git rev-parse HEAD)
npm test
npm run test:runtime
node scripts/deploy-preview.mjs --dry-run
node scripts/deploy-preview.mjs
DEPLOYMENT_URL=https://saturday-signal-preview.scythe-wildflower.workers.dev VERIFY_ALERTS=false npm run release:verify
```

The preview helper validates both the compiled and Wrangler-resolved Worker names before a dry run or deployment. It clears the build-time `CLOUDFLARE_ENV` selection and explicitly selects the compiled top-level environment, preventing a second `-preview` suffix. Use this helper for preview; the generic production deployment command does not perform these preview checks.

Use an existing authenticated Wrangler session or a securely supplied token. Never deploy a preview build as production: rebuild with `CLOUDFLARE_ENV` unset first.

## Production

Before the first release containing alert preferences, complete the separately authorized [migration, fenced drain and guarded activation](alert-preferences-rollout.md). Freeze the exact final main commit/tree and tag, with all source/browser/updater CI green, before standalone alert deployment. The workflow triggers on release publication/manual dispatch, not tag creation: verify that remains true before tagging, and publish only after cutover acceptance. Maintain an exclusive production-operation window covering all active/queued/manual deployments and rollbacks through final paired verification. The release's read-only preflight blocks an unprepared service; it does not migrate or activate it. Its positive success record is retained as `preferences-preflight.log`; absence of that record stops acceptance.

**Never restore preference-unaware alert code or dispatch an old paired release tag, including before activation.** Record the old provider deployment identifier as never-restore in the cutover evidence. This is a permanent compatibility restriction beyond the maintenance window. Recovery uses a compatible corrective release or a targeted website-only rollback. Inspect actual game schedules and feed freshness before reserving the pause; if the window is missed, remain on compatible paused code and defer. Incident resume requires the same reviewed fence, drain, guarded activation and accepted fresh-baseline procedure; never casually flip the gate.

1. Merge reviewed work only after required checks pass. Require the complete final release source, including version/changelog, to pass all required checks including browser/updater CI on its exact clean final main commit before tagging/deployment.
2. Give every published change a new semantic version in `package.json`, `package-lock.json`, `lib/releases.ts`, and `CHANGELOG.md`. Do not reuse or move existing tags.
3. Create the immutable version tag at that merged commit. For the initial preferences release, complete the standalone compatible alert cutover and accepted baseline before publishing. Publish its stable GitHub release using the Codex GitHub App to trigger one **Release to Cloudflare** paired deployment of the same source. Manual redeployment may target only a verified compatible stable tag allowed by the production environment; never use an old preference-unaware tag. Dispatching on main fails the production tag policy and release validation; there is no separate tag input.
4. The workflow checks the tag, installs locked dependencies, builds/tests the tagged source, and validates both deployment packages. It then deploys the existing alert Worker with both production origins allowed, followed by the website. No migrations are applied and no secrets are replaced.
5. The workflow verifies `/api/health` matches both the package version and exact source commit; checks the home page, manifest, service worker, and current score API; and verifies the alert service reports the same release and is ready from both production origins. It retries transient propagation/feed failures for a bounded period and uploads test and verification logs. Failure is reported as a failed workflow, never as a successful release deployment.
6. Confirm daily/ACC/Top 25 switching and score refreshes in the deployed browser. Reinstall/open the app at the new address and verify one authorized real-device notification before retiring the old installation. CI never sends push messages as a smoke test.

Keep Sites available during the transition. GitHub release notes should distinguish a published source release from a verified deployment until the workflow succeeds. Production already has a deployment history; preserve its environment credential and release process when operating the optional preview environment.

## Score-feed behavior

The browser still reads ESPN directly first. The server first uses the date-specific ESPN API; if Cloudflare receives an error such as the observed HTTP 403, it can use ESPN's CDN feed only when calendar metadata proves coverage of the entire requested Eastern-day range. The CDN ignores date queries. For an overnight week boundary, the fallback explicitly requests the intersecting calendar weeks by season, season type, and week, then validates each returned identity and calendar boundary before joining their events. The combined calendar must be continuous and cover the full range. The shared [`completeCdnRange`](https://github.com/michaeltorbert/sportsapp/blob/1dded72c8bfb87fd53e0a9f2cfd9174bf8988f35/lib/espn-cdn.ts) implementation and its request bound are documented in [PR #45](https://github.com/michaeltorbert/sportsapp/pull/45). Partial boundary days, gaps, mismatched weeks, invalid payloads, and unsupported ranges still fail instead of becoming a successful empty or wrong scoreboard. Dates outside supported CDN coverage still rely on the date-specific API or a recent cached success. Release verification continues to fail when complete score coverage is unavailable; repeated retries cannot establish missing coverage.

## Toolchain and existing alerts

The stable pinned Cloudflare Vite plugin 1.54.4 and Wrangler 4.129.0 both ship Miniflare `5.20260903.0-alpha` as their upstream local runtime dependency. This is an upstream toolchain choice, not a production application dependency override. Locked installation, build, and compiled-runtime checks run on both macOS locally and Node 22/Linux in CI. Update the toolchain together through a tested PR. Builds have a three-minute limit and a ten-second shutdown grace period.

The live alert Worker settings were read again on September 6, 2026. The committed configuration matches its compatibility date, empty compatibility flags, D1 binding, original SITE_ORIGIN and VAPID_SUBJECT, minute cron, and enabled observability. There were no extra plaintext variables, tail consumers, or placement settings. The VAPID keys were confirmed as secret bindings; their values were not read. Account and database IDs are deployment identifiers, not credentials. Recheck live settings before the first deployment if they change independently of GitHub.

The app uses a normal `<img>` for ESPN team logos and local PWA icons; it has no `next/image`, `<Image>`, or `/_vinext/image` consumers. The removed optimizer was unused starter code.

Website and alert code deliberately share one release version and are deployed as a pair. This keeps the reported release and verification straightforward. A failed second deployment is a partial deployment, requires attention, and is covered by the separate rollback instructions below. Do not add conditional alert deployment without also separating its version and verification contract. Deployment commands explicitly require `dist/server/wrangler.json`, so a missing compiled build cannot silently fall back to the source configuration.

## Failure and rollback

A deployment error stops the workflow. A verification error marks the run failed; it does **not** automatically undo a deployment. Read the logs before deciding whether to retry a transient ESPN failure or roll back application code. The current release remains visible on GitHub even if deployment fails.

For a targeted website-only rollback, use the Cloudflare dashboard or `wrangler rollback --name saturday-signal` with a verified compatible prior website version. Never dispatch an old paired tag to accomplish a website rollback. Never restore a preference-unaware alert Worker, including before initial activation; it ignores both preferences and the pause gate. Keep the compatible sender paused during investigation, retain every database/history row and use a compatible corrective release. Resume through the [fenced drain and fresh-baseline procedure](alert-preferences-rollout.md), not a standalone gate flip. Verify provider source identity, bindings, both origins and readiness; a failed second deployment remains partial until reconciled. No database rollback, history deletion or replay is supported. The Sites-only fallback applies to a first-ever website deployment with no prior Worker version, not the current production state.

## References

- [Cloudflare GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare provider addresses](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Worker rollback behavior and limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [GitHub workflow trigger behavior](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)
