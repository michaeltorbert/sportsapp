# Saturday Signal

College-football scores, weekly ACC and Top 25 views, and optional Web Push alerts.

The migration in this branch targets **Cloudflare Workers**, using the free provider address `https://saturday-signal.scythe-wildflower.workers.dev`. A purchased domain is not required. GitHub is the source of truth for issues, reviews, tests, tags, and releases.

The previous Sites publication remains at `https://saturday-signal.mtorbert.chatgpt.site` until the Cloudflare release is verified. This branch does not deploy or disable either site by itself.

## Development and checks

Use Node.js 22.13 or newer. CI uses Node 22.

```sh
npm ci
npm run typecheck
npm run dev
export SOURCE_COMMIT=$(git rev-parse HEAD)
npm test
npm run test:runtime
npm run deploy:check
npm run deploy:alerts -- --dry-run
```

`npm test` builds the app and runs the regression suite. `npm run test:runtime` then starts the compiled Worker locally and checks routing, assets, and build identity without requesting live scores. Deployment dry runs validate the actual compiled website and the alert Worker without publishing or accessing the production database. The default development server is at `http://localhost:5173`.

`wrangler.jsonc` owns website configuration. The Cloudflare Vite plugin emits the deployable Worker, static assets, and a generated Wrangler configuration in `dist/server/wrangler.json`; deployment commands explicitly require that compiled configuration. Always rebuild after changing environment or source. The website has no database binding. Alerts retain their existing separate Worker and D1 database.

The existing repository-wide ESLint backlog is tracked in [issue #1](https://github.com/michaeltorbert/sportsapp/issues/1). The new CI checks run the build, tests, and deployment validation; they do not claim that the unrelated lint backlog is fixed.

`npm ci` generates ignored Worker declarations using the pinned Wrangler version and the website's compatibility date, flags, and bindings. `npm run typecheck` regenerates them before checking TypeScript, so configuration changes are reflected immediately. If installation scripts were disabled, run `npm run types:generate` before invoking TypeScript directly. The optional D1 example keeps its binding type local; it does not declare a production website database.

CI intentionally runs typechecking before the build to catch errors in checked-in source and generated Worker bindings early; build, runtime, and browser checks follow. The generated `Cloudflare.Env` describes the website's `wrangler.jsonc`. The separate alerts Worker retains its own `Env` type.

## Deployment

See [the release guide](docs/releases.md) for GitHub environment setup, preview validation, production releases, verification, and rollback. GitHub Actions run tests on PRs. Production deployment is triggered by publishing a stable GitHub release, not by merging a PR.

The application reports its version and exact built source commit at `/api/health`. The release workflow checks both after deployment, checks static assets and the score API, and checks alert readiness from the old and new production addresses.

## Alerts and address changes

The existing alert service remains `https://saturday-signal-alerts.scythe-wildflower.workers.dev`. Its versioned [configuration](services/alerts/wrangler.jsonc) reuses the current database and cron. Existing VAPID secrets and notification history must be preserved. See [alert-service details](services/alerts/README.md).

The old and new production addresses are explicitly allowed during migration. Arbitrary Workers subdomains and preview addresses are not allowed. The preview website therefore validates scores and page behavior without enrolling devices in the production alert service.

Browser settings and push subscriptions belong to the site address. Users moving to the Cloudflare address need to reopen or install that app and enable notifications there; existing subscriptions cannot be silently transferred. Disable alerts in the old installation before enabling the new one to avoid receiving notifications from both installations. Actual phone delivery must be verified on a device after the cutover.
