# Install name and iPhone Search

Issue [#112](https://github.com/michaeltorbert/sportsapp/issues/112) asks for the installed app to be findable by typing "scores" (or "sports") in iPhone Search, and whether the app can offer Search keywords beyond its title. The approved install name is **Saturday Signal — Sports Scores & Stats**.

## What the app supplies

The 1.16.2 candidate supplies the approved install name on every page (Scores and the Guide, rendered or packaged) in each field the reviewed sources describe:

| Field | Value |
|---|---|
| Manifest `name` and `short_name` | `Saturday Signal — Sports Scores & Stats` |
| `<meta name="apple-mobile-web-app-title">` | `Saturday Signal — Sports Scores & Stats` |
| `<meta name="application-name">` | `Saturday Signal — Sports Scores & Stats` |
| Document title | `Saturday Signal — Sports Scores & Stats \| College Football Watchlist` |

Everything else about the installation stays as it was: manifest `id`, `start_url` and `scope` are `/` on the same origin, with standalone display, the same colors, icons, `black-translucent` status bar and viewport. The in-app wordmark, layout and alert content still say Saturday Signal. Storage, service worker, alert and subscription code is unchanged. `tests/rendered-html.test.mjs` checks these fields on the built and packaged pages and the compiled manifest.

## Sources and what they establish

- Apple, [Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) (archived): the Home Screen name defaults to the document title, and `apple-mobile-web-app-title` overrides it.
- WebKit, [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): a Home Screen web app is identified by its manifest `id` together with the name the user chose when adding it.
- W3C, [Web Application Manifest](https://www.w3.org/TR/appmanifest/): defines `name` and `short_name`.

None of these say whether an app already on the Home Screen picks up a changed name, how iPhone Search matches an installed web app's name, or how Search treats the document title.

## Extra Search keywords

No extra keywords are added. The reviewed sources describe no field a web app can use to give iPhone Search words beyond its name. Core Spotlight, Apple's indexing API, is a native app framework; the reviewed sources describe no way for a web app to use it, and this app doesn't. The app doesn't add `<meta name="keywords">` or other keyword fields, and nothing here promises that Search uses any text other than what is observed below.

## Simulator observations

Observed on October 16, 2026, on a newly created iPhone 18 Pro Simulator running iOS 27.0, not on a physical iPhone, using local HTTP origins. The tests were run and recorded through the native Simulator interface. The records and screenshots are kept outside the repository, in `output/issue-112-search-20261016/native/` next to the checkout. These results describe that Simulator only. They don't show how every iPhone, iOS version or production install behaves.

**Existing install** (`http://127.0.0.1:4198`; added from 1.16.0 at `d72b941`, then updated to the 1.16.1 candidate at `c8ed38a`):

- With 1.16.0, Add to Home Screen suggested **Saturday Signal**, with Open as Web App on. The icon was installed and opened standalone. Week and Hide finals were then saved through the normal controls.
- After the server switched to 1.16.1, the app's normal Refresh updated it: the footer showed 1.16.1, and Week and Hide finals were still set. (Day was chosen afterwards only to read the footer.)
- The Home Screen label stayed **Saturday Signal**.
- The icon's context menu offered Edit Home Screen, Share Bookmark and Delete Bookmark, with no rename action. Other system screens weren't checked.
- In Safari, the candidate's page title read Saturday Signal Scores. Add to Home Screen from that same origin still suggested **Saturday Signal**. The cause wasn't determined. One possibility is that iOS keeps earlier install metadata for the origin, but that wasn't tested.
- Shortly after installing 1.16.0, Search for "scores" or "Saturday Signal" showed no installed app; no indexing interval was recorded, so those early results were inconclusive. About 14 hours after that install, Search for "signal" listed this app. Search for "scores" listed only the fresh install below, not this one.

**Fresh install** (`http://127.0.0.1:4199`, an origin with no earlier install; 1.16.1 candidate at `49da100`):

- Add to Home Screen suggested **Saturday Signal Scores**, with Open as Web App on. It was added without editing the name, and the Home Screen icon's full accessibility name was Saturday Signal Scores. The original Saturday Signal icon from 4198 stayed in place.
- The icon opened standalone, without Safari controls, with the 1.16.1 footer. The scores feed showed Offline there; this run didn't test the feed, which is covered by separate source and browser checks.
- About a minute after adding and opening it, Search for "scores" showed **Saturday Signal Scores** as an app-icon Top Hit, separate from Safari website results. Tapping it opened the standalone 1.16.1 app.
- Search for "signal" listed both apps, Saturday Signal and Saturday Signal Scores.
- Search for "sports" showed neither app, only Apple Sports in the App Store and web results. "Sports" isn't part of the install name and isn't promised.

**Not tested:**

- Any physical iPhone, the production origin, and push subscriptions or delivery.
- Re-adding at the existing install's origin, renaming the existing install, or carrying its storage over. A second Add to Home Screen at 4198 was considered and declined: it would test a duplicate install, not a safe step for existing users.

No apps were removed, re-added at the same origin or reset, and no subscriptions were changed. The fresh install is a separate test app on its own origin.

## Status

The 1.16.1 observations above are historical evidence for the shorter name only. The longer 1.16.2 candidate name has not yet been checked in the Simulator: its complete Add to Home Screen suggestion, searches for "sports", "scores" and "stats", and tap launch are pending. Physical-iPhone and production-origin behavior are also unverified.

The user authorized the bounded 1.16.2 naming release and accepted that existing installs may keep their old name. No automatic migration, safe rename, or delete-and-re-add step is established; preference and alert carryover after re-adding remains unverified. Issue #112 stays open for the current-install benefit and safe-step questions. The change does not recommend deletion, reinstall, duplicate installation or reset.

## What to tell users

No user step is established. On the Simulator, an app already on the Home Screen kept its old name after updating, so this release by itself may not rename an existing install; whether it does on a real iPhone is unverified. Don't advise removing and re-adding the app, adding a second copy, or resetting anything; the effect of those on saved preferences and alerts is unverified. Update this section only with steps that have been observed to be safe.
