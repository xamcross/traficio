# GeoStrategy — "One Thing" (direction 1c) Design Specification

**Date:** 2026-08-16
**Status:** Approved for implementation planning
**Supersedes:** §6 and §8 of `2026-08-04-geostrategy-design.md`. All other sections of that spec stay in force.
**Source mockups:** `docs/GeoStrategy design directions/GeoStrategy 1c One Thing.dc.html` (screens 01–03) and `GeoStrategy 1c Remaining Screens.dc.html` (screens 04–07).

## 1. Overview

Direction 1c changes two things.

1. **The tier model.** The Free tier runs a real check and shows a real result: the overall score, the three sub-scores, a summary, and every finding in plain language. The Free tier does not show the fix. The step-by-step plan, the done-check, task tracking, re-checks, auto-verification, and score history are Pro. The paywall sits at the moment of highest intent: the owner has just read the problem and wants the fix.
2. **The visual design.** The SPA gets a full visual system (palette, type, layout) and a new information architecture around one site and one task ("Do this next").

The gate is honest. A Free user sees the title, the impact, the step count, and the effort of every task before they pay. Nothing is teased that does not exist: the pipeline still writes the plan for a Free user, so the plan unlocks at once after payment.

**Decisions made in the design session (2026-08-16):**

- Account deletion is deferred. The Account page has no "Delete my account" link.
- The price label is `$9` a month. It lives in one constant. Freemius holds the real price.
- Finding areas map from `category`: `seo` → "Google search", `aeo` → "Answer boxes", `geo` → "AI assistants". No new schema field.
- Positive findings exist: severity `good`, at most two per report.
- Backend gate: one tier-aware plan endpoint that redacts for Free (approach A1).
- Home: a new site-home route `/sites/:siteId` (approach B1).

## 2. Tier model (replaces spec §6)

| | Free | Pro |
|---|---|---|
| Sites | 1 | 5 |
| Checks per 30 days | 1 | 10 |
| Overall score, three sub-scores, summary sentence, score notes | ✅ | ✅ |
| Findings in plain language | ✅ | ✅ |
| Plan preview: task title, impact, effort minutes, step count | ✅ (locked) | ✅ |
| Task steps, "why it matters", done-check | ❌ | ✅ |
| Task tracking (mark done) | ❌ | ✅ |
| Re-check, auto-verification, score history | ❌ | ✅ |

Rules:

- Limits stay configuration values (`FREE_MAX_SITES`, `FREE_ASSESSMENTS_PER_MONTH`, `PRO_MAX_SITES`, `PRO_ASSESSMENTS_PER_MONTH`).
- The pipeline writes the plan for every ready assessment, Free or Pro. Cost per assessment does not change.
- A failed assessment does not consume quota (unchanged).
- On downgrade the user drops to Free limits. Sites over the Free limit become read-only (unchanged). Every plan of a Free user is locked, including plans that were unlocked before the downgrade. Task statuses stay stored.

## 3. Backend contract changes

### 3.1 Analysis schema and prompts

`backend/src/main/resources/schemas/analysis.json` changes:

- Add `summary` (string, required). One or two sentences. Says what the scores mean for this site. Names the strongest area and the weakest area.
- Add `scoreNotes` (object, required) with `seo`, `aeo`, `geo` (string each, required). One short sentence per area.
- Extend `findings[].severity` enum to `["high", "medium", "low", "good"]`.

Example of the new fields:

```json
{
  "scores": { "seo": 62, "aeo": 34, "geo": 28 },
  "summary": "People searching Google for a bakery in Riverton can find you. People asking ChatGPT or Perplexity cannot.",
  "scoreNotes": {
    "seo": "Indexed and titled well enough to rank.",
    "aeo": "Rarely pulled into the box at the top of results.",
    "geo": "Assistants have to guess your address and hours."
  },
  "findings": [ ... ]
}
```

`prompts/analyze-system.txt` gains these rules:

- Write `summary` for the site owner. One or two short sentences. Say what the scores mean for this site. Name the strongest area and the weakest area.
- Write one short sentence for each area in `scoreNotes`.
- Add at most two findings with severity `good` for things that are already right. Their `evidence` says what is right and ends with "Nothing to do here."

