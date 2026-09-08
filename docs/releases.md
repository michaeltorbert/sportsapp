# Cloudflare releases

## Destinations

- Production website: `https://saturday-signal.scythe-wildflower.workers.dev`
- Optional preview website: `https://saturday-signal-preview.scythe-wildflower.workers.dev`
- Existing alert Worker: `https://saturday-signal-alerts.scythe-wildflower.workers.dev`
- Existing Cloudflare account: Scythe Wildflower, `092f7a0a1516725ba2217cfb3760b38f`

The account subdomain and existing alert Worker were verified through the Cloudflare API on September 6, 2026. Production is live: the September 8, 2026 inspection returned version `1.4.1`, commit `bf523729af1ccdcb9a1aa552992fbdb164403a7c` from `/api/health`. That identity check does not establish score or alert readiness; the score endpoint returned HTTP 502 during the same investigation. At 04:45 UTC the preview address and its `/api/health` returned HTTP 404, so the first preview deployment remains unverified. No custom domain, DNS change, new database, or VAPID key rotation is needed.

## One-time GitHub setup

Use separate GitHub environments named `production` and `preview`, each with its own encrypted environment secret named `CLOUDFLARE_API_TOKEN`. Production requires deployment permissions for the website and existing alert Worker, including access to reference its existing D1 binding. Preview needs only website deployment permissions in the existing account; its configuration has no D1 binding and does not require D1 permissions. Use a dedicated preview token with the narrowest supported account and deployment scope, and do not reuse the production credential. Do not copy a local Wrangler OAuth credential into GitHub. Provision the secret directly through a secure GitHub environment-secret interface; keep its value out of chat, source, issue bodies, PRs, command arguments, logs, and release notes.

The production environment should allow stable release tags (`v*`). The release script further requires `vMAJOR.MINOR.PATCH`, a tag matching the package, lockfile and displayed versions, a matching changelog entry, a clean checkout, and a commit already merged into `origin/main`. The preview environment allows only the exact branch `main`; deploy reviewed changes after they have merged there. Both deployment workflows are serialized and never cancel an in-flight deployment.

Publishing a GitHub release with the Codex GitHub App can trigger this workflow. A workflow-created release using only GitHub's default `GITHUB_TOKEN` does not trigger another workflow; use the appropriate GitHub App identity for release creation. Pin the official action commits and review updates through PRs.

## Preview

