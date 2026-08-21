# Frontend report: share control and the public result Pages Function

## What this adds

The task adds a share control to the report page and a Cloudflare Pages Function
that renders a shared result as plain HTML. The Function makes the shared link
readable by a crawler that does not run JavaScript.

## Follow-up: the share control now reads the true state on reload

Backend commit `fe62f2f` adds `publicSlug` to `GET /v1/assessments/{id}`. This
closes the "Known limitation" below. The changes:

- `frontend/src/app/core/api/types.ts`: `AssessmentDto` gets `publicSlug: string | null`,
  in the file's existing style (no `?`, an explicit `| null`, like `summary` and
  `scoreNotes` beside it).
- `frontend/src/app/features/report/report.ts`: `init()` now reads
  `assessment.publicSlug` right after `this.assessment.set(assessment)`. A set
  slug turns `shared` on and fills `shareUrl` with
  `${environment.siteOrigin}/r/${assessment.publicSlug}`, before any click.
  Turning sharing on and off still works exactly as before; only the starting
  state changed.
- Every test file that builds an `AssessmentDto` object by hand now sets
  `publicSlug: null` (or passes it through `overrides`), since the field is
  required. Touched: `dashboard.spec.ts`, `history.spec.ts`,
  `history-copy.spec.ts`, `progress.spec.ts`, `result-view.spec.ts`,
  `next-task-view.spec.ts`, `site-home.spec.ts`, plus `report.spec.ts`'s own
  `makeAssessment()`.
- Two new tests in `report.spec.ts`: an assessment with a `publicSlug` renders
  the control on, with the URL visible and no share call made; an assessment
  with `publicSlug: null` renders it off, with no URL element in the page.
- The public finding DTO also changed in the same backend commit: `title` is
  gone, `description` now carries the sentence a person reads. `findingHtml()`
  in `frontend/functions/r/[slug].js` dropped the `<strong>${finding.title}</strong>`
  line. The description now shows first, as the finding's primary text; the
  area shows below it as a small caption, matching how `result-view.ts`
  already orders evidence text over the area caption. The local Node harness
  ran again against a payload with `<`, `&`, `"`, `'` in the description; the
  escaping stayed single and correct.

The "Known limitation" note below is now historical: it described the gap
this follow-up closes.

## Part 1 — the share control

- `frontend/src/app/core/api/api-client.ts` gets two one-line methods:
  `shareAssessment(id)` (`POST /v1/assessments/{id}/share`) and
  `unshareAssessment(id)` (`DELETE /v1/assessments/{id}/share`). Both follow the
  exact style of the file's other methods.
- `frontend/src/app/features/report/report.ts` gets a share control at the top of
  the ready-assessment view. The control reads "Share this result", with the line
  "Anyone with the link can see your score and findings. Your plan stays private."
  under it.
- Five new signals track the state: `shared`, `shareUrl`, `shareBusy`, `shareError`,
  `copied`. The `shared` flag changes only after the server confirms the call. A
  failed call leaves `shared` exactly as it was, so the control never claims a
  state the server has not confirmed.
- The share URL is `${environment.siteOrigin}/r/${slug}`. The code never
  hardcodes the origin.
- Copying uses `navigator.clipboard.writeText`, guarded behind a feature check.
  A browser without the API, or a denied permission, leaves the URL visible and
  selectable in a read-only field; no alert, no thrown error. A successful copy
  shows a short visible message: "Copied to clipboard."
- The page keeps its existing layout and design tokens. The new markup uses only
  classes already in `src/styles.css` (`card`, `stack`, `row`, `btn-primary`,
  `btn-outline`, `muted`, `small`) plus a small local style block, the same
  pattern `account.ts` and `result-view.ts` already use.

**Known limitation, now closed.** The first version of the API contract had
no "am I shared" read. The control started in the "off" state on every page
load, even for an assessment that was already shared. Backend commit
`fe62f2f` added `publicSlug` to `GET /v1/assessments/{id}`; see "Follow-up"
above for the frontend change that reads it.

## Part 2 — the Pages Function

