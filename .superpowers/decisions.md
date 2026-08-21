# Step 1-3 execution notes (prerender + metadata + sitemap)

Base: eeed2e7. Branch: worktree-prerender-seo. Baseline: 120 unit tests pass.

## Verified facts

- Cloudflare Pages docs, Redirects page: "Redirects are always followed, regardless of
  whether or not an asset matches the incoming request." So a `_redirects` row shadows a
  pre-rendered file. The six rows for /pricing, /terms, /privacy must go, or Task 1 is a
  no-op in production. Verified 2026-08-21 against the vendor docs, not only the playbook.
- SSR hazard found before implementation: `app.ts` constructor calls `userStore.refresh()`,
  which is an HTTP GET to the live API. Unguarded, the build would call production once per
  pre-rendered route. Task 1 guards it.

## Controller decisions

- Canonical and sitemap URLs use `https://app.traficio.com` for now, from ONE constant in
  the environment files. Audit step 5 moves the marketing pages to the apex; that then
  becomes a one-line change.
- Titles keep the product name "GeoStrategy" because the interface uses it. Audit finding
  10 (brand and domain do not match) stays open. Revisit the titles when that is decided.
- No `og:image` yet. No image asset exists, and a tag that points at a missing file is
  worse than no tag. Audit finding 11 covers it.

## Found by the preview deployment (2026-08-21)

The playbook is right that only a real preview tells the truth. Two observations:

1. **Defect, being fixed.** Pre-render writes `pricing/index.html`, so Pages answers
   `/pricing` with a 308 to `/pricing/`. Production serves `/pricing` with 200 today, and
   both the canonical link and the sitemap assert the non-slash form. A canonical must
   point at a URL that answers 200. Task 4 flattens the output to `pricing.html`.
2. **Accepted, not a defect.** `/login` and `/dashboard` answer 200 with the pre-rendered
   landing HTML, because `_redirects` rewrites them to `/` and the client router then
   draws the right view. A crawler reads the landing content there, but the canonical in
   that HTML points at `/`, so the duplicate collapses to the home page. No action.
3. **Accepted.** A signed-in visitor sees the logged-out header for one frame, because the
   pre-rendered HTML has no session and `refresh()` runs after hydration. Correct for a
   marketing page.

## Correction (2026-08-21): I was wrong about /login

Earlier in this file I recorded that `/login` serving the pre-rendered landing HTML was
"accepted, not a defect", because the canonical points at `/`. The code review showed that
this reasoning is wrong, and it only looked at the SEO angle.

The real problem is user-visible and structural. Before this branch `/` was an empty shell,
so a rewrite to `/` was harmless. Pre-rendering makes `/` a real page (13,784 bytes, 200
words). Every client route now paints the marketing page first, then swaps. `/verify-email`
and `/auth/complete` are the two URLs a user opens from an email. Angular emits
`index.csr.html` with `<body ngcm="">` for exactly this case, and that attribute switches
hydration off; the pre-rendered `index.html` has a bare `<body>`, so hydration runs against
DOM that does not match the route. The node-mismatch assertions are dev-only, so a
production build reuses the wrong nodes in silence.

Task 5 repoints every client row at the client-render shell and adds `check-redirects.mjs`
to fail the build if a row ever points at `/` again, or if a pre-rendered route gains a row.

Lesson: the preview deployment gave me the correct data (`/login` = 200, 186 words, landing
title). I read it and explained it away. The measurement was right; my interpretation was not.

## Follow-ups the review raised, not done in this branch

- Extract the shared 45 lines from the post-build scripts into one module.
- `rmdirSync` in the flatten script throws on a nested pre-rendered route (`/blog/post`).
- `FALLBACK_TITLE` and `FALLBACK_DESCRIPTION` duplicate the root route's copy; import instead.
- `sitemap.mjs` sets `lastmod` to the build date for every URL, and always reads the
  production environment file whatever the build configuration.
- The no-network-at-build-time rule holds by luck. An `HttpBackend` in `app.config.server.ts`
  that throws would enforce it.
- `angular.json` `security.allowedHosts` is dead config under `outputMode: 'static'`.
- `tsconfig.app.json` now pulls in `"types": ["node"]`, so browser code can reference
  `process` with no compile error.
- `page-title-strategy.spec.ts` has no test for a route with a title but no description, no
  test that the canonical link is overwritten between navigations, and none for a parent
  route's description.
