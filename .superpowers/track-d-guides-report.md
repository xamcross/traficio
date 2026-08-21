# Track D: guides content section — verification report

## Scope

Added `/guides` (index) and five guide pages, wired into `app.routes.ts`,
`app.routes.server.ts` (all six as `RenderMode.Prerender`), and linked from
the app-shell nav in `app.html`. Did not touch `landing.ts`, `pricing.ts`,
`public/_redirects`, or `frontend/scripts/**`.

One blocker occurred during the work: `frontend/scripts/flatten-prerendered-routes.mjs`
called `rmdirSync` on a route's directory without checking it was empty
first. That directory rule broke on a route that is both a page and a
folder prefix for other pages — exactly what `/guides` plus its five
children are. The build failed with `ENOTEMPTY` at the postbuild step. The
coordinator owns that script, fixed it directly (commit `19ba6d8`), and told
me to re-run the build. All results below come from that fixed build, run
after the coordinator's commit landed on this branch.

## 1. `npm run build` succeeds and `check-redirects.mjs` passes

Succeeded. Full postbuild log:

```
> frontend@0.0.0 postbuild
> node scripts/check-redirects.mjs && node scripts/flatten-prerendered-routes.mjs && node scripts/sitemap.mjs

check-redirects.mjs: 18 row(s) checked against 10 pre-rendered route(s). No shadowed route and no landing-page destination.
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\guides\geo-aeo-and-ai-visibility-explained\index.html -> ...\guides\geo-aeo-and-ai-visibility-explained.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\guides\is-your-site-readable-by-chatgpt\index.html -> ...\guides\is-your-site-readable-by-chatgpt.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\guides\the-beginners-seo-checklist\index.html -> ...\guides\the-beginners-seo-checklist.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\guides\what-seo-costs-a-small-business\index.html -> ...\guides\what-seo-costs-a-small-business.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\guides\why-ai-cannot-find-your-website\index.html -> ...\guides\why-ai-cannot-find-your-website.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\guides\index.html -> ...\dist\frontend\browser\guides.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\pricing\index.html -> ...\dist\frontend\browser\pricing.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\privacy\index.html -> ...\dist\frontend\browser\privacy.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\terms\index.html -> ...\dist\frontend\browser\terms.html
flatten-prerendered-routes.mjs: ...\dist\frontend\browser\index.csr.html -> ...\dist\frontend\browser\app\index.html
sitemap.mjs: wrote ...\dist\frontend\browser\sitemap.xml
```

`check-redirects.mjs` reported no shadowed route and no landing-page
destination, so `_redirects` is still correct and untouched.

## 2. Build reports pre-rendering 10 routes

```
Prerendered 10 static routes.
```

## 3. The six new files in `dist/frontend/browser/`

All present, at the expected flat paths:

- `dist/frontend/browser/guides.html`
- `dist/frontend/browser/guides/why-ai-cannot-find-your-website.html`
- `dist/frontend/browser/guides/what-seo-costs-a-small-business.html`
- `dist/frontend/browser/guides/geo-aeo-and-ai-visibility-explained.html`
- `dist/frontend/browser/guides/is-your-site-readable-by-chatgpt.html`
- `dist/frontend/browser/guides/the-beginners-seo-checklist.html`

## 4. Title, description, canonical, body text, and word count per page

