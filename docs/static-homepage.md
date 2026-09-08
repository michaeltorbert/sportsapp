# Static homepage delivery

The build uses the installed Vinext prerenderer and packages only its completed homepage HTML in `dist/client/index.html`. Cloudflare's existing asset-first routing serves normal homepage GET and HEAD requests without running the React server renderer. The scoreboard and health APIs remain Worker routes. The native prerender manifest must identify the homepage as fully rendered and API routes as skipped.

The page is a shell: `useScoreboard` initially has empty date/today, no boards and `now=0`; `useInitialSearch` initially returns its server fallback. Browser effects establish the current day, query selection, saved preferences and scores after hydration. The build does not freeze a scoreboard date or fetch scores. Release-history dates are intentional versioned content. The generated HTML and its referenced assets belong to one build, and packaging verifies its exact version/commit against the compiled health response.

Vinext's client requests React Server Component navigation through `/.rsc`; this route remains dynamic and is checked in workerd. A manually constructed RSC-header request to bare `/` receives HTML from static assets. The application uses the suffix route, and browser tests cover query dates, filters, notification focus and updater restoration. Header-only RSC requests to bare `/` are not a supported application entry point after this change.

`check-static-home.mjs` replaces only the local test Worker's root handler with a failing response. Successful static root requests therefore prove that routing bypasses Worker execution; timing alone is not the evidence. The same check verifies dynamic API handling, unknown-path 404 and RSC content type. Packaging fails if HTML, hydration payload markers or referenced assets are missing, and removes a stale packaged index before validation.

This removes homepage rendering work from normal asset delivery. Score API resource limits require separate investigation; this change does not establish that those requests fit the production CPU allowance.
