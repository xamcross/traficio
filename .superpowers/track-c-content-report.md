# Track C: content and public results — report

## Scope

Files changed:
- `frontend/src/app/features/landing/landing.ts`
- `frontend/src/app/features/pricing/pricing.ts`

No other file was touched. `terms.ts`, `privacy.ts`, `app.routes.ts`, `app.routes.server.ts`, `public/**`, and `frontend/src/app/core/**` were left as they were.

## What was added

### Landing (`/`)

Below the hero (kept word for word), in this order:
1. The three existing "how it works" steps (unchanged).
2. New section, "One score, three parts" (`h2`): explains the three sub-scores — Google, Answers, AI — and states the verified fact that most AI crawlers do not run JavaScript, while Google runs it later on a separate pass.
3. The existing "what you get free" card with the example score (unchanged).
4. New FAQ section, "Questions people ask" (`h2`), with one `h3` per question, covering all seven questions the task listed:
   - Why doesn't my website show up when someone asks ChatGPT?
   - Is this the same as SEO?
   - What do you actually look at?
   - Do I have to install anything, or give you my password?
   - How is this different from hiring an agency?
   - What do I get without paying?
   - How long does a check take?
5. The site footer (unchanged).

The agency-cost answer states the $1,000–$5,000/month range as a range agencies commonly quote, not attributed to a named source, matching the allowed facts. The "why doesn't it show up" answer names GPTBot, ClaudeBot and PerplexityBot and states they read raw HTML and do not run JavaScript.

### Pricing (`/pricing`)

Two new unconditional sections (they render for every visitor, not only the gated/logged-in view), placed after the plan cards and the conditional "what is waiting for you" list, before the footer:
1. "We check your work, not just your intentions" (`h2`): explains the re-check loop — fix a finding, ask for a re-check, GeoStrategy re-reads the same page and confirms whether the score moved — and states plainly that the re-check and score history are part of the paid plan.
2. "You see everything before you pay" (`h2`): states the $1,000–$5,000/month agency range, contrasts it with seeing the score and every finding free first, and says plainly a visitor does not have to decide immediately and may not need Pro if their score is already solid.

## Styling

Reused existing global classes only (`.stack`, `.divider`, `.eyebrow`, `.card-soft`) plus a small number of component-scoped rules that follow the same idiom already used in each file (e.g. `.steps h3 { font-size: 21px; }` in landing.ts), sized to fit the existing type scale (hero h1 54px → new section h2 30px on landing / 26px on pricing → existing card promise 20px). No new colors, no new component library, no new visual language. Mobile breakpoints for the new headings were added to each file's existing `@media (max-width: 760px)` block (landing already had one; a new one was added to pricing.ts, which previously had none).

## Verification

1. **Unit tests**: `npx ng test --watch=false --browsers=ChromeHeadless` → `TOTAL: 126 SUCCESS`, matching the stated baseline exactly. No spec needed a change — neither `landing.spec.ts` nor `pricing.spec.ts` asserts against text I removed or altered; both only check the hero, the three steps, the free-tier promise, the price, and pricing-gate copy, all of which are untouched.
2. **Build**: `npx ng build` (the Angular compile + prerender step) succeeds every time, produces "Prerendered 10 static routes," and writes both `dist/frontend/browser/index.html` and `dist/frontend/browser/pricing/index.html` with the new content baked in.
   - **Concern**: the full `npm run build` (which chains `ng build` and then `scripts/flatten-prerendered-routes.mjs`) fails in the postbuild step with `Error: ENOTEMPTY: directory not empty, rmdir '...\dist\frontend\browser\guides'`. This is reproducible on a clean `dist/` and is unrelated to my changes: `git status` shows the only files I touched are `landing.ts` and `pricing.ts`; the failure comes from a bug in `scripts/flatten-prerendered-routes.mjs`, which does a non-recursive `rmdirSync` on a route directory (`guides`) that still has unflattened child-route subdirectories (`guides/why-ai-cannot-find-your-website`, etc.) inside it. Those routes and that script are owned by the concurrent route-changes task running in this same worktree (confirmed via `.superpowers/task-1-prerender-report.md` and others already present). Because `pricing.html` never gets flattened before the crash, I read the pre-flatten `dist/frontend/browser/pricing/index.html` directly for word counts — it holds the same rendered content the flatten script would otherwise just rename.
3. **Word counts** (tags stripped, `<body>` text only, via a small Node script):

   | Page | Before (given baseline) | After (measured) | Target |
   |---|---|---|---|
   | `/` (`index.html`) | 186 | **598** | 450–600 |
   | `/pricing` (`pricing/index.html`, pre-flatten) | 103 | **329** | 300–400 |

4. **FAQ headings found in the built HTML** (`dist/frontend/browser/index.html`, extracted after build, not just from source):
   - `h2`: "One score, three parts"
   - `h2`: "Questions people ask"
   - `h3`: "You give us your web address" (existing step, unchanged)
   - `h3`: "We read it the way machines do" (existing step, unchanged)
   - `h3`: "You fix one thing at a time" (existing step, unchanged)
   - `h3`: "Why doesn't my website show up when someone asks ChatGPT?"
   - `h3`: "Is this the same as SEO?"
   - `h3`: "What do you actually look at?"
   - `h3`: "Do I have to install anything, or give you my password?"
   - `h3`: "How is this different from hiring an agency?"
   - `h3`: "What do I get without paying?"
   - `h3`: "How long does a check take?"

   Pricing (`dist/frontend/browser/pricing/index.html`):
   - `h2`: "We check your work, not just your intentions"
   - `h2`: "You see everything before you pay"

## Specs

No spec file was changed. Both `landing.spec.ts` and `pricing.spec.ts` passed unmodified.

## Concerns

- The `npm run build` postbuild failure above (ENOTEMPTY on `dist/frontend/browser/guides`) is real and reproducible, but it sits entirely in files outside this task's scope (`app.routes.ts` and `scripts/flatten-prerendered-routes.mjs`, both owned by the concurrent route-changes task). Whoever owns that task should fix the script to remove route directories recursively, or to process nested routes deepest-first, before this worktree can ship a clean `npm run build`.
- Landing content lands at 598 words, 2 words under the 600 ceiling — close to the top of the range by design, since seven honest FAQ answers take real words. Trimmed twice already to get here without cutting substance.