- New file: `frontend/functions/r/[slug].js`. It calls
  `https://api.traficio.com/v1/public/results/<slug>` with no cookie and no
  auth header, then returns server-rendered HTML with the domain, the overall
  score, the three sub-scores, the summary, and every finding with its
  severity, area, and description — all as real text in the markup. (The
  public finding DTO has no `title` field; see "Follow-up" above.)
- One `escapeHtml` helper. Every interpolated value passes through it exactly
  once, at the point it is written into the HTML string. An early draft
  escaped `domain` and `summary` once when building the `<title>` and the
  `<meta name="description">` strings, then escaped those strings again when
  writing them into the page. That double-escaping turned `<` into `&amp;lt;`
  instead of `&lt;`. A local Node harness (fake `fetch`, a payload with
  `<script>`, `&`, `"`, and `'` in it) caught the fault before the second
  preview deploy. The fix keeps every value raw until its one point of
  interpolation. The harness now shows single, correct escaping throughout,
  and injected markup renders as inert text.
- 404: a small styled HTML page, status 404, when the API returns 404 for the
  slug.
- 502: the same small page, status 502, when the API is unreachable or
  answers with an error status other than 404. This is not in the task's
  checklist, but a Function with no fallback for a broken upstream would leak
  an unhandled-exception page instead of a page in the product's voice.
- `<title>`, `<meta name="description">`, and `<link rel="canonical">` (built
  from the request's own origin, so it matches whichever host serves the
  page).
- Headers: `content-type: text/html; charset=utf-8` and
  `cache-control: public, max-age=300` on the 200 path.
- A small inline `<style>` block uses the product's palette (`--bg`, `--ink`,
  `--accent`, and so on, copied as literal hex values, since a Function
  cannot read `src/styles.css`).
- New file: `frontend/_routes.json`, exact content:
  `{ "version": 1, "include": ["/r/*"], "exclude": [] }`.
- `frontend/public/robots.txt` gets one added line, `Allow: /r/`, placed
  right after the existing `Allow: /`. The path was already allowed by
  default; the line only states the intent plainly.

## Where `_routes.json` must sit — verified, not assumed

`frontend/_routes.json` (the deploy root, beside `functions/`, **not** inside
`dist/frontend/browser`) is the correct location. Two checks confirm this:

1. The deploy log lists `_headers` and `_redirects` as uploaded static-asset
   files (both live under `public/` and land in the output directory), but
   never lists `_routes.json` by name. It appears only in the "Uploading
   Functions bundle" step. Wrangler reads it from the project root as routing
   configuration for the Functions Worker, not as a static asset to serve.
2. `npx wrangler pages deployment tail <id>` against two separate preview
   deployments shows a log line only for requests to `/r/*`. A request to
   `/`, `/pricing`, `/guides/why-ai-cannot-find-your-website`, or `/login`
   never appears in the tail output, across two rounds of testing on two
   different deployment ids. The Function never runs for a static path.

No test of the alternate location (`dist/frontend/browser/_routes.json`) was
needed, since the documented location worked on the first deploy and both
checks confirm it directly.

## Verification — real output

### 1. Unit tests

Command: `npx ng test --watch=false --browsers=ChromeHeadless`.

    Chrome Headless 151.0.0.0 (Windows 10): Executed 132 of 132 SUCCESS (1.436 secs / 1.331 secs)
    TOTAL: 132 SUCCESS

Baseline was 126. Six new tests, all in `report.spec.ts`, all pass:

- `renders the share control as on, with the URL, when the assessment arrives with a publicSlug`
- `renders the share control as off, with no URL, when the assessment arrives with publicSlug null`
- `shows the share URL once the owner turns sharing on`
- `hides the share URL once the owner turns sharing off`
- `shows an error and does not claim success when the share call fails`
- `shows an error and keeps the URL visible when the unshare call fails`

### 2. Build

`npm run build` succeeds. `check-redirects.mjs` output:

    check-redirects.mjs: 18 row(s) checked against 10 pre-rendered route(s). No shadowed route and no landing-page destination.

### 3 & 4. Preview deploy and the status table

