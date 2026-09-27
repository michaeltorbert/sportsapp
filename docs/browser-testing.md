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

Linux runners install the required engine with `npx playwright install --with-deps`.
The Tests workflow runs Chromium and WebKit as separate matrix jobs on independent
runners. Each engine gets a fresh dependency install, production build, local Worker,
and browser process, so an engine or local Worker failure cannot inherit resources
from the other engine. WebKit is split into four shards. A final `test` gate
requires the core job and every browser shard. Each browser job retains its
report, `.wrangler/logs/`, and `output/playwright/server/` diagnostics. The
two-build updater check also runs on its own clean runner with both
engines installed, and the final gate requires it alongside core and the browser
matrix. Missing engines fail explicitly;
for a deliberately partial local check use `npm run test:browser --
--project=chromium-mobile` and report WebKit as untested. `BROWSER_TEST_PORT` can
override the default local port 4178. No hosted deployment is required.

The suite covers touch navigation and layout, category toggles with the All
reset, the Day/Week period control with period-relative counts, legacy `tab=`
and explicit `cats=`/`period=` links,
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

The browser harness supervises local Wrangler and records timestamped stdout and
stderr, periodic runner and server resources, and the first error-like line in
`output/playwright/server/`. An error line is evidence, not proof the server has
exited. On an unexpected server exit, the harness saves the actual code or signal,
prints the first exit to the test log, and interrupts the remaining browser
tests. If no Wrangler exit has been recorded but the existing fixture's direct
health request fails, the fixture records that first failure and stops the shard as
well. A test dispatched during the short observation window fails at fixture
setup before its body runs. Browser crash/disconnect events capture an immediate
resource snapshot. Normal Playwright teardown is marked separately. Use
`npm run test:browser` for this stop behavior; a bare `npx playwright test`
does not set `BROWSER_TEST_STOP_ON_SERVER_EXIT=1`.

CI's browser artifact name includes the tested commit, run ID, attempt, and PR
head SHA. Playwright metadata and the job summary also distinguish the tested
merge commit from the PR head. The always-run runner snapshot includes memory,
process, and kernel output where available. These diagnostics can help classify
a future WebKit failure; they do not establish the cause of earlier exits.
The supervisor detects the Wrangler process exit; a workerd-only exit is caught
when it makes the fixture health request fail. A still-responsive Wrangler
process with a failing application request needs its own test failure and
artifact analysis. Issue #94 remains open until a future instrumented failure
supports a cause classification.