`prompts/plan-system.txt` gains: "Do not create a task for a finding with severity good." The pipeline also removes `good` findings from the input of the plan call, so the rule holds even when the model ignores it.

The canned client fixtures gain the new fields and one `good` finding. The schema tests check the fixtures against the schema.

Kotlin model changes (`claude/Model.kt`): `AnalysisResult` gains `summary: String` and `scoreNotes: ScoreNotes`. `Finding` is unchanged. Old assessment documents in Mongo have no `summary`; the codec must decode them with `null` (nullable fields with defaults on the storage model, or a separate storage model — the plan decides).

### 3.2 Overall score

`overall = round((seo + aeo + geo) / 3)`, half up, integer 0–100. Example: 62, 34, 28 → 41.

- The server computes it. It is a derived value on `Scores`. The server never reads it from the database. Stored documents do not change.
- Every JSON `scores` object in the API carries `overall` (assessment DTO, site `latestScores`, history list).

### 3.3 Assessment DTO

`AssessmentDto` gains:

- `summary: String?`
- `scoreNotes: { seo, aeo, geo }?`
- `scores.overall: Int` (see 3.2)
- `pageCount: Int?` — the number of pages in the crawl digest. `null` before the crawl finishes.

The new fields are `null` on assessments created before this change and on assessments that are not ready (except `pageCount`, which is set as soon as the crawl is saved).

### 3.4 Site DTO

`SiteDto` gains two fields:

- `latestAssessment: { id, status, createdAt, completedAt } | null` — the newest assessment of the site by `createdAt`, any status.
- `latestReadyAssessmentId: String | null` — the newest assessment with status `ready`.

`GET /v1/sites` fills both for every site (two queries per site; the cap is 5 sites). The site home routes on these fields. They replace the current workaround where the dashboard finds the latest assessment through the plan endpoint, which the gate now redacts.

### 3.5 Plan endpoints (approach A1)

`GET /v1/assessments/{id}/plan` and `GET /v1/sites/{siteId}/plan`:

- Pro user → the full plan, `locked: false`.
- Free user → the locked plan, `locked: true`. Each task keeps `taskId`, `title`, `category`, `impact`, `effortMinutes`, `stepCount`, `status`. `whyItMatters`, `steps`, and `doneCheck` are `null`.
- `progress` is real in both cases (a downgraded user keeps the stored statuses).

`PlanDto`:

```json
{
  "id": "...", "assessmentId": "...", "siteId": "...",
  "locked": true,
  "tasks": [
    { "taskId": "...", "title": "Put your address and hours where machines can read them",
      "category": "geo", "impact": "high", "effortMinutes": 20, "stepCount": 4,
      "whyItMatters": null, "steps": null, "doneCheck": null, "status": "todo" }
  ],
  "progress": { "done": 0, "verified": 0, "total": 8 }
}
```

`PATCH /v1/plans/{planId}/tasks/{taskId}`:

- Free user → `403 upgrade_required`, message: "The step-by-step plan is part of Pro. Upgrade to unlock it."
- Order of checks: ownership first, then tier, then body validation. A plan of another user is `404` for every tier. A Free user's own plan is `403`.

### 3.6 History (`GET /v1/sites/{siteId}/assessments`, Pro only, unchanged gate)

Each list item gains `changes: [{ "title": String, "kind": "done" | "verified" }]`.

Rule for a ready assessment N: take every task of every plan of this site whose `completedAt` is after the `completedAt` of the previous ready assessment of the site and not after the `completedAt` of N. When N is the first ready assessment, the lower bound is open. Failed and running assessments get `changes: []`. The server loads the site's plans once and computes all items in one pass. Order inside `changes`: by `completedAt` ascending.

Notes:

- Auto-verification marks tasks in the previous plan during the pipeline of N, before `markReady`, so those tasks fall in N's window.
- Tasks the user marks done after the last check show in the next check's row.

### 3.7 Usage (`GET /v1/me/usage`)

`UsageDto` gains `nextCheckAt: String | null` (ISO-8601 instant). Rule: when `assessmentsUsed >= assessmentsLimit`, `nextCheckAt` = `createdAt` of the oldest counted assessment (non-failed, inside the rolling 30-day window) plus 30 days. Otherwise `null`. It uses the same query as the quota gate, so the meter and the gate never disagree.

