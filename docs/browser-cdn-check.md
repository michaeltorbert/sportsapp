# Optional live browser CDN check

After installing repository dependencies and Playwright browsers, run:

```sh
node scripts/check-browser-cdn-live.mjs 2026-09-07 2026-09-08
```

Choose dates covered by ESPN's current calendar; old-season dates may correctly fail this direct-only probe. The example spans the overnight week boundary. Optional `BASE_ORIGIN=https://example.com` checks browser CORS from that origin using an intercepted neutral document, not the site's deployed application or security policy. The default uses a fresh local origin.

The script requires a clean checkout, including nonignored untracked files, before compiling. It bundles the checkout's score client, records its current Git commit, forces primary ESPN failure, permits live CDN requests, blocks hosted-score fallback, and reports Chromium and WebKit results. Every other request is blocked. It sends no subscription or notification requests. A successful result requires nonstale complete-range data, no warnings, no hosted requests and successful CDN CORS responses. It does not prove phone delivery or production app identity.

This check is opt-in and is not included in CI or `npm test`; automated browser tests use simulated feeds. Redirect stdout to a chosen evidence file if desired. Run from a clean checkout for commit-bound evidence.
