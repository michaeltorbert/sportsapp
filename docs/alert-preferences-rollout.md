# Alert preferences: one-time deployment prerequisite (#54)

This change is local and undeployed. A normal paired release must wait until the following separately authorized cutover is complete. Do not send device tests during this procedure.

## Policy and compatibility

New devices select upset watch only; existing devices retain close-game, upset-watch and final alerts plus their existing ACC reminder and active state. All choices are per subscription, independent of scoreboard tabs. Turning the master off preserves the subscription and choices. The API retains ownership authentication and old kickoff-only PATCH support; new clients send revisions to reject stale edits. All four choices may be off while the master remains on.

Live upset watch includes Q4/intermissions and overtime, with the underdog ahead, tied, or at most eight points behind. A ranked favorite must have a persisted pregame spread of at least seven points; absent a line, confirmed unranked opposition or a rank gap of at least ten qualifies. Pick'em, malformed/conflicting supplied odds, missing rank knowledge, and an unranked favorite do not qualify. Final upset results keep the previous rank-only semantics. Display badges are unchanged.

Exact IDs remain `game:one-score-fourth`, `game:ranked-trailing-fourth`, `game:upset-final`, and `game:acc-kickoff`. A single atomic recipient claim checks both live IDs across every delivery status. Upset watch takes precedence when both new live triggers occur together. A previous close-game attempt cannot escalate into another live attempt; optional finals remain independent. A notification already handed to the push service cannot be recalled.

Enabling a type or reactivating the master creates a pending baseline. The first successful board strictly after activation durably suppresses conditions already true; disabled types are not baselined. Delivery also requires a current qualifying condition, a post-activation event, unchanged recipient revision, active state, and enabled type. Baseline rows and delivery history must never be cleared to replay an event.

## Authorized operator cutover

1. Verify the exact existing Worker, D1 binding, origins, cron, VAPID binding names, deployment versions, and applied migrations. Retain row counts and existing history without exporting credentials. Do not create replacement resources or rotate keys.
2. Apply additive migration `0002_preferences.sql` to the existing database with the established D1 migration mechanism. It copies legacy implicit selections and sets `preferences_delivery_enabled=0`. The old Worker ignores this gate: this step alone does **not** pause old delivery or establish the new guarantee.
3. Deploy the reviewed new alert Worker only, while the gate is zero. Do not expose the new website controls yet. Its `/config` reports `preferences-rollout-paused`. Confirm all routing uses this compatible Worker and retain the exact completion time/version. Old invocations may still be running.
4. Drain old invocations: verify no old deployment can receive traffic, then wait longer than the platform's maximum scheduled invocation lifetime (currently 15 minutes) after full replacement, and verify no old invocation remains. The ten-minute application poll lease is not proof of completion. If routing or drain cannot be proved, leave delivery paused and stop.
5. After that drain, make one atomic operational update setting `preferences_epoch=0`, `next_poll=0`, and `preferences_delivery_enabled=1`. Do not delete any table or history. The first accepted board creates a global no-replay baseline and emits no events. Verify the epoch is now positive, a successful new poll is recorded, and both configured origins report ready with `preferencesVersion: 1`. No real notification test is needed for this gate.
6. Continue the normal paired release with this reviewed version. The release preflight requires that the compatible alert service is ready before it deploys either component. Retain release identity, migration/drain/baseline evidence, and local/browser checks. Real-device receipt remains unverified unless separately authorized and observed.

The deployment workflow intentionally does not apply migrations or unpause delivery automatically. Missing schema fails closed. A paused or unverified cutover is not a successful release. An in-flight compatible poll while the gate changes can at most baseline or queue an event before the next epoch; current-condition and epoch guards still apply, but perform the operational update between polls when possible.

## Failure and rollback

Pause with `preferences_delivery_enabled=0` if the compatible sender needs investigation. Keep every subscription, preference, suppression, event, and delivery row. Roll back the website independently if needed. Do **not** roll the alert Worker back to pre-preference code after activation: it ignores selected types and the pause gate. Use a compatible corrective version instead. No database down-migration, alert-history reset, or automatic resend is supported.

The cutover relies on operator evidence and a bounded old-worker drain, not a distributed claim that old and new code share the new invariant. See [Cloudflare invocation limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
