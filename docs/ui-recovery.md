# iOS UI recovery — open acceptance record

The 1.13.4 release did not satisfy the user's reported top-edge defect and changed Help/Alerts in the rejected direction. The 1.13.5 candidate is a bounded recovery attempt, not a confirmed fix. Production remains 1.13.4; no candidate has been released. Tests, simulator pixels and model agreement cannot close the physical-iPhone requirements below.

## Required outcomes

| Requirement | Current status | Required acceptance |
| --- | --- | --- |
| Main top remains crisp at rest, scrolling, pull/release and rotation | UNVERIFIED. Simulator rest frames (portrait cold, landscape, portrait after rotation) are crisp | Original affected installation on a physical iPhone: cold/warm launch, scroll and top return, pull held and released, reopen, portrait and landscape; main checked separately from sheets |
| Settings title and Close remain crisp/reachable | UNVERIFIED. Simulator portrait and landscape top/end frames show a crisp title and X | Physical iPhone, finger scrolling, rotation while open |
| Restore preferred blue rounded Help/Alerts bottom sheets; Settings follows | UNVERIFIED overall. In the source 143 simulator captures, all three reach the bottom of the screen in both orientations, with residual side padding | Compare all three against original user references on a physical iPhone: bottom paint and home-indicator area, stability across warm launch and rotation, landscape padding. "No leftover side border" means no leftover right-drawer treatment. The thin original #344257 border is intended and stays |
| Pinned accessible X, independent body scrolling, focus return and larger text | Met in the browser checks for source 143; native UNVERIFIED | VoiceOver, native larger text, finger and swipe dismissal |
| Display details discoverable near top of Settings | Met in simulator and browser for source 143; physical UNVERIFIED | User finds it on the phone; raw values after real rotation |
| Preserve Duke, alerts/sample, subscriptions, D1/VAPID, updater and Guide | Source and fixtures unchanged; live behavior UNVERIFIED | Live alerts and sample on an allowed origin, updater on device; no reset |

No requirement is waived. No release approval has been issued. Status-bar metadata is the baseline `black-translucent`. Preserve the existing installation; do not prescribe deletion or reinstall without evidence and user direction.

The round 44px Close with a thin border is a planned accessibility change, not the original bare ×. Whether the user accepts it on the phone is an open question; no other Close styling is proposed.

## Evidence for source 143 (historical; superseded by the Safari revision below)

Source 143 is the dirty manifest `143ecd4f…` on HEAD `b34d85f`. Recorded against it:
- 396 unit tests and the typecheck passed. They ran on the preceding manifest `0c5…`, whose application and unit/type inputs are identical; 143 changed only one browser test locator.
- 372 of 372 browser tests passed in Chromium and WebKit.
- 18 native simulator stills of a source-built local server on the existing Home Screen installation, offline feed, keyboard and tool input:
  - main portrait cold, landscape at rest, and portrait after rotating from Guide;
  - Settings portrait collapsed and end, landscape top and end;
  - Display details portrait (62/0/34/0, 440 × 956) and landscape (0/62/20/62, 956 × 440);
  - Help portrait top and end, landscape top (at scroll position zero) and end;
  - Alerts portrait, landscape top and end;
  - Guide portrait and landscape.
- Two independent final reviews accepted the code and the captured-state appearance, with physical and dynamic outcomes unverified, and no production approval. Their verdicts bind source 143 only, not the revision below.

No still shows gesture continuity, warm launch, held pull or a physical device. No home indicator is drawn in the current portrait frames; whether that comes from the simulator, the capture or the app is unknown.

## Diagnostic findings and dispositions

- Safari short-page movement (new; addressed in this revision, not yet re-captured):
  - **Observed with source 143:** in a Safari tab on the empty day with the toolbar visible, a settled drag moved the page up about 40pt and the wordmark slid under the status bar.
  - **Baseline:** production 1.13.4 stayed put after the same drag.
  - **Display details in that tab:** browser mode, insets 0/0/0/0, window and visible area 440 × 796.
  - **Cause:** not isolated, and no document metrics were captured. A `100lvh` minimum taller than the visible tab height is a plausible inference, not proof.
  - **Revision:** the base body rule is `min-height: 100dvh` with no `vh` fallback, so a browser without `dvh` keeps the baseline natural height. The standalone override is `@media (display-mode: standalone) { body { min-height: 100vh; min-height: 100lvh } }`, after the base rule. The manifest already declares standalone, and there is no class, script or metadata change.
  - **What is unproved:** whether wrapping the rule in a media query keeps the standalone bottom paint, because the mechanism is unknown. Playwright runs in browser mode and cannot model Safari's toolbar or the Home Screen rule.
