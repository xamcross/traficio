# Task 5 — CSR-fallback redirect fix, report

## The defect

`public/_redirects` rewrote every client route to `/`. That destination was correct
while `/` was an empty SPA shell. Pre-rendering made `/` a real landing page, so a
hard load of `/login`, `/verify-email`, `/auth/complete`, and the other client
routes painted the marketing page first, then swapped to the real page after the
bundle booted. Hydration then ran against DOM that did not match the route.

## The fix

Every client-route row in `_redirects` now points at the client-render shell, not
at `/`. `scripts/check-redirects.mjs` runs first in `postbuild` and fails the build
if a row ever points at `/` or `/index.html` again, or if a pre-rendered route
gains a row.

## Candidate A — destination `/index.csr.html`

Deployed and tested first, because it needs no code change: Angular already emits
this file.

**Result: rejected.** Cloudflare Pages normalised the destination. A `curl` to
`/login` returned:

```
HTTP/1.1 308 Permanent Redirect
Location: /index.csr
```

The same 308 appeared on every client route (`/signup`, `/dashboard`,
`/verify-email`, `/auth/complete`, `/assessments/abc/report`, `/sites/x`). Pages
strips `.html` from a destination whose name contains "index" and 308s to the
bare name — the same failure mode `docs/2026-08-16-platform-config-playbook.md`
records for `/index.html`, just with a different bare name. This is the
"do not decide from theory, test it" case the task called out.

## Candidate B — destination `/app/`, kept

`scripts/flatten-prerendered-routes.mjs` now also copies `index.csr.html` to
`app/index.html` after it flattens the four pre-rendered routes. `_redirects`
points every client row at `/app/` instead. A directory index needs no
normalisation, so Pages serves it as-is.

**Result: accepted.** No 308 anywhere. Every client route returns 200 with 0 body
words and the shell's title (`GeoStrategy`), never the landing page's title. See
the status table below.

`_headers` gets two new `X-Robots-Tag: noindex` rules: `/app/*` (the destination in
use) and `/index.csr.html` (still a directly reachable URL, kept noindexed too).

## Preview deployment

```
npx --no-install wrangler pages deploy dist/frontend/browser --project-name=geostrategy --branch=csr-fallback-test --commit-dirty=true
```

- Candidate A build: `https://ebc675f6.geostrategy.pages.dev`
- Candidate B build (kept): `https://9bae0d52.geostrategy.pages.dev`
- Alias for both: `https://csr-fallback-test.geostrategy.pages.dev`

All requests below used:
`curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36"`

Word counts exclude `<script>` and `<style>` content and count only text inside
`<body>` — a plain tag-strip that leaves inline CSS text in place overstates the
count on the shell page (a first pass wrongly reported 9 words for `/login`;
the corrected method reports 0, matching the empty `<app-root></app-root>` body).

### Candidate A — `https://ebc675f6.geostrategy.pages.dev`

| Path | Status | Location | Words | Title |
|---|---|---|---|---|
| `/` | 200 | — | 285 | AI visibility check for your website \| GeoStrategy |
| `/pricing` | 200 | — | 186 | Pricing: free score, $9 plan \| GeoStrategy |
| `/terms` | 200 | — | 184 | Terms of service \| GeoStrategy |
| `/privacy` | 200 | — | 163 | Privacy policy \| GeoStrategy |
| `/login` | **308** | `/index.csr` | 0 | — |
| `/signup` | **308** | `/index.csr` | 0 | — |
| `/dashboard` | **308** | `/index.csr` | 0 | — |
| `/verify-email` | **308** | `/index.csr` | 0 | — |
| `/auth/complete` | **308** | `/index.csr` | 0 | — |
| `/assessments/abc/report` | **308** | `/index.csr` | 0 | — |
| `/sites/x` | **308** | `/index.csr` | 0 | — |
| `/no-such-page` | 404 | — | 34 | Page not found · GeoStrategy |
| `/sitemap.xml` | 200 | — | n/a | — |
| `/robots.txt` | 200 | — | n/a | — |

(Word counts for `/`, `/pricing`, `/terms`, `/privacy`, `/no-such-page` above used the
first, cruder counting pass; the client-route rows are unaffected, since a 308 body
carries no page text either way. Candidate A was abandoned once the 308 appeared, so
it was not re-measured with the corrected counter.)

### Candidate B — `https://9bae0d52.geostrategy.pages.dev` (kept)

| Path | Status | Location | Words | Title |
|---|---|---|---|---|
| `/` | 200 | — | 208 | AI visibility check for your website \| GeoStrategy |
| `/pricing` | 200 | — | 119 | Pricing: free score, $9 plan \| GeoStrategy |
| `/terms` | 200 | — | 121 | Terms of service \| GeoStrategy |
| `/privacy` | 200 | — | 103 | Privacy policy \| GeoStrategy |
| `/login` | 200 | — | 0 | GeoStrategy |
| `/signup` | 200 | — | 0 | GeoStrategy |
| `/dashboard` | 200 | — | 0 | GeoStrategy |
| `/verify-email` | 200 | — | 0 | GeoStrategy |
| `/auth/complete` | 200 | — | 0 | GeoStrategy |
| `/assessments/abc/report` | 200 | — | 0 | GeoStrategy |
| `/sites/x` | 200 | — | 0 | GeoStrategy |
| `/no-such-page` | 404 | — | 13 | Page not found · GeoStrategy |
| `/sitemap.xml` | 200 | — | n/a | — |
| `/robots.txt` | 200 | — | n/a | — |

Every required outcome matches: the four pre-rendered routes keep 200, their own
distinct title, and real body text; the seven client routes are 200 with 0 body
words and a title that is not the landing page's; `/no-such-page` is 404; the two
static files are 200; no client route 308s.

## Tests

- `npm run build` — succeeds. `check-redirects.mjs` runs first in `postbuild` and
  reports `18 row(s) checked against 4 pre-rendered route(s)`.
- `npx ng test --watch=false --browsers=ChromeHeadless` — `TOTAL: 126 SUCCESS`.
- `npx playwright test` — `2 passed`.

## Files changed

- `frontend/public/_redirects` — 18 client rows repointed at `/app/`; comment
  block rewritten to explain the rule.
- `frontend/public/_headers` — `X-Robots-Tag: noindex` added for `/app/*` and
  `/index.csr.html`.
- `frontend/scripts/flatten-prerendered-routes.mjs` — now also copies
  `index.csr.html` to `app/index.html`.
- `frontend/scripts/check-redirects.mjs` — new. Fails the build if a
  pre-rendered route gets a row, or a client row targets `/` or `/index.html`.
- `frontend/package.json` — `postbuild` runs `check-redirects.mjs` first.
