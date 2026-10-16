# Install name and iPhone Search

Issue [#112](https://github.com/michaeltorbert/sportsapp/issues/112) asks for the installed app to be findable by typing "scores" (or "sports") in iPhone Search, and whether the app can offer Search keywords beyond its title. The approved install name is **Saturday Signal — Sports Scores & Stats**. This issue remains open for existing-install behavior and physical-iPhone confirmation.

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

## Historical 1.16.1 Simulator observations

Observed on October 16, 2026, on a newly created iPhone 18 Pro Simulator running iOS 27.0, not on a physical iPhone, using local HTTP origins. The tests were run and recorded through the native Simulator interface. The records and screenshots are kept in the workspace output directory outside the checkout, at `output/issue-112-search-20261016/native/`. These results describe that Simulator only. They don't show how every iPhone, iOS version or production install behaves.

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

## 1.16.2 candidate Simulator observations

The exact candidate commit `ebb8620129929ba0a3ad9cb7ddef10c0970a576f` was served from a fresh local origin (`http://127.0.0.1:4200`) on October 16, 2026, in the dedicated iPhone 18 Pro Simulator running iOS 27.0. Through native Safari, Add to Home Screen suggested the complete **Saturday Signal — Sports Scores & Stats** name with Open as Web App on. It was added without editing the name, and the installed Home Screen item's accessibility name matched the full name; the icon label itself was visually shortened by iOS.

Native Search showed the installed app for each of **sports**, **scores**, and **stats**, as an app result distinct from website and App Store results. For each search, tapping the result opened the full-name app in standalone mode with version 1.16.2 visible and the existing in-app brand and layout. The `scores` search displayed the new app alongside the earlier **Saturday Signal Scores** app. The native screenshots and observation record are stored outside the repository in `output/issue-112-keywords-20261016/native/`.

The first Home Screen launch also produced a white standalone screen. The local server returned the expected candidate successfully, and subsequent launches from all three Search results worked on the same unchanged candidate. The cause of the first-launch failure is unknown; the later successes do not explain or erase it.

This is Simulator evidence for a fresh local-origin install. It does not establish behavior on a physical iPhone or production origin, automatic renaming of an existing install, or preference and alert carryover after deleting and re-adding an app. No existing app was removed or re-added, and no push or subscription operation was performed.

## Status

The 1.16.2 candidate's exact Add suggestion, installed accessibility name, Search results for all three terms, and standalone launches were observed on the Simulator above. Physical-iPhone and production-origin behavior remain unverified. The unexplained white first Home Screen launch remains an observed failure with unknown cause.

The user authorized the bounded 1.16.2 naming release and accepted that existing installs may keep their old name. No automatic migration, safe rename, or delete-and-re-add step is established; preference and alert carryover after re-adding remains unverified. Issue #112 stays open for the current-install benefit and safe-step questions. The change does not recommend deletion, reinstall, duplicate installation or reset.

## What to tell users

On the Simulator, a fresh install used the full new name and Search found it with "sports", "scores" and "stats". An existing app kept its old name after the earlier 1.16.1 update, so an update may not rename an existing install; behavior on a physical iPhone is unverified. No safe delete-and-re-add step is established, and preference or alert carryover after re-adding has not been tested. Do not remove or reset an existing app to change its name.
