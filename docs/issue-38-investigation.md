# Issue #38: homepage resource-limit investigation

Investigation date: September 8, 2026 (UTC). Repository artifact inspected:
`bf523729af1ccdcb9a1aa552992fbdb164403a7c`.
[Issue #38](https://github.com/michaeltorbert/sportsapp/issues/38) supplies the original browser observation at **2026-09-08 02:53 UTC** and identifies its deployed source as v1.3.4, commit `3b7616760e7ff6b589c4769a1769d16c6fbdf250`.

## Confirmed historical failure

Read-only Cloudflare Workers Observability queries against `saturday-signal` confirmed CPU exhaustion, rather than an inferred cause from the browser's generic resource-limit page:

| UTC timestamp | Path | HTTP | Outcome | CPU / wall milliseconds | Request ID |
| --- | --- | --- | --- | --- | --- |
| 2026-09-08 02:53:53.891 | `/` | 503 | `exceededCpu` | 10 / 11 | `648b66125be0b67bb34c2725a99608a7` |
| 2026-09-08 02:54:01.719 | `/api/health` | 200 | `ok` | 2 / 2 | `90d7da61a6bbc31196c376a24fd0f2ca` |
| 2026-09-08 02:54:07.670 | `/` | 200 | `ok` | 11 / 11 | `e8a7e61e0019c94c8e60eacf19c52168` |

All three invocation records identify Worker version `120c170c-f6d4-4d54-b426-49958397b6eb`; its version API reports creation at `2026-09-08T00:14:09.702192Z`. The version-to-source attribution above comes from the issue, not a source-commit field in these logs.

The bounded 02:50–02:56 query returned 114 event rows, including 66 invocation rows: 47 score requests with HTTP 503 / `exceededCpu`, 14 score requests with HTTP 200 / `ok`, the two homepage requests above, one health request, one successful `/.rsc` request, and one ordinary favicon 404. This is more than an isolated homepage symptom. It does not establish a population recurrence rate or prove which computation consumed the CPU budget.

Query method: `POST /accounts/{account_id}/workers/observability/telemetry/query`, with `dry: true`, inline parameters filtering `$metadata.service = saturday-signal`, `view: events`, `limit: 2000`, and the stated UTC millisecond timeframe. Counts describe returned invocation records, not an account-wide request census. No query or Worker configuration was saved. Client addresses, location, headers, and unrelated account data are omitted from this evidence.

## Current bounded reproduction

At 04:44:24 UTC, `/api/health` returned HTTP 200 with version `1.4.1` and exact commit `bf523729af1ccdcb9a1aa552992fbdb164403a7c`. Twelve sequential homepage requests using curl and `Cache-Control: no-cache` at 04:44:39–04:44:44 UTC all returned HTTP 200 and 23,309 bytes, taking 73–161 ms end to end. This did not reproduce the resource-limit response. An earlier Python urllib attempt returned 403 for the health endpoint and all twelve homepage requests; the curl comparison succeeded. Those client-dependent 403s are not evidence of Worker CPU exhaustion.

A subsequent read-only 04:30–04:45 query returned 504 event rows including 264 invocation records: 15 homepage HTTP 200 / `ok`, eight health HTTP 200 / `ok`, and 241 score HTTP 502 / `ok`. No returned invocation had `exceededCpu`. The score error records report `score_feed_failed` with `CDN does not cover the requested dates`; this is the feed-coverage symptom tracked in #41. Here `ok` means the invocation completed without runtime termination, not that score delivery succeeded. CPU termination and handled HTTP 502 are different observed failure mechanisms; whether a shared feed/fallback processing path contributes to both has not been tested. The existing records retain the terminal fallback failure, not the primary upstream response status.

The 15 homepage invocation records report CPU milliseconds of **8 minimum, 11 median, and 76 maximum**, all on Worker version `33b3476b-bca0-4e4f-8528-c4cdae318225`. These measured successes do not establish CPU headroom because the effective budget is unverified and occasional overruns can be allowed. The twelve invocation timestamps at 04:44:39.610–04:44:44.135 UTC corroborate that the curl sample reached Worker rendering.

The short sequential request sample exercises live rendering, but does not force a fresh isolate or reproduce historical concurrency and cache state. Neither this sample nor current success proves the intermittent issue is fixed. No load test or production redeployment was used to manufacture cold starts.

## Settings and limits

Live settings read at approximately 04:43–04:46 UTC show persisted invocation logs enabled with sampling rate 1, traces disabled, Logpush disabled, and no tail consumers. The website settings and committed Wrangler configuration expose no explicit `limits` override. Account settings report `default_usage_model: standard`; that field alone does not establish the billing plan or effective CPU entitlement. The account subscription API rejected the read with Cloudflare error 10000 (`Authentication error`), so billing entitlement could not be independently verified.

[Cloudflare's current CPU-limit documentation](https://developers.cloudflare.com/workers/platform/limits/) associates `exceededCpu` with CPU termination and describes a 10 ms Free-plan HTTP budget and runtime flexibility for occasional overruns. This makes a constrained CPU budget a plausible explanation for the observed 10 ms failures, but does not prove this account's plan. Successful requests above 10 ms do not by themselves disprove a constrained budget. Waiting for upstream network responses is not CPU time.

## Disposition and remaining work

A homepage CPU termination is confirmed within the original issue's reported 02:53 UTC minute, corroborating that observation; the issue remains the source of its v1.3.4 commit attribution. Cold rendering, the exact hot function, effective entitlement, and recurrence rate remain unproven. There is no evidence connecting the updater to this server invocation failure. No targeted application code change or regression assertion is justified by the available evidence alone.

Keep #38 open as an operational investigation: an account owner or credential with billing-read access should confirm the effective Workers plan and CPU budget. If constrained, assess a suitable entitlement/budget before changing it; do not silently upgrade billing. If recurrence persists, correlate request/version IDs and capture a representative CPU profile before optimizing either path. Include score-feed and fallback processing alongside homepage rendering in that profile: the historical sample contains 47 score CPU terminations. These counts do not imply a 47-times failure rate or establish the hotter function. A specific limit adjustment or code optimization requires that evidence and separate verification. Existing persisted logs already provide the needed first diagnostic surface; no speculative observability configuration change was made.

This work changed documentation only. It did not deploy, change billing or Worker settings, access secret values, mutate subscriptions or delivery records, or send notifications. Unit/runtime deployment tests are not applicable to this evidence-only change; verification consisted of the API queries, bounded HTTP requests, repository inspection, and `git diff --check`.
