# GeoStrategy — Design Specification

**Date:** 2026-08-04
**Status:** Approved for implementation planning

## 1. Overview

GeoStrategy is a freemium SaaS web application. A user enters the URL of their website; the server crawls it, has Claude (Anthropic API) assess it for **SEO** (search engine optimization), **AEO** (answer engine optimization), and **GEO** (generative engine optimization), and produces a **trackable, step-by-step action plan written for a complete beginner** — someone with no software or web-development skills. Users check off tasks as they complete them and (on the paid tier) re-run assessments to measure progress.

**Target audience:** non-technical site owners (small businesses, solo founders, creators) running sites on platforms like WordPress, Wix, Squarespace, Shopify, or Webflow. Every piece of user-facing text — findings, task titles, instructions — must be understandable by a low-skill reader: no undefined jargon, one action per step, "where to click" instructions tailored to their platform.

**Tech stack (fixed):** Angular (frontend), Kotlin (backend), MongoDB Atlas (database), Cloudflare (CDN/DNS/WAF), Fly.io (backend hosting), Anthropic Claude API (assessment engine), Freemius (billing, merchant of record).

## 2. Architecture

A **modular Kotlin monolith** — one deployable backend that serves the REST API and runs assessment jobs in-process.

```
Browser (Angular SPA)
   │  HTTPS (REST + SSE)
   ▼
Cloudflare  ── Pages (SPA hosting) + DNS/TLS/WAF/rate limiting for api.*
   │  proxied
   ▼
Fly.io: Kotlin (Ktor) app ──────────────► Anthropic API (Claude Opus 5)
   │        modules: api, assessment,     ► Freemius API (license validation)
   │        billing, auth, persistence    ◄ Freemius webhooks
   ▼                                      ► Email provider (SMTP API)
MongoDB Atlas (users, sites, assessments, plans, jobs, sessions)
```

- **Frontend:** Angular 19+ SPA (standalone components, signals, lazy-loaded routes), deployed to **Cloudflare Pages**. Communicates with the backend via REST; live assessment progress arrives over **Server-Sent Events**.
- **Backend:** Kotlin + **Ktor** (coroutine-native; a good fit for an API plus long-running async jobs), packaged as a Docker image on **Fly.io** (1–2 shared-CPU machines at launch, same region as the database). Internal modules with strict boundaries: `api` (REST controllers), `assessment` (crawler + Claude pipeline + job worker), `billing` (Freemius), `auth`, `persistence`.
- **Job execution:** the `assessment` module talks to the rest of the system only through the `jobs` collection (a MongoDB-backed queue). This makes it promotable to a separate Fly.io worker app later without a rewrite.
- **Database:** MongoDB Atlas (M0 to start; M10 upgrade path), co-located with the Fly.io region.
- **Cloudflare in front of the API:** the API domain (`api.<domain>`) is proxied through Cloudflare for DNS, TLS, WAF, bot fighting, and edge rate-limiting rules — the first line of defense for the expensive assessment endpoint.
- **Anthropic API:** server-side only, official Anthropic **Java SDK** (Kotlin-compatible). API key stored in Fly.io secrets; never exposed to the frontend.
- **Email:** transactional email (verification, password reset, "your plan is ready") via **Resend**, behind a thin `EmailSender` interface so the provider is swappable.

## 3. Assessment Pipeline

The flow per submission: **validate → crawl → analyze (Claude) → plan (Claude) → deliver**, executed as a background job with progress statuses `queued → crawling → analyzing → planning → ready` (or `failed`) streamed to the browser via SSE.

### 3.1 Submission & validation

- Normalize the URL; resolve DNS and **reject private/internal IP ranges (SSRF protection)**; confirm the site responds.
- Check the user's quota (see §6). Create an `assessment` document (status `queued`) and enqueue a job. Return the assessment ID immediately; the frontend subscribes to SSE progress.

### 3.2 Crawl

No headless browser in v1 — plain HTTP fetching with an honest User-Agent.

- Respect `robots.txt`. Fetch the homepage, `sitemap.xml`, `robots.txt`, `llms.txt` (a GEO signal), and check 404 behavior and HTTPS.
- Discover and fetch up to **~15 same-domain pages**, prioritized: homepage, top-navigation pages, then a few content pages from the sitemap.
- Per page, extract a **compact signal digest** (not full HTML): title, meta description, heading structure, canonical link, Open Graph tags, schema.org JSON-LD, robots meta, hreflang, image alt coverage, word count, internal/external links.
- **Platform fingerprinting:** detect WordPress, Wix, Squarespace, Shopify, Webflow, or custom via HTML fingerprints (generator meta tags, asset URL patterns). This drives platform-specific instructions in the plan.
- Budgets: ~90 seconds total crawl time, 2 MB per page, polite request pacing.
- **JS-only sites:** if pages render essentially nothing without JavaScript, detect this and fail the assessment honestly with an explanation of why and what the user can do. (Headless rendering is a v2 candidate.)