### 3.8 Unchanged

Auth, sessions, Google sign-in, sites create/list, assessment submission gates, SSE contract (`{"status": ...}` frames, six status values), crawler, job worker, Freemius webhook and revalidator, emails, error envelope.

## 4. Frontend information architecture

### 4.1 Routes

| Route | Guard | Screen |
|---|---|---|
| `/` | — | Landing (screen 04) |
| `/pricing` | — | Price cards. With `?site=<id>` and a signed-in Free user whose site has a ready check: the plan gate (screen 02). |
| `/login`, `/signup`, `/verify-email`, `/auth/complete`, `/reset-password`, `/reset-password/confirm` | as today | Auth forms, plain style |
| `/terms`, `/privacy` | — | Legal text, plain style |
| `/dashboard` | auth | 0 sites: add-site form. Exactly 1 site: redirect to `/sites/:id`. 2+ sites: compact site list + add-site form. Consumes the pending landing URL first (see 5.1). |
| `/sites/:siteId` | auth | Site home (screens 01 and 03), see 4.2 |
| `/assessments/:id/progress` | auth | Check running / check failed (screen 05) |
| `/assessments/:id/report` | auth | Full result, both tiers |
| `/assessments/:id/plan` | auth | Pro: full checklist. Free: redirect to `/pricing?site=<siteId>`. |
| `/sites/:siteId/history` | auth | Pro: score history (screen 06). Free: redirect to `/pricing?site=<siteId>`. |
| `/account` | auth | Account (screen 07) |
| `**` | — | redirect to `/` |

Guards stay as today (`authGuard`, `guestGuard`). Tier redirects happen inside the components after the first API answer, and also on any `upgrade_required` API error (see 5.6).

### 4.2 Site home `/sites/:siteId`

The component loads the site (from `GET /v1/sites`) and branches on `latestAssessment`:

| State | What shows |
|---|---|
| `latestAssessment` is `null` | "Run your first check" panel: domain, one sentence, button "Check my site". Unverified email: the button is disabled with the confirm-email note and a "Send it again" action. |
| status `queued`, `crawling`, `analyzing`, `planning` | Redirect to `/assessments/:id/progress`. |
| status `failed` and `latestReadyAssessmentId` is `null` | Failure panel (same content as the failed state of screen 05) with "Try again". |
| status `failed` and `latestReadyAssessmentId` is set | The view for `latestReadyAssessmentId` (Free: result view; Pro: next-task view), plus a note at the top: "Your last check on {date} did not finish. {errorMessage}" with "Try again". |
| status `ready`, Free | **Result view** (screen 01) with the "NEXT" teaser (4.3). |
| status `ready`, Pro | **Next-task view** (screen 03) (4.4). |

The component reads the assessment with `GET /v1/assessments/{id}` and the plan with `GET /v1/assessments/{id}/plan`. Both work for both tiers. The Pro view also reads the history list for the delta line.

### 4.3 Result view (screen 01) — used by the site home (Free) and `/assessments/:id/report` (both tiers)

Layout, top to bottom, inside a 1080 px surface:

1. Header row (see 4.9).
2. Two columns. Left, 400 px: eyebrow "CHECKED {d MMMM yyyy}" (from `completedAt`), the overall number (92 px), the band label and "Visibility out of 100", a bar (`overall`%), then `summary`. Right: three rows, one per area — area name and code (Google search / SEO, Answer boxes / AEO, AI assistants / GEO), a 130 px bar, the number, the `scoreNote`.
3. "What we found" with "{n} things, across {areas} areas" (n = all findings including `good`; areas = distinct categories). Rows: severity badge, `evidence`, then a mono caption "{AREA} · {pages}". `pages` rule, with k = `affectedPages.length`: "AFFECTS EVERY PAGE" when k = 0 or k ≥ `pageCount`; "1 PAGE" when k = 1; "{k} PAGES" otherwise. Sort: high, medium, low, good. Empty findings: "We found nothing to fix. Check again after your next change." (Pro) / "We found nothing to fix." (Free).
4. Free only — the **NEXT teaser** card. Eyebrow "NEXT". Heading "We wrote you {N words} things to fix, in order." Text "Each one is a short set of steps you can follow yourself, with a way to check it worked. About {effort} of work in total. The first one alone should move your score the most." Button "Read my plan" → `/pricing?site=<siteId>`. Caption "Included with Pro, from $9 a month". Right: a locked list "YOUR PLAN · {N} TASKS / LOCKED": the first task with a "BIGGEST WIN" badge and "{stepCount} steps · {effortMinutes} min", the second and third task with minutes, then a muted row "{N−3} more" when N > 3.
5. Pro only, on the report route — a link row "Do this next →" to the site home and "See all {N} tasks" to the plan.

