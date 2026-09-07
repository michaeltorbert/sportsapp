# Browser regressions

One Playwright suite exercises the real compiled application in mobile-emulated
Chromium and WebKit (390 × 664 CSS pixels, touch enabled, iPhone 13 descriptor).
This is desktop browser/engine coverage, not actual Safari/iOS or phone delivery.

```sh
npm ci --no-audit --no-fund
npx playwright install chromium webkit
export SOURCE_COMMIT=$(git rev-parse HEAD)
npm run build
npm run test:browser
```

Linux runners install required libraries with `npx playwright install --with-deps
chromium webkit`. The existing Tests workflow runs both engines against its
production build, before rebuilding for preview. Missing engines fail explicitly;
for a deliberately partial local check use `npm run test:browser --
--project=chromium-mobile` and report WebKit as untested. `BROWSER_TEST_PORT` can
override the default local port 4178. No hosted deployment is required.

The suite covers touch navigation and layout, independent daily/weekly counts,
manual date navigation, Hide finals persistence, failed refresh retention and
recovery, a fresh open after Eastern midnight, automatic polling rollover, and
manual date selection during rollover. Alert scenarios cover readiness, service
unavailability and recovery, permission denial, an existing active subscription,
lost management credentials with reset/re-enable, and browser installation help.

All ESPN/alert HTTP responses are deterministic fixtures. Permission, push,
service-worker registration and standalone mode are explicitly simulated, with
service workers blocked and every unexpected external page request aborted and
failed. Tests neither send push messages nor use real subscription credentials.
The actual service-worker script and push sender have separate Node tests.

`output/playwright/` contains the JSON/HTML reports, per-test evidence with local
build version/source commit, engine version, user agent, viewport, simulated
request history, layout screenshots, and failure traces/screenshots. The tests
assert `/api/health` matches the expected source and package version, so stale
builds fail. Commit source changes before collecting final release evidence;
if testing an uncommitted artifact, preserve its diff separately with results.
CI uploads this directory with the existing test evidence artifact.
