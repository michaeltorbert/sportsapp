# Home Screen Install (vendored)

`src/vendor/home-screen-install/` holds a vendored copy of the ES module from
[michaeltorbert/home-screen-install](https://github.com/michaeltorbert/home-screen-install).

Saturday Signal mounts the pinned shared `mount()` UI through
`components/home-screen-install.tsx`, once after the page in the root layout.
The quiet footer action is available on Scores, Guide, game and team views,
outside the existing modal panels and hidden score view. Help's old unconditional
installation tip is replaced by this action; Alerts retains its contextual
installation prerequisite guidance.

The shared component alone decides visibility from the current window:
`navigator.standalone === true` or `(display-mode: standalone)` hides it.
Stored preferences, an existing Home Screen icon, referrer and generic fullscreen
do not hide it. Its manual guide explains Safari Share → Add to Home Screen;
it does not install anything or request notification permission. The wrapper
mounts on the client and destroys its guide and listeners on unmount. A hidden
host adds no footer spacing. Styling uses only the supported `--hsi-*` tokens
and `::part(button)`; the vendored files remain unchanged. The imported module
is bundled with the application; no extra service-worker precache entry is needed.

Browser tests simulate launch-mode signals and verify the real shared guide,
mode changes, focus and unchanged preferences/notification activity. This is
browser-engine evidence, not native installation proof. Issue #169 remains open
until separate iPhone and iPad physical-device or Apple Simulator Safari and
Home Screen launch evidence proves the native acceptance checks. In particular,
an injected standalone flag or a WKWebView shell cannot establish installation
or native Home Screen launch behavior. Existing install identity, manifest,
service worker, scores, alerts, subscriptions and settings are preserved.

## Files

| File | Purpose |
| --- | --- |
| `home-screen-install.mjs` | ES module from the pinned release |
| `SHA256SUMS` | The release's checksums for both formats; only the ES module entry is used here |
| `home-screen-install.lock.json` | Pin: version, tag, full source commit, format and script SHA-256 |

Do not edit these files by hand. Check them offline with:

```sh
npm run check:home-screen-install
```

The same check runs on every pull request and push to `main` in
`.github/workflows/home-screen-install.yml`. It verifies only the vendored
files. The existing Tests, preview and release workflows are unchanged. A PR
does not deploy.

## Updates

A local daily job proposes newer stable releases as pull requests titled
“Update home-screen-install to vX.Y.Z”. Each one changes only the three files
above. Its commits use the Claude GitHub App bot as both author and committer.
The job never merges or deploys. It runs only while the maintainer's configured
Mac is on and logged in, so an update can arrive late or not at all while that
Mac is unavailable. See the source repository's `automation/README.md`.

The source repository has no license; the package is not published to any registry.
