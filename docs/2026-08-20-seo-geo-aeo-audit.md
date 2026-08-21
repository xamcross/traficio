# SEO / AEO / GEO audit of traficio.com

Date: 2026-08-20. Target: `https://app.traficio.com` and the apex `traficio.com`.
Report artifact (designed, shareable): https://claude.ai/code/artifact/ff698770-b7cd-4b82-8e35-2b0c3bd420ac

This document is the repository record. The artifact holds the same content in a
readable form. Prose follows ASD-STE100.

## Scores

Our judgement against the evidence below, on the product's own three-part model.
These are not output from the assessment engine.

| Score | Value | Reason |
|---|---|---|
| Overall | 12 / 100 | Critical |
| SEO | 24 / 100 | Google can render the pages. It has indexed none. |
| AEO | 8 / 100 | No question is answered on the site. Nothing can lift into an answer box. |
| GEO | 5 / 100 | Every generative engine reads an empty page. The site cannot be cited. |

## The decisive fact

Every public page returns **0 words** of HTML. The body is `<app-root></app-root>`.
All four public pages return the same `<title>GeoStrategy</title>`.

2026 testing shows that GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot,
Claude-SearchBot and PerplexityBot read raw HTML and do not execute JavaScript.
Google renders, but on a separate queue, and Google still recommends
pre-rendering. A product about AI visibility is absent from every AI engine it
names.

Measured: `curl https://app.traficio.com/ | strip tags | wc -w` returns 0.
Rendered, the landing page holds only 186 words, which is thin by itself.

## Findings

| # | Severity | Finding |
|---|---|---|
| 1 | Critical | No page sends text to a crawler. All content is drawn by JavaScript. |
| 2 | Critical | No sitemap, and `site:traficio.com` returns nothing. |
| 3 | High | One title for four pages. No `Title` or `Meta` service exists in the app. |
| 4 | High | Marketing pages sit on `app.`; the apex only redirects, so authority splits. |
| 5 | High | The free check needs an account. Competitors all run an ungated grader. |
| 6 | High | No result has a public address, so nothing earns a link or a citation. |
| 7 | High | Public copy contains SEO 0, AEO 0, "answer engine" 0, "AI search" 0, "small business" 0. |
| 8 | Medium | No structured data. Value is brand attribution; 2026 evidence shows no citation uplift. |
| 9 | Medium | No stated AI-crawler policy. Cloudflare changes the control on 2026-09-15. |
| 10 | Medium | The brand is GeoStrategy, the domain is traficio.com. Brand search splits. |
| 11 | Low | No Open Graph image. HTML is not cached at the edge. |
| — | Already right | Delivery is fast and correct: TTFB 155-305 ms, 1.6 KB shell, HTTPS, security headers, a real 404. |
| — | Already right | The site is empty, not blocked. No penalty, no accidental `noindex`. Every fix is additive. |

## Status

Steps 1, 2 and 3 are **done** and live (master 613b71e, deployed 2026-08-21).
Measured on `https://app.traficio.com` after the deploy:

| URL | Before | After |
|---|---|---|
| `/` | 0 words, title "GeoStrategy" | 186 words, "AI visibility check for your website" |
| `/pricing` | 0 words, same title | 103 words, "Pricing: free score, $9 plan" |
| `/terms` | 0 words, same title | 116 words, "Terms of service" |
| `/privacy` | 0 words, same title | 96 words, "Privacy policy" |
| `/sitemap.xml` | 404 | 200, four public URLs |
| client routes | shell | shell, unchanged for users |

Each public page now carries its own description, canonical link and Open Graph tags.
`robots.txt` points at the sitemap. Submit the sitemap in Google Search Console next;
that is the remaining half of step 3, and it needs an account, so an agent cannot do it.

Two defects appeared during the work and both are fixed. A real preview deployment found
each one; neither was visible from the build output.

1. Pre-rendering writes `pricing/index.html`, so Pages answered `/pricing` with a 308 to
   `/pricing/`, while the canonical and the sitemap asserted the non-slash form. A
   post-build step now flattens the output to `pricing.html`, and `/pricing` answers 200.
2. `_redirects` sent every client route to `/`. That was safe while `/` was an empty shell.
   Pre-rendering made `/` a real page, so `/login`, `/verify-email` and the rest began to
   paint the marketing page before the app booted, and hydration ran against the wrong DOM.
   Every client row now points at the client-render shell that Angular emits for this case.
   `scripts/check-redirects.mjs` fails the build if either rule breaks again.

## The plan, in dependency order

1. ~~**Pre-render the four public pages.**~~ **Done 2026-08-21.** `ng add @angular/ssr`, `outputMode: 'static'`,
   `RenderMode.Prerender` on `/`, `/pricing`, `/terms`, `/privacy`. Move `window` and
   `document` access behind `afterNextRender()`. **Then delete those four rows from
   `public/_redirects`** — a rewrite row shadows a pre-rendered file. Half a day.
   This reverses plan decision D6 in `2026-08-16-platform-config.md`.
2. ~~**Per-page title, description, canonical, Open Graph.**~~ **Done 2026-08-21.** Add a `TitleStrategy`.
   Write for the search, not the brand. Add depth to the 186-word home page. 2 hours.
3. ~~**Sitemap and registration.**~~ **Sitemap done 2026-08-21; registration in Search Console is still open.** Generate `sitemap.xml` at build time, point
   `robots.txt` at it, verify in Google Search Console and Bing Webmaster Tools. 1 hour.
4. **AI crawler policy before 2026-09-15.** Name the search-facing bots, add a
   Content-Signal line, decide on the training crawlers. 1 hour.
5. **Move the marketing pages to the apex.** Keep the signed-in app on `app.`.
   Cheapest before links exist. Half a day. This reverses plan decision D1.
6. **Open the free check; give results a public address.** The largest lever:
   lead magnet, link magnet and page production in one change. Multi-day.
7. **Write five pages.** The diagnostic questions, not the category terms. Ongoing.
8. **Organization and SoftwareApplication markup.** 1 hour, low expected return.

Then run the assessment engine on `traficio.com` and compare its result with this
report. Agreement is evidence the engine works. Disagreement finds a gap in the
engine or a mistake here.

## Keyword strategy in one line

Do not fight for "ai visibility checker" or "geo audit tool". Semrush, Ahrefs and
Birdeye hold them with free tools, and dozens of near-identical startups run
comparison pages against each other. Take the diagnostic questions, where the
current answers are thin agency posts, and the cost comparison, where agencies
quote USD 1,000-5,000 a month and nobody sets a USD 9 tool beside it. Use the
words "AI visibility" in titles: the large platforms use that term commercially,
and GEO and AEO have plateaued.

The full keyword table, content gaps, technical checklist and competitor
comparison are in the artifact.

## Method

Site evidence comes from the live production site on 2026-08-20: raw HTML fetches,
response headers, timing over three runs, `robots.txt`, sitemap and llms.txt
probes, a `site:` query, and a read of the frontend source. Crawler behaviour,
competitor pricing and the keyword landscape come from 2026 web research; disputed
claims are marked in the artifact. No search-volume figures are quoted, because no
keyword tool is connected. Connect Ahrefs or Semrush to add real volumes.
