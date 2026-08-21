# Frontend report: the ungated preview on the landing page

## What this adds

The landing page form no longer sends a visitor straight to signup. Submitting
an address now runs a free, ungated preview in place: it calls the new
`POST /v1/preview` endpoint (no auth), shows an honest "Reading your
pages…" state, then lists the checks the crawl found, worst first, with the
existing severity badge. A call to action under the checks leads to signup,
carrying the same URL the page already stored. The preview never shows a
score, a grade, or a percentage — only checks.

## Files changed

- `frontend/src/app/core/api/types.ts` — added `PreviewSeverity`,
  `PreviewCheck`, `PreviewDto`.
- `frontend/src/app/core/api/api-client.ts` — one new line,
  `preview(url: string)`, matching the exact style of its neighbours.
- `frontend/src/app/features/landing/landing.ts` — the hero, the three
  steps, the explainer, the free-tier card, and the FAQ are untouched. A new
  section sits between the hero and the steps, visible only once the form is
  submitted (`previewState() !== 'idle'`), so it renders nothing during
  prerendering.
- `frontend/src/app/shared/copy.ts` — `SEVERITY_LABELS` and `SEVERITY_ORDER`
  both gained a `critical` entry (`'CRITICAL'`, order `-1`, worse than
  `high`). The preview is the only caller that ever sends `critical`; the
  full assessment's `Finding.severity` type does not include it, so nothing
  else changes behaviour.
- `frontend/src/app/shared/severity-badge.ts` — the badge's class map
  gained `critical: 'badge-critical'`.
- `frontend/src/styles.css` — one new rule, `.badge-critical { color: #fff;
  background: var(--accent); }`, reusing the same solid-accent-fill pattern
  `.btn-primary` already uses elsewhere, so no new color was introduced.
- `frontend/src/app/features/landing/landing.spec.ts` — rewritten test 2
  (signed-out submit) since its assumption, "submitting goes to /signup",
  is no longer true; four new tests added (below).
- `frontend/e2e/happy-path.spec.ts` — step 1 updated (see the Playwright
  section below).

## Behaviour, state by state

- **Loading.** `runPreview()` sets state to `loading` before calling the
  API. The template shows "Reading your pages…" plus one sentence saying
  the crawl takes a few seconds and reads pages the way an AI crawler does.
  The submit button disables (`form.invalid || previewState() === 'loading'`)
  so a second click cannot fire a second request.
- **Success.** The domain, the page count, and every check appear, sorted
  worst first (`critical` → `high` → `medium` → `low` → `good`) using
  `app-severity-badge`. A card below states plainly that the full check adds
  the score, the rest of the findings, and the plan, and that it is free to
  start, with a "Create my free account" link to `/signup`.
- **429.** Message: "You have used your three free previews for this hour."
  plus "Create an account to keep checking your site.", with the same
  signup link. Never says "network error."
- **400.** Message: "That address does not look right. Check it above and
  try again." The input stays enabled; the visitor edits it and resubmits
  with the existing form.
- **Any other failure** (a thrown `Error`, an `ApiError` with an
  unrecognised status, and so on): "Something went wrong on our side. Try
  again." The `try`/`catch` in `runPreview()` always sets a terminal state
  in its `catch` branch, so the page can never stay on `loading`.
- **Signed-in visitor.** Unchanged: submitting still stores the URL and
  routes straight to `/dashboard`, skipping the preview. The task only asked
  to change the "sent to signup" path; a signed-in visitor already has an
  account, so gating them behind a preview would be pointless. Test 2 in the
  original suite ("goes to the dashboard when signed in") still covers this,
  renamed slightly for clarity.

The pending-URL storage happens once, at the top of `submit()`, before the
preview call — exactly where the old code stored it before navigating. The
signup link therefore carries the URL the same way the page already did; no
new storage call was needed on the call-to-action itself.

## Verification — real output

### 1. Unit tests

Baseline, before any change:

    Chrome Headless 151.0.0.0 (Windows 10): Executed 132 of 132 SUCCESS (0.993 secs / 0.922 secs)
    TOTAL: 132 SUCCESS

After the change, `npx ng test --watch=false --browsers=ChromeHeadless`:

    Chrome Headless 151.0.0.0 (Windows 10): Executed 135 of 135 SUCCESS (1.168 secs / 1.072 secs)
    TOTAL: 135 SUCCESS

135 = 132 baseline − 1 rewritten (the old "goes to signup" test no longer
matches the new behaviour) + 5 (1 rewritten test back, plus 4 new). The new
and rewritten tests in `landing.spec.ts`:

- `goes to the dashboard when signed in, without running a preview` (rewrite
  of the old signup-navigation test; the signed-in path is unchanged)
