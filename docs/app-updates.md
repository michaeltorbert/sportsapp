# App updates

Refresh scores fetches current games. The app update notice offers an explicit
Refresh app action after two health responses identify the same different full
commit at least ten seconds apart. Checks run shortly after opening, every five
minutes while visible and online, and when returning or reconnecting. Help's
Check for app update uses the same checker and can redisplay a dismissed build.
Later dismisses that commit for this tab session. Failed checks do not mean the
app is current. Refresh app verifies again before replacing the current document.

Refresh preserves the actual category, manual date or Follow Today choice, Hide
finals and notification-focused game. Temporary URL fields are captured during
hydration and removed. Notification focus is restored without replaying its
scroll or filter changes. Existing scoreboard and alert storage, service workers,
push subscriptions and caches are not reset.

The identity is the full SOURCE_COMMIT compiled into the client bundle, not the
first health response. Different commits include same-version releases and
rollbacks; rebuilding identical source identity cannot be detected. Development
or malformed identities disable checks. Users on builds predating this feature
must reopen or manually refresh once. No timer automatically reloads a page.

## Repeatable local verification

Run `npm ci`, then build with `SOURCE_COMMIT=$(git rev-parse HEAD) npm test` and
`npm run test:browser`. Run `npm run test:updater` for the dedicated two-build
integration gate; CI runs it after the ordinary browser suite. Install Chromium
and WebKit using the existing Playwright installation first.

The integration gate snapshots source with a per-file SHA-256 manifest, reuses
the root locked dependency installation, builds synthetic commits A and B into
separate temporary outputs, starts two local Workers and switches all application
requests through one loopback proxy. It checks the hydrated bundle identity,
explicit replacement, rollback, failed verification, and fresh health with a
stale document. It records document Cache-Control as observed (including null
when absent), rather than assuming no-store. It removes temporary outputs and
processes in finally cleanup. Evidence is written to
`output/playwright/updater-two-build.json`.

Scores and alert configuration are simulated and real service workers blocked.
These checks establish browser regression behavior, not real notification
receipt or installed iPhone behavior. A manual installed-iPhone resume/update
check remains separate. Two agreeing observations reduce rollout noise but do
not prove global edge consistency; a stale document remains usable and can
present another explicit retry without a reload loop.

If the browser cancels an explicit replacement and leaves the working document
open, its refresh controls recover after 15 seconds with a retry message. This
recovery never navigates; the user must choose Refresh app again. Controls use
aria-disabled during verification so keyboard focus stays in place on failure.
Background checks remain quiet until an update is confirmed or a shown notice
is cleared. Help reports the outcome of an explicit check, and a later failed
background check clears any obsolete current-status claim.
