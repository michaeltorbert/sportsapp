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

## Simulator observations

Observed on October 16, 2026, on a newly created iPhone 18 Pro Simulator running iOS 27.0, not on a physical iPhone. Both builds were served from the same local origin, `http://127.0.0.1:4198`: first 1.16.0 (`d72b941`), then the 1.16.1 candidate (`c8ed38a`). Screenshots are kept outside the repository, in `output/issue-112-search-20261016/native/` next to the checkout. These results describe that Simulator only. They don't show how every iPhone, iOS version or production install behaves.

**Existing install (added from 1.16.0, then updated to 1.16.1):**

- With 1.16.0, Add to Home Screen suggested **Saturday Signal**, with Open as Web App on. The icon was installed and opened standalone. Week and Hide finals were then saved through the normal controls.
- After the server switched to 1.16.1, the app's normal Refresh updated it: the footer showed 1.16.1, and Week and Hide finals were still set. (Day was chosen afterwards only to read the footer.)
- The Home Screen label stayed **Saturday Signal**.
- The icon's context menu offered Edit Home Screen, Share Bookmark and Delete Bookmark, with no rename action. Other system screens weren't checked.
- In Safari, the candidate's page title read Saturday Signal Scores. Add to Home Screen from that same origin still suggested **Saturday Signal**. The cause wasn't determined. One possibility is that iOS keeps earlier install metadata for the origin, but that wasn't tested.

**Search:** with the 1.16.0 install, searching "scores" or "Saturday Signal" showed no installed web app result. The full "Saturday Signal" search showed only a Safari visited page as Top Hit. As a control, Search did show native apps. No established indexing interval was recorded, and the origin was an isolated local address, so these negative results are inconclusive. They don't show how Search treats installed web apps in general. Search wasn't repeated after the 1.16.1 update.

**Not exercised (unverified):**

- A fresh install of 1.16.1 from an origin with no earlier install: the suggested name, how it looks on the Home Screen, and Search for "scores", "signal" and "sports". The candidate was healthy on a second origin, `http://127.0.0.1:4199`, but the native steps couldn't be run because the Mac was locked. This was a test limitation, not a product failure.
- Search after an indexing wait, on any build.
- Any physical iPhone, the production origin, and push subscriptions or delivery.

No apps were removed, re-added or duplicated, and no storage was reset.

## What to tell users

No user step is established yet. In the Simulator, an existing install kept its old label after updating, so this release by itself may not rename an app already on someone's Home Screen; whether it does on a real iPhone is unverified. Don't advise removing and re-adding the app, adding a second copy, or resetting anything; the effect of re-adding on saved preferences and alerts is unverified. Update this section only with steps that have been observed to be safe.