Number words: 1–12 as words ("eight"), 13 and above as digits.

Effort text: sum of `effortMinutes` over `todo` tasks. Under 90 minutes: "about {m} minutes". Otherwise: "about {h} hours" with h = round(m/60), and "about 1 hour" for h = 1.

### 4.4 Next-task view (screen 03) — Pro site home

1. Header row.
2. Score strip on `#fbf2e5`: overall "41" + "of 100", a divider, band label + delta line, then the three sub-score numbers with labels, then "Full report →" (`/assessments/:id/report`) and "Check again" (submits a new assessment; disabled while any assessment of the site runs).
   - Delta line: "Up {d} points since your last check" / "Down {d} points since your last check" / "Same as your last check". It needs the previous ready assessment from the history list. On the first check the line is empty.
3. "DO THIS NEXT" eyebrow, "{done} of {N} done · about {effort} left", "See all {N}" (`/assessments/:id/plan`). `done` counts `done` + `verified`.
4. The task card for the **next task**: badges ("BIGGEST WIN" only when the task is the first task of the plan; "About {m} minutes"; area name), the title (31 px), `whyItMatters`, numbered `steps`, a note box "HOW YOU KNOW IT WORKED" with `doneCheck`, then buttons "I did this" (PATCH `done`) and "Skip for now".
5. "THEN" list: the next three `todo` tasks after the current one, each with minutes, then "{rest} more, smaller" → "{rest} more" when rest > 0.
6. All-done state (no `todo` task left): the card says "You have done everything on your plan." with "Check again to see your new score and to confirm your fixes." and the "Check again" button.

**Next task selection**: the first task with status `todo` in plan order, minus the tasks skipped in this browser session. Skips live in `sessionStorage` under `geostrategy.skipped.<planId>`. When every `todo` task is skipped, the set clears and the first `todo` task shows again. Skips are never sent to the server.

### 4.5 Plan gate (screen 02) — `/pricing?site=<id>` for a signed-in Free user with a ready check

- Header: brand, then "← Back to my result" (`/sites/:id`).
- Eyebrow "YOUR PLAN IS READY". Heading "{N words} things to fix, written for your site." Text: "Your score and your findings stay free, always. The step-by-step plan, the check that confirms each fix worked, and your score history are part of Pro."
- Two cards. **Free** (badge "YOUR PLAN NOW", $0): ✓ One site, one check each month · ✓ Your visibility score and the three sub-scores · ✓ Every problem we found, in plain language · — No step-by-step plan · — No progress tracking or history. Button "Stay on Free" → back to the site home. **Pro** (badge "UNLOCKS YOUR PLAN", "$9 a month · cancel any time", rust border): ✓ **All {N words} tasks with their steps**, in the order that helps most first · ✓ A way to check each fix actually worked · ✓ We re-check your site and confirm your fixes for you · ✓ Five sites, ten checks each month · ✓ Score history, so you can see it working. Button "Unlock my plan" (5.5). Caption "Your plan is already written and waiting."
- "WHAT IS WAITING FOR YOU": rows 01–03 with title, "{stepCount} steps · {effortMinutes} minutes" (row 01 adds " · biggest single win"), impact badge, "LOCKED". Row 04: "and {N−3} more" when N > 3.
- The limit numbers in the card lines ("One site, one check each month", "Five sites, ten checks each month") come from constants in `core/config.ts` (`FREE_TIER_COPY`, `PRO_TIER_COPY`). The launch checklist gains a line to keep them equal to the backend env values.

