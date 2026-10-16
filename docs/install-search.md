# Install name and iPhone Search

Issue [#112](https://github.com/michaeltorbert/sportsapp/issues/112) asks for the installed app to be findable by typing "scores" (or "sports") in iPhone Search, and whether the app can offer Search keywords beyond its title. The user approved the install name **Saturday Signal Scores**.

## What the app supplies

From 1.16.1, every page (Scores and the Guide, rendered or packaged) carries the same install name in each field the reviewed sources describe:

| Field | Value |
|---|---|
| Manifest `name` and `short_name` | `Saturday Signal Scores` |
| `<meta name="apple-mobile-web-app-title">` | `Saturday Signal Scores` |
| `<meta name="application-name">` | `Saturday Signal Scores` |
| Document title | `Saturday Signal Scores \| College Football Watchlist` |

Everything else about the installation stays as it was: manifest `id`, `start_url` and `scope` are `/` on the same origin, with standalone display, the same colors, icons, `black-translucent` status bar and viewport. The in-app wordmark, layout and alert content still say Saturday Signal. Storage, service worker, alert and subscription code is unchanged. `tests/rendered-html.test.mjs` checks these fields on the built and packaged pages and the compiled manifest.

## Sources and what they establish

- Apple, [Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) (archived): the Home Screen name defaults to the document title, and `apple-mobile-web-app-title` overrides it.
- WebKit, [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): a Home Screen web app is identified by its manifest `id` together with the name the user chose when adding it.
- W3C, [Web Application Manifest](https://www.w3.org/TR/appmanifest/): defines `name` and `short_name`.

None of these say whether an app already on the Home Screen picks up a changed name, how iPhone Search matches an installed web app's name, or how Search treats the document title.

## Extra Search keywords

No extra keywords are added. The reviewed sources describe no field a web app can use to give iPhone Search words beyond its name. Core Spotlight, Apple's indexing API, is a native app framework; the reviewed sources describe no way for a web app to use it, and this app doesn't. The app doesn't add `<meta name="keywords">` or other keyword fields, and nothing here promises that Search uses any text other than what is observed below.

## iPhone observations

Pending. Nothing has been confirmed on an iPhone or in the iOS Simulator yet. To be recorded here, each with its environment (device, iOS version, origin, build) and the time allowed for Search to update:

- new install: the name suggested when adding, the name kept, how it appears on the Home Screen, and Search results for "scores", "signal" and, separately, "sports";
- an install made from the previous build at the same origin, after the update: its name, the same Search terms, and whether its saved preferences remain.

A Search result with little time to update is inconclusive. A Simulator result applies to that Simulator only; it doesn't establish behavior on a particular iPhone or its existing install.

## What to tell users

No user step is established yet. Don't advise removing and re-adding the app, adding a second copy, or resetting anything; the effect of re-adding on saved preferences and alerts is unverified. Update this section only with steps that have been observed to be safe.
