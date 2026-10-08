# Shared app panel interaction

User selection, 2026-10-08: Help, Alerts and Settings open equally high. Drag the header to dismiss, scroll the body to read. A short pull returns to the resting position; a deliberate pull closes. Preserve the preferred navy rounded bottom-sheet appearance, upward opening animation and pinned X.

All three use AppPanelContent. Resting top clearance is max(safe-top + 12px, 24px), with vh fallback then dvh. Content length does not change panel height. Horizontal safe-area padding and the 640px centered maximum width remain. The small grip makes the shared drag gesture discoverable.

Only the header owns panel movement. Controls retain normal activation. An unusually tall heading is an independent named, focusable scroll region; dragging its text would prevent reading it, so its text scrolls while the grip remains draggable. The body scrolls normally at every position and never initiates panel dismissal. Local overscroll suppression is intended CSS policy, not a promise about native iPhone behavior. Pinch zoom remains permitted.

Downward header movement follows the pointer; upward or substantially horizontal movement does not dismiss. A release closes after 18% of panel height, bounded to 64–120 CSS pixels, or a recent downward flick exceeding 32px and 0.65px/ms. A smaller stationary pull returns over 180ms. These are initial interaction calibrations. Cancellation, capture loss or viewport change returns without dismissal. Reduced motion removes transitions and slides.

Dismissal uses the existing Radix close path, including focus return and scroll-lock cleanup. X, Escape and backdrop dismissal remain. Fresh opening resets body/heading scroll; resizing preserves reading position within the available scroll range. Preference persistence, alert settings, subscriptions and real delivery are unaffected.

Acceptance requires all three panels at matching portrait/landscape sizes, short/long/changing content, header and body gestures, large-text heading scrolling, interruption/rotation, X hit-testing, keyboard/focus and reduced motion. Browser-engine touch dispatch is not physical-device proof. Final iPhone Safari and Home Screen gesture/safe-area acceptance requires an actual device. Do not infer success from source configuration or browser tests.