**Public pricing** (signed out, or no `?site=`, or Pro user): eyebrow "PRICING", heading "Your score is free. The plan is $9 a month.", the same two cards. Free button: "Check my site free" → `/` (signed out) or `/dashboard` (signed in). Pro button: signed out → `/signup` (the pending checkout returns the user to `/pricing` after login); Free signed in → checkout; Pro signed in → the Pro card shows "Your plan" and a "Manage subscription" link to `FREEMIUS_PORTAL_URL`. No "WHAT IS WAITING FOR YOU" list.

### 4.6 Landing (screen 04)

- Header: brand, "Pricing", "Log in", black button "Check my site" (scrolls to the form).
- Hero: eyebrow "FOR PEOPLE WHO RUN ONE WEBSITE", h1 "Your customers ask AI. Does it know you exist?", text "People used to search. Now they ask ChatGPT for a bakery near them, and it answers with somebody. We check whether that somebody is you, and tell you what to fix.", input placeholder "yourbusiness.com", button "Check my site free", caption "Two minutes. No card. Your score and every problem, free."
- Three columns 01–03: "You give us your web address" / "We read it the way machines do" / "You fix one thing at a time" with the mockup text.
- "WHAT YOU GET FREE" card: "Your score and every problem we find. No card, no trial clock." + "The step-by-step plan that fixes them is $9 a month. You will know exactly what is in it before you decide." Right: a static example (41 Needs work, bar, Google 62 / Answers 34 / AI 28) with the mono caption "EXAMPLE RESULT, FREE TIER". The caption says "example" and not "real", because it is static.
- Footer: brand, Pricing, Terms, Privacy.
- Submit: stores the URL under `PENDING_URL_KEY`, then navigates to `/signup` (signed out) or `/dashboard` (signed in). Unchanged behaviour.

### 4.7 Progress (screen 05)

Rail with four steps. Each step has an active label and a done label:

| Status | Active label | Done label |
|---|---|---|
| `queued` | Finding your site | Found your site |
| `crawling` | Reading your pages | Read your pages |
| `analyzing` | Checking how findable you are | Checked how findable you are |
| `planning` | Writing your plan | Wrote your plan |

- Headline: the active label + "…". Text: "You can close this tab. We will email you when your result is ready."
- Done steps: filled rust circle with ✓ and the done label. Active: rust ring, bold. Later: faint ring, faint text.
- No page counts. The SSE contract does not change.
- Footer caption in mono: "QUEUED → CRAWLING → ANALYZING → PLANNING" (static).
- On `ready`: navigate to `/sites/:siteId`.
- On `failed`: the same page shows the failure state: eyebrow "WE COULD NOT FINISH", headline by code (below), the backend `errorMessage` verbatim, a note box "GOOD NEWS" with "Your free check this month was not used." (Free) or "This check did not count against your monthly checks." (Pro), buttons "Try again" (submits a new assessment) and "Back to my site" (`/sites/:siteId`).

Headline by `errorCode`:

| Code | Headline |
|---|---|
| `robots_blocked` | Your site would not let us read it. |
| `js_only_site` | Your site needs JavaScript to show its content. |
| `site_unreachable`, `invalid_url` | We could not reach your site. |
| `assessment_failed` | Something went wrong on our side. |
| any other | We could not finish the check. |

The retry policy and destroy guards of the current progress component stay.

### 4.8 History (screen 06), plan checklist, account, dashboard list

**History** (Pro):

- Headline and sentence, derived from ready assessments only:
  - Fewer than 2 ready: "One check so far." + "Fix a task, then check again to see the change."
  - Latest overall > first overall: "It is working." + "You have gone from {first} to {latest} since {MMMM}. {Area} has moved the most." Area = the sub-score with the largest positive change since the first check.
  - Otherwise: "Not moving yet." + "Your score is {latest}. It was {first} in {MMMM}. Finish the next task and check again."