Four preview deploys went out under branch `share-test`, all with
`--commit-dirty=true`, since local changes were still uncommitted at deploy
time. The first deploy carried the double-escaping fault described above; a
local check caught it before any real traffic depended on it. The second
deploy carried the fix. The third deploy carried only the ASD-STE100 comment
cleanup, no behaviour change. The fourth deploy carried the finding-shape
follow-up (`title` dropped, `description` shown first). Each deploy after the
first was checked with the local Node harness before it went out. The table
below is the final deployment (id `321854bd`,
`https://321854bd.geostrategy.pages.dev`, alias
`https://share-test.geostrategy.pages.dev`), fetched with:

    curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36" <url>

| Path | Status | Title | Body words | Notes |
|---|---|---|---|---|
| `/r/does-not-exist` | 404 | Result not found · Traficio | — | Small styled HTML page. Not the Angular shell. |
| `/` | 200 | AI visibility check for your website \| GeoStrategy | 1026 | Full pre-rendered content. |
| `/pricing` | 200 | Pricing: free score, $9 plan \| GeoStrategy | 689 | Full pre-rendered content. |
| `/guides/why-ai-cannot-find-your-website` | 200 | Why AI cannot find your website \| GeoStrategy | 1056 | Full pre-rendered content. |
| `/login` | 200 | GeoStrategy | 0 visible | The CSR shell: `<body><app-root></app-root>…</body>`, no rendered text. The 55-word `wc -w` count on the raw file comes from inline CSS custom-property tokens in `<head>`, not body prose. |

Every static page still returns its own full content. `_routes.json` scoped
the Function correctly; nothing else changed.

The preview deployment carries Cloudflare's own `x-robots-tag: noindex`
header on every path. This is Cloudflare's standard behaviour for
non-production preview branches, not a result of this task's `_headers` file
or the new Function; production deploys (branch `master`) do not carry it.

### 5. A real shared result — outstanding

The backend endpoints are **not live yet** on `api.traficio.com`, even though
`.superpowers/backend-share-report.md` shows the code merged into the
worktree. Evidence:

- `GET https://api.traficio.com/healthz` → 200. The API server is up.
- `GET https://api.traficio.com/v1/me` (a known, already-deployed route,
  called with no session) → 401, `content-type: application/json`, a real
  error body. This is what a live, deployed route looks like.
- `GET https://api.traficio.com/v1/public/results/does-not-exist` → 404, no
  `content-type`, empty body.
- `GET https://api.traficio.com/v1/nonexistent-route-xyz` (a path that
  cannot exist) → 404, no `content-type`, empty body. Identical to the line
  above.

The public-results route answers exactly like a path that does not exist at
all, not like a deployed route's own 404. The share and unshare routes show
the same pattern: `POST /v1/assessments/probe-id/share` with no session
returns 404, where a deployed, session-checked route would return 401 first.
**This check is outstanding.** It needs a production (or staging) deploy of
the backend change before a real slug can be created and fetched through
`/r/<slug>`.

## Files touched

- `frontend/src/app/core/api/api-client.ts`
- `frontend/src/app/core/api/types.ts`
- `frontend/src/app/features/report/report.ts`
- `frontend/src/app/features/report/report.spec.ts`
- `frontend/src/app/features/dashboard/dashboard.spec.ts`
- `frontend/src/app/features/history/history.spec.ts`
- `frontend/src/app/features/history/history-copy.spec.ts`
- `frontend/src/app/features/progress/progress.spec.ts`
- `frontend/src/app/features/result/result-view.spec.ts`
- `frontend/src/app/features/site-home/next-task-view.spec.ts`
- `frontend/src/app/features/site-home/site-home.spec.ts`
- `frontend/functions/r/[slug].js` (new)
- `frontend/_routes.json` (new)
- `frontend/public/robots.txt`

## Concerns

- The end-to-end check (share a real result, fetch its `/r/<slug>` page) is
  outstanding until the backend deploy ships. Re-checked after commit
  `fe62f2f`: `GET /v1/public/results/does-not-exist` still answers with the
  same generic, empty-body 404 as a made-up route, so the deploy has not
  shipped yet. The Pages Function's rendering path is verified locally
  against the exact DTO shape `backend-share-report.md` and commit
  `fe62f2f` document (`domain`, `createdAt`, `completedAt`, `scores`,
  `scoreNotes`, `summary`, and `findings` with `area`, `severity`,
  `description`), so the risk left is deploy-timing only, not contract
  mismatch.
