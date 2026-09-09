# CDN freshness investigation (#46): no production change

Decision, September 9, 2026: the inspected metadata does not demonstrate a reliable, low-cost event-freshness or event-completeness discriminator. Retain the current fail-closed schema/calendar/range checks and existing feed-readiness behavior. Do not add a Date-age warning, a last-score-change alarm, success-path dual fetches, or per-event summary fanout on this evidence.

## Evidence account

The task coordinator performed these read-only observations; the implementation seat did not execute them and does not claim independent live verification.

- Baseline source: commit `97066e910c13ea0d9149e364b3059fd3666d20c1`, tree `c2634cd682d4ce01c0b34e6145bfe8949d82232d`. Coordinator-run baseline build/tests passed 200/200. This establishes the tested source, not upstream correctness.
- Fresh capture at `2026-09-09T18:01:07.996Z`: `https://cdn.espn.com/core/college-football/scoreboard?xhr=1&group=80`, HTTP 200, 86 events. Decoded response bytes: 1,611,698; decoded-body SHA-256: `d31417b9a54015f20c76e4f07964ddd56167920d5f16a4638859db7b6a1ba3d5`. Wire `Content-Length`: 126445; this is not the decoded-body length. Content-Type: `application/json;charset=utf-8`.
- That capture's Date was `Wed, 09 Sep 2026 18:01:08 GMT`; Cache-Control was `max-age=153`; Age, ETag and Last-Modified were absent. A recursive search of event subtrees found no timestamp-like keys matching `updated?/modified/timestamp/lastUpdate`. This is a bounded key-name inspection, not proof that every possible useful field is absent.
- Earlier `16:54Z` observation: HTTP 200, 86 events, Date and `max-age=185`, no Age/ETag/Last-Modified, no event/competition update-timestamp keys observed. Its raw response and hash were not retained; use the later fingerprint for exact capture identification.
- The existing live CDN browser probe for the September 8–9 range passed Chromium 153 and WebKit 26.6 with an empty valid board. Calendar-range validity and successful empty rendering do not prove event freshness or that every event is present.
- Issue #46 records prior week 1/week 2 captures of 99/86 events matching ESPN date-API IDs. Both sources belong to ESPN, so agreement is not independent completeness proof. No post-boundary-repair stale-game or truncation defect was established.

This repository stores the minimized observation report and fingerprint, not the raw upstream payload. The captured response's HTTP Date describes response generation/cache behavior, not individual score age. A game can legitimately have an unchanged score or clock; a last-change timer alone would produce false positives. Absence of an update field leaves freshness unknown rather than silently making it good or bad.

## Remaining implementation gate

Reopen targeted production work only after a reproducible signal is demonstrated with known source semantics, missing/conflicting-field behavior, genuine stale-versus-legitimate-unchanged examples, false-positive analysis, and measured request/CPU cost coordinated with #38. Opt-in local captures remain a possible investigation method, but no recurring probe or new network request was added here.

The #46 commit is documentation only. Original trigger IDs, subscription ownership, subscription and VAPID data, delivery history, no-resend behavior, score-range validation, source fallback and freshness gates are untouched by this workstream. No real notification was sent. Production deployment, source completeness, and phone receipt are not established by this report.

## Review disposition: local diagnostic allowlist

`scripts/check-alerts-poll.mjs` permits only the date-API scoreboard host/path, while the production poller now tries CDN first. That diagnostic allowlist is stale and can misrepresent a local diagnostic run; it is not evidence of a production feed failure. It is intentionally unchanged in this evidence-only workstream because no reliable production freshness signal was found. A future opt-in diagnostic repair remains follow-up under #46: allow only the exact required CDN/date-API read destinations, retain interception/no-push safeguards, and test its error attribution before relying on the diagnostic. This deferred repair must not be described as a production behavior change or completed investigation capability.