- "Check again" button (right).
- Trend chart card: legend (Google search olive, Answer boxes rust, AI assistants amber), a mono range caption "{MMM} – {MMM yyyy}", an SVG line chart of the three sub-scores over ready assessments, end labels with the latest numbers, month labels on the x-axis. Coordinates rounded to one decimal.
- Table: DATE · OVERALL · GOOGLE · ANSWERS · AI · WHAT CHANGED. Newest first. Failed rows are muted with "—" in the score cells and "We could not read your site that day". The first ready row says "Your first check". Other ready rows render `changes`:
  - 0 items: "No changes since your last check"
  - 1 item, `verified`: "Confirmed fixed: {title}"; 1 item, `done`: "{title}"
  - 2+ items: "{v} tasks confirmed fixed" / "{d} tasks done" / "{d} tasks done, {v} confirmed fixed" (numbers as words up to 12).

**Plan checklist** `/assessments/:id/plan` (Pro): "Your plan" heading, progress bar and "{done} of {N} done · about {effort} left", then every task as a row: checkbox ("Done" / "Checked by us" for `verified`, disabled), title, area, impact badge, minutes, an expand `<button>` that reveals `whyItMatters`, the numbered steps, and "HOW YOU KNOW IT WORKED". Busy rules stay (all checkboxes disabled while a PATCH is in flight). "← Do this next" link to the site home.

**Account** (screen 07): "Your account", the email. Unverified: a card "Confirm your email address" + "We sent a link to {email}. Until you click it we cannot run checks for you." + "Send it again". "THIS MONTH": "Checks used {used} of {limit}" with a bar and, when `nextCheckAt` is set, "Your next free check is available on {d MMMM}." (Free) / "Your next check is available on {d MMMM}." (Pro); "Sites {used} of {limit}" with a bar. "YOUR SITE" / "YOUR SITES": one card per site (domain, "{platform} · last checked {date}", overall) linking to the site home; Free adds "Pro lets you add {n words} more sites." Then "Log out". Right column: Free → an upgrade card ("YOUR PLAN IS WAITING", "$9 a month", text, four ✓ lines, "Unlock my plan", "Cancel any time. Your score stays free."); when the user has no ready check yet the card eyebrow reads "PRO" and the text reads "The step-by-step plan for your site, with the steps to do each one and a check that confirms it worked." Pro → a card "You are on Pro" with "Manage subscription" (`FREEMIUS_PORTAL_URL`, new tab).

**Dashboard list** (2+ sites): the same site cards as the Account page, plus "Read-only" pill and "Upgrade to work with this site" link on read-only sites, plus the add-site form when `sitesUsed < sitesLimit`. Site cards sort by `createdAt` ascending, the same order the read-only rule uses.

### 4.9 Header, footer, shell

- Signed out: brand "GEOSTRATEGY" (→ `/`), spacer, "Pricing", "Log in", black button "Check my site" (→ `/`).
- Signed in: brand (→ `/dashboard`), spacer, the current site domain on site-scoped routes (→ `/dashboard`), a tier pill ("Free plan" grey / "Pro" rust tint), "Account" (bold on `/account`), "Log out" as a plain text action in the Account page only.
- Footer (landing, pricing, legal): brand in faint ink, Pricing, Terms, Privacy.
- The shell keeps `UserStore` and the logout behaviour as today.

## 5. Behaviour rules

### 5.1 Pending URL flow

Unchanged: the landing form stores the URL; after signup/login the dashboard creates the site, then submits the first check (email must be verified first; the dashboard shows the confirm-email note when it is not), then navigates to progress.

### 5.2 Score bands

| Overall or sub-score | Label | Colour |
|---|---|---|
| 0–49 | Needs work | rust `#b4552f` |
| 50–79 | Getting there | amber `#8a6a2f` |
| 80–100 | Looking good | olive `#6b7d4f` |

The number, the bar, and the label use the band colour. Deviation from the mockup: the mockup paints 62 olive; this spec uses three consistent bands.

### 5.3 Severity and area labels

| Severity | Badge text | Colours |
|---|---|---|
| high | HIGH | rust on `#fbeae1` |
| medium | MED | amber on `#f7eed8` |
| low | LOW | muted `#7a6a58` on `#f3e9da` |
| good | FINE | olive `#5c7040` on `#eaf0e0`; the evidence text is muted |

Area from `category`: seo → "Google search", aeo → "Answer boxes", geo → "AI assistants". Impact badges reuse the severity colours (high/medium/low).

### 5.4 Dates and numbers

