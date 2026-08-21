# Design notes for the content and public-results work

## Owner decisions (2026-08-21)

- Anonymous checks: **a cheap preview, then signup.** The preview crawls and reports the
  deterministic findings. It makes no Claude call, so it costs almost nothing. Signup
  unlocks the written analysis and the plan.
- Content voice: **one plain voice everywhere.** The same voice as the landing page.

## What a zero-cost preview can honestly report

`crawl/PageSignals.kt` already extracts these per page, with no model call:

`title`, `metaDescription`, `canonical`, `hasOgTags`, `jsonLdTypes`, `robotsMeta`,
`imgCount`, `imgWithAltCount`, `wordCount`, `internalLinkCount`, `externalLinkCount`,
`looksJsOnly`.

`crawl/Robots.kt` reads robots.txt.

So the preview can answer, truthfully and for free:

- Can an AI assistant read your pages at all? (`looksJsOnly`)
- Do you block the AI crawlers? (robots.txt)
- Does each page have a title and a description?
- Is there any text on the page? (`wordCount`)
- Do your images have descriptions? (`imgWithAltCount` against `imgCount`)

That list is the same set of problems this project just fixed on its own site. The product
can therefore show its own audit as the worked example.

The remaining cost of an anonymous check is the crawl itself: up to about 15 page fetches.
`SsrfGuard` and the crawl pacing already limit the damage. Rate limiting per IP is still
needed before this ships.

## Public result pages: the verified architecture

Researched 2026-08-21 against the Cloudflare documentation.

Chosen approach: **a Pages Function**, not a separate Worker and not the Ktor host.

- A direct-upload Pages project does support Functions. The `functions/` directory must sit
  in the directory where `wrangler pages deploy` runs, which for this project is
  `frontend/`, and **not** inside `dist/frontend/browser`. The existing deploy command then
  picks it up with no new flag and no new token scope.
- A Worker with a zone route needs `Workers Scripts:Edit` and `Workers Routes:Edit`. The
  Cloudflare token for this project has neither, so that path is blocked today.
- The Ktor host could serve the HTML itself, but the content would then live on
  `api.traficio.com`. Google tracks crawl behaviour per hostname, so the page would sit
  outside the marketing site's signals. Keep the route on `app.traficio.com`.

**The trap.** "Once you add Functions on a Pages project, all requests by default will
invoke your Function." A `_routes.json` that includes only `/r/*` is mandatory. Without it
every static request runs the Worker, spends the shared 100,000 requests a day, and adds
latency to pages that are free and unlimited today.

Also true, and useful here: `_redirects` rules do not apply to a path a Function serves.
The `/r/*` route does not overlap any existing rule, so nothing else changes.

Free plan: 100,000 requests a day shared between Functions and Workers, 10 ms CPU per
invocation. Never use `_worker.js`: it disables the whole `functions/` directory.
