# Task 2: per-page SEO metadata

## Summary

The app now sets a distinct title, a description, a canonical link and Open
Graph tags on every navigation. A new `PageTitleStrategy` does the work. The
build proves it: each of the four pre-rendered pages carries its own title
and tags in the static HTML, and no page shares the landing page's title.

## Files changed

- `frontend/src/app/core/seo/page-title-strategy.ts` (new). The
  `TitleStrategy` subclass. It reads the route's `title` and
  `data.description`, and sets the document title, the description meta
  tag, the Open Graph tags, the Twitter card tag and the canonical link on
  every navigation.
- `frontend/src/app/core/seo/page-title-strategy.spec.ts` (new). Six unit
  tests for the strategy.
- `frontend/src/app/app.routes.ts`. Added `title` and `data.description` to
  every route. The four public routes carry the exact copy from the task.
  The client-rendered routes (login, signup, dashboard, account and so on)
  carry a short sensible title, each under 60 characters.
- `frontend/src/app/app.config.ts`. Registered
  `{ provide: TitleStrategy, useClass: PageTitleStrategy }`.

## Design notes

- Canonical and `og:url` use `environment.siteOrigin` plus the route path.
  No file hardcodes the origin.
- The Title and Meta services from `@angular/platform-browser` write
  through Angular's injected `DOCUMENT`, so they work the same way during
  pre-render and in the browser. Angular has no service for `<link>`
  elements, so the canonical link is set through the same injected
  `DOCUMENT` token, not the global `document`.
- A route with no title or no description falls back to the landing page's
  title and description (`FALLBACK_TITLE`, `FALLBACK_DESCRIPTION` exported
  constants). Every meta tag is set on every navigation, so a stale value
  from the previous page can never survive.
- `og:image` is not set. No image asset exists yet.

## Verification

### 1. Unit tests

Command: `npx ng test --watch=false --browsers=ChromeHeadless`

Result: `TOTAL: 126 SUCCESS` (baseline was 120; 6 new tests added, all
pass, no failures).

### 2. Build and built-file metadata

Command: `npm run build`

Build output included `Prerendered 4 static routes.` and completed with no
errors.

Extracted from `dist/frontend/browser/{index,pricing/index,terms/index,privacy/index}.html`:

**`index.html` (landing, path `/`)**
```
<title>AI visibility check for your website | GeoStrategy</title>
<meta name="description" content="See how findable your website is in Google, answer boxes and AI assistants like ChatGPT. Get your score and every problem we find, free. No card needed.">
<meta property="og:title" content="AI visibility check for your website | GeoStrategy">
<meta property="og:description" content="See how findable your website is in Google, answer boxes and AI assistants like ChatGPT. Get your score and every problem we find, free. No card needed.">
<meta property="og:url" content="https://app.traficio.com/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GeoStrategy">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://app.traficio.com/">
```

**`pricing/index.html` (path `/pricing`)**
```
<title>Pricing: free score, $9 plan | GeoStrategy</title>
<meta name="description" content="Your score and findings are always free. Pro is $9 a month for the step-by-step plan, the re-check that confirms each fix, and your score history.">
<meta property="og:title" content="Pricing: free score, $9 plan | GeoStrategy">
<meta property="og:description" content="Your score and findings are always free. Pro is $9 a month for the step-by-step plan, the re-check that confirms each fix, and your score history.">
<meta property="og:url" content="https://app.traficio.com/pricing">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GeoStrategy">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://app.traficio.com/pricing">
```

**`terms/index.html` (path `/terms`)**
```
<title>Terms of service | GeoStrategy</title>
<meta name="description" content="The terms of service for GeoStrategy, including your account, acceptable use, payment and cancellation.">
<meta property="og:title" content="Terms of service | GeoStrategy">
<meta property="og:description" content="The terms of service for GeoStrategy, including your account, acceptable use, payment and cancellation.">
<meta property="og:url" content="https://app.traficio.com/terms">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GeoStrategy">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://app.traficio.com/terms">
```

**`privacy/index.html` (path `/privacy`)**
```
<title>Privacy policy | GeoStrategy</title>
<meta name="description" content="How GeoStrategy handles your data: what we collect, why we collect it, how long we keep it, and how to ask us to delete it.">
<meta property="og:title" content="Privacy policy | GeoStrategy">
<meta property="og:description" content="How GeoStrategy handles your data: what we collect, why we collect it, how long we keep it, and how to ask us to delete it.">
<meta property="og:url" content="https://app.traficio.com/privacy">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GeoStrategy">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://app.traficio.com/privacy">
```

All four titles differ from each other. No page has an `og:image` tag.

### 3. Body word counts

A small Node script stripped tags from each page's body (from the feature
component's root tag to `<app-site-footer`) and counted words:

| Page | Word count |
|---|---|
| index.html (landing) | 198 |
| pricing/index.html | 110 |
| terms/index.html | 111 |
| privacy/index.html | 93 |

These match Task 1's rough baseline (landing ~200, pricing ~116, terms
~120, privacy ~102) within the margin of a simple word-split script. No
component template, style or copy was touched in this task, so the body
text is unchanged; only `<head>` metadata was added.

## Concerns

- None found. `TitleStrategy` fires correctly during pre-rendering: the
  built static HTML for all four public routes carries its own title,
  description, canonical link and Open Graph tags, which was the one
  condition on which this task could fail.
- Two commits from a concurrent task (`1e826ae`, `33834a5`) landed on this
  branch during the work and added `siteOrigin` plus a sitemap script. This
  task did not touch `environment.ts`, `environment.production.ts`,
  `robots.txt`, `frontend/scripts/**`, `package.json` scripts, `_redirects`
  or `angular.json`, per the constraints.