- Dates: "{d MMMM yyyy}" ("28 July 2026"); short: "{d MMMM}". Locale `en-GB` formatting through Angular's `DatePipe`.
- Numbers as words 1–12, digits above.

### 5.5 Upgrade flow

1. "Unlock my plan" opens the Freemius overlay with `product_id`, `public_key`, and the user's email. The current script loader, timeout, and `REPLACE_ME` guard stay.
2. On the overlay `success` callback the page shows "Unlocking your plan…" and polls `GET /v1/me` every 2 seconds for up to 60 seconds until `tier === 'pro'`. `UserStore` updates on success. Then it navigates to `/sites/:siteId` when a site is known, else `/dashboard`.
3. On timeout: "Your payment went through. Your plan unlocks in a minute. Refresh this page." with a "Refresh" button that calls `GET /v1/me` once more.
4. The `success` callback no longer calls `location.assign('/account')`.

### 5.6 Errors

- The API error envelope stays. `ApiError` stays.
- Any `upgrade_required` from `GET …/plan`, `PATCH …/tasks`, `GET …/assessments` (history), or `POST …/assessments` (re-check) navigates to `/pricing?site=<siteId>` when the site id is known, else `/pricing`.
- `assessmentErrorCopy` keeps its map; the `upgrade_required` copy becomes "Re-checks are part of Pro."
- All other errors render in the existing `app-error-note` with the new tokens.

### 5.7 Price label

`PRO_PRICE_LABEL = '$9'` in `core/config.ts`. Every price string in the app composes from it ("{PRO_PRICE_LABEL} a month"). Freemius holds the billed price; the launch checklist gains a line to keep the two equal.

## 6. Visual system

### 6.1 Tokens (`styles.css`, CSS custom properties)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#efe7db` | page background |
| `--surface` | `#fdf7ee` | app surface, header |
| `--card` | `#ffffff` | cards |
| `--card-soft` | `#fdfaf5` | locked list, quiet cards |
| `--strip` | `#fbf2e5` | Pro score strip |
| `--note` | `#fbf6ee` | note boxes |
| `--line` | `#f0e5d4` | row dividers |
| `--line-strong` | `#ecdfcc` | card borders |
| `--line-input` | `#e0cdb2` | input and outline-button borders |
| `--ink` | `#221c15` | headings, numbers |
| `--body` | `#4c4237` | body text (`#5c4f40` for long text) |
| `--muted` | `#7a6a58` | secondary text |
| `--faint` | `#a89478` | eyebrows, captions |
| `--faint-2` | `#b09a7e` | mono labels |
| `--faint-3` | `#cbb79a` | locked labels, dashes |
| `--accent` | `#b4552f` | rust: buttons, links, low band |
| `--accent-hover` | `#8e3f20` | |
| `--accent-tint` | `#fbeae1` | rust badges, Pro pill |
| `--olive` | `#6b7d4f` | high band, Google line |
| `--olive-tint` | `#eaf0e0` | FINE badge |
| `--amber` | `#8a6a2f` | mid band, AI line |
| `--amber-tint` | `#f7eed8` | MED badge |
| `--pill` | `#f3e9da` | Free pill, LOW badge |

### 6.2 Type

- Text: Libre Franklin 400, 500, 600, 700.
- Labels, eyebrows, codes: IBM Plex Mono 400, 500, letter-spacing 0.06–0.16 em, uppercase.
- Self-hosted through `@fontsource/libre-franklin` and `@fontsource/ibm-plex-mono` (npm). Import in `styles.css`. The app makes no request to Google Fonts.
- Sizes from the mockups: hero h1 54 px; page h1 32–36 px; overall number 92 px (result) / 30 px (strip) / 44 px (landing example); section h2 22 px; task title 31 px; body 15–17 px; captions 12–14 px; mono labels 10–13 px. Letter-spacing on large headings −0.025 to −0.045 em.

### 6.3 Shape and layout

- Radii: buttons 9 px, cards 14 px (small cards 10–12 px), badges 4–5 px, pills 999 px.
- Primary button: rust background, white text, 600 weight, 15–17 px, padding 15 × 28 px. Outline button: transparent, 1.5 px `--line-input` border. Text action: muted text, no border.
- Content max width 1080 px, side padding 44 px on desktop, 20 px under 760 px.
- Under 760 px every two-column block stacks: the result columns, the plan-gate cards, the teaser card, the account columns, the score strip (wraps to two rows). Tables scroll inside their own container.
- Focus ring: 2 px `--accent` outline with 2 px offset on every interactive element.