On September 8, 2026, the `preview` environment was created and its deployment policy was read back as exactly one allowed branch, `main`. Its environment-secret list was empty. Credential provisioning, expiry, and renewal ownership remain pending; the attempted Cloudflare account-token inventory request was denied with error `9109`, so it provides no evidence of an available suitable token. Track completion in [issue #11](https://github.com/michaeltorbert/sportsapp/issues/11). Before the first dispatch, the credential owner must securely provision the dedicated token and record its expiry date and named renewal responsibility in that issue without recording the token value. Renew it before expiry by securely replacing the environment secret, then verify a new preview run.

Once the credential is configured, run **Cloudflare preview** from GitHub Actions and select **main** in the **Run workflow** branch selector, after the intended changes have been reviewed and merged. Record the selected commit before dispatch and retain the run URL and verified version/commit afterward. The workflow checks out its own run ref; there is no separate ref input that could bypass the environment policy. It builds/tests that source, deploys only the preview website, and checks its exact commit, page, manifest, service worker, and current scores. It never deploys the alert Worker, writes subscription records, or sends notifications. Preview is a public provider address, not a private review link; do not put private data there. After a successful run, check daily/ACC/Top 25 switching and score refresh in the browser, plus the manifest, service worker, and referenced app assets. Compare production health before and after the preview run; record that the alert Worker deployment and configuration were unchanged and that no subscription or delivery mutations were performed. Keep the exact alert-origin allowlist; do not add wildcard preview origins. A missing credential or failed verification leaves the preview setup incomplete, even if the build or deployment step passed.

For a locally authorized preview deployment:

```sh
export CLOUDFLARE_ACCOUNT_ID=092f7a0a1516725ba2217cfb3760b38f
export CLOUDFLARE_ENV=preview
export SOURCE_COMMIT=$(git rev-parse HEAD)
npm test
npm run test:runtime
npm run deploy:check
npm run deploy:app
DEPLOYMENT_URL=https://saturday-signal-preview.scythe-wildflower.workers.dev VERIFY_ALERTS=false npm run release:verify
```

Use an existing authenticated Wrangler session or a securely supplied token. Never deploy a preview build as production: rebuild with `CLOUDFLARE_ENV` unset first.

## Production

1. Merge the reviewed PR after its Tests check passes.
2. Give every published change a new semantic version in `package.json`, `package-lock.json`, `lib/releases.ts`, and `CHANGELOG.md`. Do not reuse or move existing tags.
3. Create the immutable version tag at the merged commit and publish its stable GitHub release using the Codex GitHub App. This triggers **Release to Cloudflare**. To redeploy an existing stable tag manually, dispatch the workflow on that tag as the workflow run ref (for example, through GitHub's workflow-dispatch API with `ref: v1.2.0`). Dispatching on main fails the production tag policy and release validation; there is no separate tag input.
4. The workflow checks the tag, installs locked dependencies, builds/tests the tagged source, and validates both deployment packages. It then deploys the existing alert Worker with both production origins allowed, followed by the website. No migrations are applied and no secrets are replaced.
5. The workflow verifies `/api/health` matches both the package version and exact source commit; checks the home page, manifest, service worker, and current score API; and verifies the alert service reports the same release and is ready from both production origins. It retries transient propagation/feed failures for a bounded period and uploads test and verification logs. Failure is reported as a failed workflow, never as a successful release deployment.
6. Confirm daily/ACC/Top 25 switching and score refreshes in the deployed browser. Reinstall/open the app at the new address and verify one authorized real-device notification before retiring the old installation. CI never sends push messages as a smoke test.

Keep Sites available during the transition. GitHub release notes should distinguish a published source release from a verified deployment until the workflow succeeds. Production already has a deployment history; preserve its environment credential and release process while optional preview setup is completed.

## Score-feed behavior

The browser still reads ESPN directly first. The server first uses the date-specific ESPN API; if Cloudflare receives an error such as the observed HTTP 403, it can use ESPN's CDN feed only when calendar metadata proves coverage of the entire requested Eastern-day range. The CDN ignores date queries. For an overnight week boundary, the fallback explicitly requests the intersecting calendar weeks by season, season type, and week, then validates each returned identity and calendar boundary before joining their events. The combined calendar must be continuous and cover the full range; the bounded fallback accepts at most three intersecting weeks. Partial boundary days, gaps, mismatched weeks, invalid payloads, and unsupported ranges still fail instead of becoming a successful empty or wrong scoreboard. Dates outside supported CDN coverage still rely on the date-specific API or a recent cached success. Release verification continues to fail when complete score coverage is unavailable; repeated retries cannot establish missing coverage.

## Toolchain and existing alerts

The stable pinned Cloudflare Vite plugin 1.54.4 and Wrangler 4.129.0 both ship Miniflare `5.20260903.0-alpha` as their upstream local runtime dependency. This is an upstream toolchain choice, not a production application dependency override. Locked installation, build, and compiled-runtime checks run on both macOS locally and Node 22/Linux in CI. Update the toolchain together through a tested PR. Builds have a three-minute limit and a ten-second shutdown grace period.

The live alert Worker settings were read again on September 6, 2026. The committed configuration matches its compatibility date, empty compatibility flags, D1 binding, original SITE_ORIGIN and VAPID_SUBJECT, minute cron, and enabled observability. There were no extra plaintext variables, tail consumers, or placement settings. The VAPID keys were confirmed as secret bindings; their values were not read. Account and database IDs are deployment identifiers, not credentials. Recheck live settings before the first deployment if they change independently of GitHub.

The app uses a normal `<img>` for ESPN team logos and local PWA icons; it has no `next/image`, `<Image>`, or `/_vinext/image` consumers. The removed optimizer was unused starter code.

Website and alert code deliberately share one release version and are deployed as a pair. This keeps the reported release and verification straightforward. A failed second deployment is a partial deployment, requires attention, and is covered by the separate rollback instructions below. Do not add conditional alert deployment without also separating its version and verification contract. Deployment commands explicitly require `dist/server/wrangler.json`, so a missing compiled build cannot silently fall back to the source configuration.

## Failure and rollback

A deployment error stops the workflow. A verification error marks the run failed; it does **not** automatically undo a deployment. Read the logs before deciding whether to retry a transient ESPN failure or roll back application code. The current release remains visible on GitHub even if deployment fails.

Use the Cloudflare dashboard or `wrangler rollback --name saturday-signal` with a verified prior version. For a release that also changed the alert Worker, assess its rollback separately with `wrangler rollback --name saturday-signal-alerts`; do not roll back its database or delete notification history. Prefer a new corrective release when configuration compatibility is uncertain. On the first Cloudflare website deployment there is no prior website version; the unchanged Sites publication is the fallback.

## References

- [Cloudflare GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare provider addresses](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Worker rollback behavior and limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [GitHub workflow trigger behavior](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)