### 3.3 Claude call #1 — Analysis

- Model: **Claude Opus 5** (`claude-opus-5`), via the official Java SDK; streaming enabled; default adaptive thinking.
- Input: the site-level facts + per-page digests, formatted as a structured document.
- Output: constrained by **structured outputs** (`output_config.format` with a JSON schema) — guaranteed-parseable JSON. Schema: three 0–100 scores (`seo`, `aeo`, `geo`), plus a `findings` array (id, category, severity, plain-language evidence, affected pages).

### 3.4 Claude call #2 — Plan generation

- Input: the findings, the detected platform, and the beginner-audience framing.
- Output (schema-constrained): an ordered task list (~15–30 tasks). Each task: plain-language `title`, `category` (SEO/AEO/GEO), `impact` (high/medium/low), `effortMinutes`, `whyItMatters` (beginner explanation), `steps[]` (numbered, platform-specific — e.g. "In WordPress, click **Settings**, then…"), and `doneCheck` ("how you'll know it worked").
- The system prompt enforces the beginner voice: explain like to a smart 10-year-old, define every term on first use, one action per step. The static system prompt uses **prompt caching** to reduce input cost on every run.

### 3.5 Cost model

Estimated **$0.30–0.75 per assessment** at Opus 5 pricing ($5/$25 per MTok): ~20–50K input tokens across both calls, ~8K output tokens. Per-assessment token usage and computed cost are recorded on the assessment document (telemetry, §9). Free-tier quotas exist to bound this cost.

### 3.6 Re-assessment (Pro)

Re-runs the pipeline for the same site, stores a new assessment, compares scores over time, and **auto-verifies** tasks whose fix is machine-checkable from the new crawl (e.g. "meta description now present" → task status `verified`).

## 4. Data Model (MongoDB)

All documents carry `createdAt` / `updatedAt`.

| Collection | Key fields |
|---|---|
| `users` | `email`, `passwordHash` (argon2id, null for Google-only), `googleId`, `emailVerified`, `tier` (`free` \| `pro`), embedded `freemius` {userId, licenseId, planId, subscriptionStatus, expiresAt}, monthly usage counters {assessmentsUsed, periodStart} |
| `sites` | `userId`, normalized `domain`, detected `platform`, latest scores snapshot |
| `assessments` | `siteId`, `userId`, `status`, progress stage, crawl digest, `scores` {seo, aeo, geo}, `findings[]`, token/cost telemetry, error details on failure |
| `plans` | `assessmentId`, `siteId`, embedded `tasks[]`: {taskId, title, category, impact, effortMinutes, whyItMatters, steps[], doneCheck, `status` (todo \| done \| verified), completedAt} |
| `jobs` | `type`, `payload`, `status` (queued \| running \| done \| failed), `attempts`, `leasedUntil` — the worker claims jobs atomically with `findOneAndUpdate`; expired leases make crashed machines' jobs re-claimable |
| `sessions` | server-side session records (httpOnly cookie holds the session ID) |
| `tokens` | email-verification and password-reset tokens (hashed, expiring) |

Indexes: unique on `users.email`, `sites.userId+domain`; `jobs.status+leasedUntil` for the worker poll; `assessments.siteId+createdAt` for history.

## 5. Authentication

- **Email/password:** argon2id hashing; email verification required before the first assessment runs; standard password-reset flow via emailed token.
- **Google sign-in:** OIDC authorization-code flow handled by the backend (no tokens in frontend JS). Accounts link by verified email.
- **Sessions:** httpOnly, Secure session cookie scoped to the parent domain (`.{domain}`), so the SPA on `app.` calls `api.` without storing tokens in JavaScript. Server-side session store in MongoDB; sliding expiry.

## 6. Tiers & Quotas

Limits are configuration values, not code constants.

| | Free | Pro (paid) |
|---|---|---|
| Sites | 1 | 5 |
| Full assessments / month | 1 | 10 |
| Complete plan + task tracking | ✅ | ✅ |
| Re-assessments + auto-verification | ❌ | ✅ |
| Score history over time | ❌ | ✅ |