### 6.4 Accessibility

- Every control is a `<button>`, `<a>`, or a form control. Task expand is a `<button aria-expanded>`.
- Colour is never the only signal: bands carry a label, severity carries text, the progress rail carries text.
- Contrast: body text on surface passes 4.5:1. Faint tokens (`--faint-2`, `--faint-3`) are for decoration and for text that repeats information shown elsewhere.
- Charts carry `role="img"` and an `aria-label` sentence with the numbers.

### 6.5 Copy

Product copy comes from the mockups as written. Where a screen or state has no mockup copy, this spec gives the copy in §4. New copy keeps the same voice: short, warm, second person, no jargon.

## 7. Testing

**Backend**

- Plan redaction: Free gets `locked: true`, `steps === null`, `stepCount` set; Pro gets the full plan; PATCH by Free → 403 `upgrade_required`; another user's plan → 404 for both tiers.
- `overall` rounding (41 for 62/34/28; half-up case).
- `changes` derivation: first ready → empty; verified in window; done before the window excluded; failed → empty.
- `nextCheckAt`: null under the limit; oldest + 30 days at the limit.
- `latestAssessment` and `latestReadyAssessmentId` on the site list: null, running, failed, failed after ready, ready.
- `pageCount` on the assessment DTO: null before the crawl, set after.
- Schema: fixtures with `summary`, `scoreNotes`, one `good` finding pass `analysis.json`; the pipeline passes no `good` finding to `plan`; old assessment documents without `summary` decode.
- Existing suites stay green.

**Frontend (unit)**

- Site home: no check / running redirect / failed / Free result / Pro next-task.
- Next-task selection with statuses and session skips; all-done state.
- Gate redirects for `/plan` and `/history` on Free; `upgrade_required` navigation.
- Upgrade poll: success within the window; timeout copy.
- Result view: bands, severity order, "AFFECTS EVERY PAGE", number words, effort text.
- Progress rail labels per status; failure headline map.
- History: headline rules; "what changed" text rules.

**Playwright (mocked backend)**

- Path 1: sign up → add site → check → progress → Free result → "Read my plan" → gate.
- Path 2: mocked Pro → site home → "I did this" → the next task shows → "See all" → plan checklist.

## 8. Migration and compatibility

- No live users. No data migration.
- Old assessment documents without `summary` / `scoreNotes` decode with `null`; the frontend hides the missing sentence and notes.
- The current `Dashboard`, `Report`, `Plan`, `History`, `Account`, `Pricing`, `Landing`, `Progress` components are rewritten or heavily changed. Their specs are rewritten. The `ApiClient`, `UserStore`, guards, `AssessmentStream`, and the auth screens stay, with type updates.
- The launch checklist gains: set the Freemius price equal to `PRO_PRICE_LABEL`; keep `FREE_TIER_COPY` / `PRO_TIER_COPY` equal to the tier env values.

## 9. Out of scope

- Account deletion (deferred by decision).
- Server-side or persistent "skip".
- Page counts on the progress rail (needs a richer SSE contract).
- Annual price, more tiers, coupons.
- Dark mode, i18n, RTL.
- A per-finding plain-language area label from Claude.
- Headless rendering and the other v1 exclusions of the base spec.

## 10. Implementation split

One spec, two plans, in this order:

1. **Plan 5a — backend contract for One Thing** (§3, §7 backend). Schema and prompt changes, `overall`, DTO additions, plan redaction and PATCH gate, history `changes`, usage `nextCheckAt`, `latestAssessment`, canned fixtures, tests, README updates.
2. **Plan 5b — frontend One Thing** (§4–§6, §7 frontend and Playwright). Tokens and fonts, shell, landing, pricing and gate, dashboard, site home, result view, next-task view, progress, plan checklist, history, account, upgrade poll, e2e.

Plan 5b depends on Plan 5a. The frontend types update first in 5b from the 5a contract.
