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