- Quotas are enforced **server-side at submission**; counters reset monthly (rolling from `periodStart`).
- **A failed assessment does not consume quota** — quota is decremented only when an assessment reaches `ready`.

## 7. Billing — Freemius (v1)

Freemius is the **merchant of record** (handles payment processing, VAT/sales tax, invoices). The Pro plan and its price are defined in the Freemius dashboard, not in our code — the app only knows plan IDs.

1. **Checkout:** the pricing page opens the Freemius Checkout JS overlay with the Pro plan ID, pre-filled with the user's email. No card data touches our stack.
2. **Webhooks:** Freemius calls our webhook endpoint on `license.created`, `subscription.cancelled`, `payment.refund`, and related events. The backend **verifies the webhook signature**, matches the Freemius user to our account by email, and updates `tier`, license IDs, and expiry.
3. **Drift safety net:** a daily job re-validates active licenses against the Freemius API and downgrades expired ones.
4. **Self-service:** a "Manage subscription" link in Account opens the Freemius customer portal (cancel, update payment method, invoices).
5. **Downgrade behavior:** on expiry/cancellation the user drops to Free limits; existing sites/plans beyond the Free limit become read-only (visible, not assessable) rather than deleted.

## 8. Frontend (Angular)

- **Public:** landing page with a URL input as the hook (submitting prompts signup), pricing page, login/signup, legal pages.
- **Dashboard:** the user's sites with latest SEO/AEO/GEO scores.
- **Assessment progress:** live SSE-driven screen narrating the 2–4 minute run ("Reading your homepage… found 12 pages… writing your plan…") instead of a spinner.
- **Report view:** three score dials + a plain-language summary of what they mean for this site.
- **Plan view (core screen):** checklist ordered by impact; each task expands to *why it matters*, numbered platform-specific steps, and the done-check. Checking off tasks updates a progress bar and persists immediately.
- **Site history (Pro):** score trend chart across assessments.
- **Account:** profile, usage meter, Freemius portal link.
- Angular practices: standalone components, signals for state, lazy-loaded feature routes, a thin typed API client layer generated from the backend's response contracts.

## 9. Error Handling & Operations

- **Crawl failures** (unreachable site, robots.txt disallows, JS-only rendering): fail fast with a human-readable reason and suggestion; quota not consumed.
- **Pipeline resilience:** stages are idempotent and checkpointed — the crawl digest is persisted before analysis, so retries and deploy-interrupted jobs resume without re-crawling. Jobs get 2 attempts (lease-based recovery), then fail visibly with a stored error.
- **Claude API:** the SDK auto-retries 429/5xx with backoff; structured outputs remove JSON-parse failure as a class of error; a content refusal (`stop_reason: "refusal"`, rare in this domain) marks the assessment failed gracefully without quota loss; `max_tokens` sized with headroom.
- **API contract:** consistent JSON error envelope (machine `code`, human `message`) across all endpoints.
- **Abuse protection:** Cloudflare WAF + edge rate limiting on auth and submission endpoints; per-user app-level rate limits; assessment endpoint requires a verified email.
- **Observability:** structured JSON logs; per-assessment telemetry (duration per stage, token counts, computed cost); a simple ops dashboard query for failure rate and daily Claude spend.

## 10. Testing

- **Backend unit tests:** crawler signal extraction and platform fingerprinting against saved HTML fixtures; quota logic; Freemius webhook signature verification.
- **Backend integration tests:** Testcontainers-MongoDB; full job lifecycle (enqueue → lease → checkpoint → resume) with a **fake Anthropic client** returning recorded fixtures — the live API is never called in CI.
- **Schemas as contracts:** the structured-output JSON schemas live as versioned files in the repo; tests validate that recorded Claude fixtures satisfy them and that the frontend's TypeScript types match.
- **Frontend:** component tests for plan/report rendering; one Playwright happy path: sign up → submit URL (mocked backend) → progress → open plan → check off a task.
- **Prompt QA (manual):** an eval set of ~10 real sites (varying quality and platforms) run before any prompt change; reviewers check score sanity and that plan text passes a beginner-readability bar.

## 11. Out of Scope for v1 (explicit)

- Headless-browser rendering of JS-only sites
- Third-party data integrations (Google Search Console, PageSpeed, keyword/SERP APIs)
- PDF export of reports/plans
- Scheduled automatic re-assessments
- Team/multi-user accounts, white-labeling
- Additional paid tiers beyond Free/Pro (structure supports adding them)