- Real DOM status band replacing the equivalent pseudo-element: rejected as a fix. Same installed simulator app remained blurred across baseline/candidate/baseline cold launches.
- Opaque status-bar metadata (`black`): rejected and reverted to `black-translucent`. The existing simulator installation stayed blurred. A fresh install reported a zero top inset and still showed a soft dark top band, so it is a different inset model, not a cure. No reinstall requirement.
- Inner-scroll root: negative. The existing installation stayed blurred, and the page ended 62pt above the screen bottom in portrait. No inner-scroll architecture change.
- Additive top spacing: a bounded candidate, not a fix. Scores (`.compact-scoreboard`) and portrait Guide (`.guide-shell`) use `max(12px, calc(var(--safe-top) + min(var(--safe-top), 18px)))`: 12px with no inset, 80px at a 62pt inset, against 70px in 1.13.4. The short-landscape Guide rule (`max(var(--safe-top), 4px)`) and generic `.app-shell` rules are unchanged. Browser checks of 0 → 12 and 59 → 77 use simulated insets. The cause of the blur remains a hypothesis.
- Portrait bottom gap (gate OPEN pending physical evidence):
  - **Initial candidate:** in portrait the window was 440 × 894 on a 956pt screen, and the blue sheets stopped about 62pt above the bottom. Settled landscape sheets reached the bottom.
  - **Body minimum height:** a generated diagnostic with only `body { min-height: 100vh; min-height: 100lvh }`, and then source 143, read a 440 × 956 window. In both, the blue reached the bottom of the screen.
  - **Rejected experiments:** a viewport-unit negative offset did not fix it. A passive absolute document band painted to the bottom but changed the window as well, so it isolated nothing; it is not adopted.
  - **Mechanism:** unknown, and not attributed to the system or to app CSS.
  - **Not allowed as fixes:** negative offsets or screen-height values.
  - **Physical:** UNVERIFIED.
- Landscape side padding (fixed in source 143): the centered 640px sheet pads only the part of each side inset it does not already clear, never less than 24px for the body and header left, or 16px for the header right. `--app-panel-max` sets both the width cap and the offset. Browser tests simulate side insets at 956, 700, 640 and 393, including asymmetric cases. The 143 landscape stills show normal padding.
- Focus return without a page jump (fixed in source 143; 372 browser checks passed): Radix's dialog close focused the trigger without `preventScroll`, so a page scrolled to 400 jumped to 0.
  - **Opening:** `AppPanelContent` records the one trigger whose `aria-controls` names the open dialog, never the active element.
  - **Closing:** it runs any caller `onCloseAutoFocus` first and honors `preventDefault`. It then focuses the trigger with `preventScroll`, taking over only if that focus succeeds. Otherwise Radix's own return applies.
  - **Tested:** Close, Escape and backdrop from a scrolled page; a tap open while another control kept focus; a trigger disabled while open.
  - **Code review only:** caller-callback, replaced-trigger and inert-trigger paths.
  - **Native:** focus and VoiceOver are unverified.
- Build identity: the candidate is versioned 1.13.5; the historical 1.13.4 notes are unchanged. The local server's health reported baseline commit `b34d85f` with 1.13.5 bytes, so before any preview the candidate must be committed and built with `SOURCE_COMMIT` set to that commit, and the preview's health must return it.
- Doubled Settings heading fits beside the X, so the test branches on actual overflow. Doubled Help/Alerts must really overflow and stay reachable by keyboard; the reverse-resize check stays.
- Original Close glyph looked small, but original source already supplied a 44px hit area. The defect was whole-sheet scrolling, not proved target size.
- Landscape right drawer and guessed card colour: rejected. The source-authoritative bottom sheet and #121c2a blue are restored.
- “I saw it” appearance suggestion: rejected for this scope. Existing semantic 44px button and explicit accepted-versus-seen flow are preserved.

## Project backlog

- Empty-day background ending at content height: resolved in the source 143 standalone simulator stills, where the background reaches the bottom of the screen. Physical confirmation is pending, and the Safari revision must be re-checked.
- Filled circle on toolbar buttons after closing a sheet: tracked in [#127](https://github.com/michaeltorbert/sportsapp/issues/127). The frames that show it came from tool input, so retained touch hover is unconfirmed. Verify with a real finger on a physical iPhone. No speculative hover CSS.
- Alerts cannot be set up on a preview origin, which is not an allowed alert origin. Do not widen origins or send samples to test them there.

## Native evidence still required for this revision

The exact revised artifact needs its own build, browser and runtime checks, native captures and independent review. Those results will be recorded externally against its fingerprint; the source 143 results above do not carry over.

- Safari tab, portrait and landscape: the short empty-day page at rest, after a settled drag and after returning to the top, with the toolbar shown and hidden. Record mode, viewport and document dimensions where possible. Also: a long page scrolling normally, and opening and dismissing the three sheets from a scrolled page.
- The same existing Home Screen installation: cold and warm main launch; all three sheets in portrait and landscape at top and end, with the blue reaching the bottom; Display details reading standalone and 440 × 956; rotation and back. This confirms the standalone rule still applies after moving into a media query.
- Physical iPhone, original affected installation, UNVERIFIED for every outcome:
  - main cold/warm launch, scroll and top return, pull held and released, reopen and rotation;
  - Settings title and X;
  - each sheet's bottom paint and home-indicator area;
  - finger and swipe dismissal with no page jump;
  - VoiceOver focus on Close and back to the trigger, and native larger text;
  - Display details after real rotation;
  - the #127 finger tap, and the user's view of the round X.
- Live alert, sample and subscription behavior. Offline stills and fixtures do not cover these.

Simulator evidence must be labeled as simulator evidence. Reviewers must inspect current pixels themselves; supply alone is not acceptance.