- `stores the url and runs the preview in place, worst finding first, with
  no invented score` — asserts the address is stored, the page stays off
  `/signup` during loading, the loading copy appears, the success view shows
  the domain and every check in `critical → medium → good` order, no text
  matches `\d+/100` or `\d+%` anywhere on the page, and clicking "Create my
  free account" navigates to `/signup` with the URL still in
  `sessionStorage`.
- `shows the limit message on a 429, and never claims a network error` —
  asserts the exact limit sentence appears, the generic network-error
  sentence never appears, and the submit button is not left disabled.
- `shows the address message on a 400, and leaves the form editable` —
  asserts the exact address message and that the input stays enabled.
- `never leaves the page stuck loading when the preview fails for another
  reason` — rejects with a plain `Error` (not an `ApiError`), asserts the
  loading text is gone, the generic short message shows, and the button is
  not disabled.

### 2. Build

`npm run build` succeeded. Postbuild output:

    check-redirects.mjs: 18 row(s) checked against 10 pre-rendered route(s). No shadowed route and no landing-page destination.

Build log confirms `Prerendered 10 static routes.` — unchanged from before
the task.

### 3. Built `index.html` — marketing copy, FAQ, and word count

The hero line, all three FAQ headings checked, and the free-tier example
label are all present in `dist/frontend/browser/index.html`:

    Why doesn't my website show up when someone asks ChatGPT?
    How long does a check take?
    Your customers ask AI. Does it know you exist?
    EXAMPLE RESULT, FREE TIER

Word count of the built `index.html` (script/style stripped, tags stripped,
whitespace collapsed): **606 words**, both before and after this change —
confirmed by stashing the change, rebuilding, and counting again on the
unmodified `HEAD` of this worktree. The preview UI adds zero words to the
static, pre-rendered page, because `@if (previewState() !== 'idle')` is
false at prerender time; it only renders after a visitor submits the form,
post-hydration, exactly as required.

**Concern, reported plainly:** the task states the production count was 552;
this worktree's `HEAD` (before any of my edits) already built to 606. That
drift is pre-existing — it comes from other work already merged into this
worktree (the public-sharing feature and its extra head/meta content), not
from this task. I did not chase it down further since the task scope is the
preview flow, not that discrepancy, but it is worth a maintainer's look
before the "552" figure is trusted for future comparisons.

### 4. Playwright — 2 specs

`npx playwright test`:

    Running 2 tests using 2 workers
      ✓  1 e2e/pro-next-task.spec.ts:3:5 (1.9s)
      ✓  2 e2e/happy-path.spec.ts:11:5 (4.9s)
    2 passed (32.3s)

`pro-next-task.spec.ts` needed no change; it never touches the landing page.

`happy-path.spec.ts` step 1 changed. What and why:

- Added a `page.route` mock for `POST /v1/preview` returning a domain,
  `pagesChecked: 5`, and two checks (one `critical`, one `good`), before the
  test drives the landing form. Without this the catch-all `/v1/**` mock
  would answer with the loud 500 the test uses to fail unmocked routes, since
  `/v1/preview` is a real request now.
- The old assertion `await expect(page).toHaveURL(/\/signup$/)` right after
  clicking "Check my site free" is no longer true — that click now runs the
  preview in place. Replaced with: wait for the preview heading ("What we
  found on example.com") and the critical finding's text to become visible,
  then click the new "Create my free account" link, then assert the
  `/signup` navigation. This keeps the spec's intent (prove the URL makes it
  from the landing form to signup) while covering the new step honestly
  instead of skipping past it.
- A short comment explains the new step for the next reader.

## Concerns

- The backend contract for `POST /v1/preview` was mocked per the task's
  spec, since the concurrent backend task's endpoint is not confirmed live
  in this worktree. The frontend was built strictly against the documented
  shape (`domain`, `pagesChecked`, `checks[]` with `id`/`severity`/
  `description`; `429` with `Retry-After`; `400` for a bad URL). Status-code
  branching (`e.status === 429` / `400`), not the `ApiError.code` string, is
  the primary signal in `runPreview()`'s `catch`, since the contract does not
  guarantee a specific error-body `code` value — this makes the branching
  robust even if the real backend's error body shape differs slightly from
  what tests mock.
- The `dist/frontend/browser/index.html` word-count drift (552 expected vs.
  606 actual, present before this task's changes too) is flagged above and
  left for a maintainer, since it predates this branch of work.
- `critical` is a new severity value with no prior precedent in the shared
  `copy.ts`/`severity-badge.ts` helpers. I extended them rather than forking
  a parallel set, since the task explicitly asked to reuse
  `app-severity-badge`. The one new CSS rule (`.badge-critical`) reuses
  existing tokens only (`var(--accent)`, `#fff`), the same combination
  `.btn-primary` already uses, so it does not introduce a new visual
  language.