| File | `<title>` | Meta description | Canonical | Body words |
|---|---|---|---|---|
| `guides.html` | Guides \| GeoStrategy | Plain-language guides on SEO, AI visibility and being found by Google and AI assistants like ChatGPT, written for people who run one website. | https://app.traficio.com/guides | 179 |
| `guides/why-ai-cannot-find-your-website.html` | Why AI cannot find your website \| GeoStrategy | AI assistants read raw HTML, not your JavaScript. See why ChatGPT, Claude and Perplexity can miss your business, and what to check first. | https://app.traficio.com/guides/why-ai-cannot-find-your-website | 784 |
| `guides/what-seo-costs-a-small-business.html` | What SEO costs a small business \| GeoStrategy | Agencies commonly quote $1,000 to $5,000 a month for SEO. What that buys, what you can do free, and where a $9 tool fits. | https://app.traficio.com/guides/what-seo-costs-a-small-business | 735 |
| `guides/geo-aeo-and-ai-visibility-explained.html` | GEO, AEO and AI visibility explained \| GeoStrategy | SEO, AEO and GEO explained in plain language: being found, being the answer, and being mentioned by AI. What each term really means. | https://app.traficio.com/guides/geo-aeo-and-ai-visibility-explained | 777 |
| `guides/is-your-site-readable-by-chatgpt.html` | Is your site readable by ChatGPT? \| GeoStrategy | A step-by-step way to see your site the way ChatGPT sees it, plus what GPTBot, ClaudeBot and PerplexityBot each do. | https://app.traficio.com/guides/is-your-site-readable-by-chatgpt | 775 |
| `guides/the-beginners-seo-checklist.html` | The beginner's SEO checklist \| GeoStrategy | A start-to-finish SEO checklist for a small business website: titles, descriptions, content, contact details, sitemap and images. | https://app.traficio.com/guides/the-beginners-seo-checklist | 755 |

Each title, description and canonical is distinct per page (checked by
direct grep of the built HTML, not by reading the source templates). The
five guide pages (excluding the index) each land in the 700-1000 word
range asked for.

## 5. `dist/frontend/browser/sitemap.xml` lists 10 URLs

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://app.traficio.com/</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/guides</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/guides/geo-aeo-and-ai-visibility-explained</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/guides/is-your-site-readable-by-chatgpt</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/guides/the-beginners-seo-checklist</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/guides/what-seo-costs-a-small-business</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/guides/why-ai-cannot-find-your-website</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/pricing</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/privacy</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
  <url>
    <loc>https://app.traficio.com/terms</loc>
    <lastmod>2026-08-21</lastmod>
  </url>
</urlset>
```

10 `<url>` entries, matching the 10 pre-rendered routes.

## 6. `npx ng test --watch=false --browsers=ChromeHeadless`

```
TOTAL: 126 SUCCESS
```

Matches the baseline exactly. No new spec files were added for the guide
components, so the total did not change.

## 7. `npx playwright test`

```
Running 2 tests using 2 workers

  ✓  1 e2e\pro-next-task.spec.ts:3:5 › pro user sees the next task, marks it done, and the following task appears (2.0s)
  ✓  2 e2e\happy-path.spec.ts:11:5 › signup, the dashboard hand-off runs a check, and the free result leads to the gate (4.8s)

  2 passed (24.9s)
```

## Additional checks

- The pre-rendered landing page HTML (`dist/frontend/browser/index.html`)
  contains `href="/guides"`, confirming a crawler following links from the
  homepage reaches the guides section without needing the sitemap.
- Spot-checked that page-specific facts landed in the right built file:
  `GPTBot` appears in `is-your-site-readable-by-chatgpt.html`, `1,000 to`
  appears in `what-seo-costs-a-small-business.html`, `May 2026` appears in
  `geo-aeo-and-ai-visibility-explained.html`.

## Files touched

- `frontend/src/app/app.routes.ts` — six new routes with title and
  `data.description`.
- `frontend/src/app/app.routes.server.ts` — six new `RenderMode.Prerender`
  entries.
- `frontend/src/app/app.html` — added a "Guides" link to the anonymous nav.
- `frontend/src/app/features/guides/guide-layout.ts` — shared shell
  (back link, reading measure, footer) for the five guide pages.
- `frontend/src/app/features/guides/guides-index.ts` — the `/guides` index
  page.
- `frontend/src/app/features/guides/why-ai-cannot-find-your-website.ts`
- `frontend/src/app/features/guides/what-seo-costs-a-small-business.ts`
- `frontend/src/app/features/guides/geo-aeo-and-ai-visibility-explained.ts`
- `frontend/src/app/features/guides/is-your-site-readable-by-chatgpt.ts`
- `frontend/src/app/features/guides/the-beginners-seo-checklist.ts`

Not touched: `landing.ts`, `pricing.ts`, `public/_redirects`,
`frontend/scripts/**` (the one fix inside `scripts/**` was made and
committed by the coordinator, not by this task).
