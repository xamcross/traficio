# One Thing — Frontend (Plan 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Angular SPA around the "One Thing" direction: a warm visual system, a site home with a Free result view and a Pro next-task view, a plan gate, and redesigned progress, plan, history, account, landing, and pricing screens.

**Architecture:** Angular 20 standalone components with signals and lazy routes stay. New pure helpers (`shared/copy.ts`, `features/history/history-copy.ts`) hold every text and number rule so they are unit-tested without the DOM. A `SiteContext` signal service feeds the header. A `ResultView` component is shared by the site home (Free) and the report route. The typed `ApiClient` gains no new endpoints; only the types change (Plan 5a contract).

**Tech Stack:** Angular 20.3, TypeScript 5.9, signals, Reactive Forms, Karma + Jasmine (ChromeHeadless or Edge through `CHROME_BIN`), Playwright 1.62, `@fontsource/libre-franklin`, `@fontsource/ibm-plex-mono`.

**Spec:** `docs/superpowers/specs/2026-08-16-one-thing-design.md` (sections 4, 5, 6, 7 frontend, 8, 10). Read it before you start. Plan 5a (`2026-08-16-one-thing-backend.md`) must be merged first: this plan consumes its DTO fields.

## Global Constraints

- Prose you write (comments, README, commit bodies) follows ASD-STE100. Product copy in templates comes from the spec verbatim; the spec text wins over style rules.
- Commit subjects: `feat(frontend): …`, `fix(frontend): …`, `test(frontend): …`, `docs: …`.
- Commands run from `frontend/`. Unit tests: `npm test -- --watch=false --browsers=ChromeHeadless` (on a machine without Chrome: `CHROME_BIN="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"` before the command). Build: `npx ng build`. E2E: `npm run e2e`.
- Every task ends with the unit suite green, `npx ng build` green, and a commit. Component styles must stay under the 4 kB warning budget; put shared rules in `src/styles.css`.
- Colours only through the CSS custom properties of §6.1. Fonts only through the two `@fontsource` packages. No request to Google Fonts.
- Price strings compose from `PRO_PRICE_LABEL`. Tier numbers in copy compose from `FREE_TIER_COPY` / `PRO_TIER_COPY`.
- Every interactive element is a `<button>`, `<a>`, or form control with a visible focus ring. Colour is never the only signal.
- Do not change `core/sse/assessment-stream.ts`, the guards, or `credentials.interceptor.ts`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/app/core/api/types.ts` | Types for the 5a contract | 1 |
| `src/app/core/config.ts` | `PRO_PRICE_LABEL`, tier copy constants | 1 |
| `src/app/shared/copy.ts` (+spec) | Pure text/number rules: bands, areas, severity, number words, effort, dates, pages caption | 1 |
| `src/app/shared/to-api-error.ts` | One `toApiError` for every component | 1 |
| `src/app/shared/upgrade-redirect.ts` | `pricingUrlFor(siteId)`, `isUpgradeRequired(e)` | 1 |
| `src/styles.css`, `package.json` | Tokens, base elements, fonts | 2 |
| `src/app/core/site-context.ts` | Current site domain for the header | 2 |
| `src/app/app.ts`, `app.html`, `app.css` (+spec) | Shell header and footer | 2 |
| `src/app/shared/score-bar.ts`, `severity-badge.ts`, `impact-badge.ts` | Small presentational pieces | 3 |
| `src/app/features/landing/landing.ts` (+spec) | Screen 04 | 3 |
| `src/app/features/pricing/upgrade-flow.ts` (+spec) | Checkout + poll for tier | 4 |
| `src/app/features/pricing/pricing.ts` (+spec) | Public pricing + plan gate (02) | 4 |
| `src/app/features/progress/progress.ts` (+spec) | Screen 05 | 5 |
| `src/app/features/result/result-view.ts`, `locked-plan-list.ts` (+spec) | Screen 01 shared view | 6 |
| `src/app/features/report/report.ts` (+spec) | Report route wrapper | 6 |
| `src/app/features/site-home/site-home.ts`, `next-task-view.ts` (+specs) | Site home states, screen 03 | 7 |
| `src/app/features/dashboard/dashboard.ts`, `dashboard.html` (+spec) | Redirect / list / add-site | 8 |
| `src/app/features/plan/plan.ts`, `plan.html` (+spec) | Pro checklist | 9 |
| `src/app/features/history/history.ts`, `history-copy.ts` (+specs) | Screen 06 | 10 |
| `src/app/features/account/account.ts`, `account.html` (+spec) | Screen 07 | 11 |
| `src/app/app.routes.ts` | New route `/sites/:siteId` | 7 |
| `e2e/happy-path.spec.ts`, `e2e/pro-next-task.spec.ts` | Playwright paths 1 and 2 | 12 |
| `frontend/README.md`, `docs/launch-checklist.md` | Docs | 12 |

---

### Task 1: Types, config, and pure copy helpers

**Files:**
- Modify: `src/app/core/api/types.ts`
- Modify: `src/app/core/config.ts`
- Create: `src/app/shared/copy.ts`, `src/app/shared/copy.spec.ts`
- Create: `src/app/shared/to-api-error.ts`
- Create: `src/app/shared/upgrade-redirect.ts`
- Modify: `src/app/features/dashboard/dashboard.ts`, `report/report.ts`, `plan/plan.ts`, `history/history.ts`, `account/account.ts` — replace the private `toApiError` with the shared import (five one-line edits; the components are rewritten in later tasks anyway).

**Interfaces (produces):**

```ts
// types.ts additions
export type Severity = 'high' | 'medium' | 'low' | 'good';
export interface Scores { seo: number; aeo: number; geo: number; overall: number; }
export interface ScoreNotes { seo: string; aeo: string; geo: string; }
export interface TaskChangeDto { title: string; kind: 'done' | 'verified'; }
export interface LatestAssessmentDto { id: string; status: AssessmentStatus; createdAt: string; completedAt: string | null; }
// AssessmentDto: + summary: string | null; scoreNotes: ScoreNotes | null; pageCount: number | null; changes: TaskChangeDto[]
// SiteDto: + latestAssessment: LatestAssessmentDto | null; latestReadyAssessmentId: string | null
// PlanTaskDto: + stepCount: number; whyItMatters: string | null; steps: string[] | null; doneCheck: string | null
// PlanDto: + locked: boolean
// UsageDto: + nextCheckAt: string | null
// config.ts
export const PRO_PRICE_LABEL = '$9';
export const FREE_TIER_COPY = { sites: 1, checks: 1 };
export const PRO_TIER_COPY = { sites: 5, checks: 10 };
// copy.ts
export type Tone = 'low' | 'mid' | 'high';
export function bandFor(score: number): { label: string; tone: Tone };   // 0-49 Needs work/low, 50-79 Getting there/mid, 80-100 Looking good/high
export function areaName(category: string): string;   // seo->Google search, aeo->Answer boxes, geo->AI assistants, else the input
export function areaCode(category: string): string;   // SEO / AEO / GEO
export function severityLabel(s: string): string;     // HIGH / MED / LOW / FINE
export function severityOrder(s: string): number;     // high 0, medium 1, low 2, good 3, else 4
export function numberWord(n: number): string;        // 1..12 words, else String(n)
export function effortText(minutes: number): string;  // "about 45 minutes" | "about 1 hour" | "about 3 hours"
export function pagesCaption(affected: number, pageCount: number | null): string; // AFFECTS EVERY PAGE | 1 PAGE | n PAGES
export function formatDate(iso: string): string;      // "28 July 2026"
export function formatDateShort(iso: string): string; // "28 July"
export function monthName(iso: string): string;       // "July"
// to-api-error.ts
export function toApiError(e: unknown): ApiError;
// upgrade-redirect.ts
export function pricingUrlFor(siteId?: string | null): string; // '/pricing?site=<id>' or '/pricing'
export function isUpgradeRequired(e: unknown): boolean;
```

- [ ] **Step 1: Write the failing helper tests**

Create `src/app/shared/copy.spec.ts`:

```ts
import { areaCode, areaName, bandFor, effortText, formatDate, formatDateShort, monthName, numberWord, pagesCaption, severityLabel, severityOrder } from './copy';

describe('copy helpers', () => {
  it('bands scores into three labels and tones', () => {
    expect(bandFor(0)).toEqual({ label: 'Needs work', tone: 'low' });
    expect(bandFor(49)).toEqual({ label: 'Needs work', tone: 'low' });
    expect(bandFor(50)).toEqual({ label: 'Getting there', tone: 'mid' });
    expect(bandFor(79)).toEqual({ label: 'Getting there', tone: 'mid' });
    expect(bandFor(80)).toEqual({ label: 'Looking good', tone: 'high' });
    expect(bandFor(100)).toEqual({ label: 'Looking good', tone: 'high' });
  });

  it('maps categories to area names and codes', () => {
    expect(areaName('seo')).toBe('Google search');
    expect(areaName('aeo')).toBe('Answer boxes');
    expect(areaName('geo')).toBe('AI assistants');
    expect(areaName('other')).toBe('other');
    expect(areaCode('geo')).toBe('GEO');
  });

  it('labels and orders severities', () => {
    expect(severityLabel('high')).toBe('HIGH');
    expect(severityLabel('medium')).toBe('MED');
    expect(severityLabel('low')).toBe('LOW');
    expect(severityLabel('good')).toBe('FINE');
    expect(['good', 'low', 'high', 'medium'].sort((a, b) => severityOrder(a) - severityOrder(b))).toEqual(['high', 'medium', 'low', 'good']);
  });

  it('writes numbers as words up to twelve', () => {
    expect(numberWord(1)).toBe('one');
    expect(numberWord(8)).toBe('eight');
    expect(numberWord(12)).toBe('twelve');
    expect(numberWord(13)).toBe('13');
  });

  it('writes effort in minutes under 90 and in rounded hours above', () => {
    expect(effortText(20)).toBe('about 20 minutes');
    expect(effortText(89)).toBe('about 89 minutes');
    expect(effortText(90)).toBe('about 2 hours');
    expect(effortText(60)).toBe('about 60 minutes');
    expect(effortText(100)).toBe('about 2 hours');
    expect(effortText(175)).toBe('about 3 hours');
    expect(effortText(0)).toBe('about 0 minutes');
  });

  it('captions affected pages', () => {
    expect(pagesCaption(0, 18)).toBe('AFFECTS EVERY PAGE');
    expect(pagesCaption(18, 18)).toBe('AFFECTS EVERY PAGE');
    expect(pagesCaption(20, 18)).toBe('AFFECTS EVERY PAGE');
    expect(pagesCaption(1, 18)).toBe('1 PAGE');
    expect(pagesCaption(14, 18)).toBe('14 PAGES');
    expect(pagesCaption(3, null)).toBe('3 PAGES');
  });

  it('formats dates in the long form', () => {
    expect(formatDate('2026-07-28T10:00:00.000Z')).toBe('28 July 2026');
    expect(formatDateShort('2026-09-01T10:00:00.000Z')).toBe('1 September');
    expect(monthName('2026-03-02T10:00:00.000Z')).toBe('March');
  });
});
```

Note on `effortText(90)`: 90 minutes is not under 90, so it rounds to hours: 90/60 = 1.5 → 2 hours. `about 1 hour` appears only for 91–89… no: for minutes ≥ 90, `Math.round(m/60)` is at least 2. The singular branch is unreachable with this rule; keep it for safety, do not test it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: compilation error, `./copy` not found.

- [ ] **Step 3: Write `copy.ts`, `to-api-error.ts`, `upgrade-redirect.ts`**

`src/app/shared/copy.ts`:

```ts
import { formatDate as ngFormatDate } from '@angular/common';

export type Tone = 'low' | 'mid' | 'high';

/** Score bands, spec §5.2. */
export function bandFor(score: number): { label: string; tone: Tone } {
  if (score >= 80) return { label: 'Looking good', tone: 'high' };
  if (score >= 50) return { label: 'Getting there', tone: 'mid' };
  return { label: 'Needs work', tone: 'low' };
}

const AREA_NAMES: Record<string, string> = { seo: 'Google search', aeo: 'Answer boxes', geo: 'AI assistants' };
export function areaName(category: string): string { return AREA_NAMES[category] ?? category; }
export function areaCode(category: string): string { return category.toUpperCase(); }

const SEVERITY_LABELS: Record<string, string> = { high: 'HIGH', medium: 'MED', low: 'LOW', good: 'FINE' };
export function severityLabel(severity: string): string { return SEVERITY_LABELS[severity] ?? severity.toUpperCase(); }
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, good: 3 };
export function severityOrder(severity: string): number { return SEVERITY_ORDER[severity] ?? 4; }

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export function numberWord(n: number): string { return n >= 1 && n <= 12 ? WORDS[n] : String(n); }

/** Effort text, spec §4.3. Under 90 minutes: minutes. Otherwise rounded hours. */
export function effortText(minutes: number): string {
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'about 1 hour' : `about ${hours} hours`;
}

/** Caption for a finding's affected pages, spec §4.3. */
export function pagesCaption(affected: number, pageCount: number | null): string {
  if (affected === 0 || (pageCount != null && affected >= pageCount)) return 'AFFECTS EVERY PAGE';
  if (affected === 1) return '1 PAGE';
  return `${affected} PAGES`;
}

export function formatDate(iso: string): string { return ngFormatDate(iso, 'd MMMM yyyy', 'en-US'); }
export function formatDateShort(iso: string): string { return ngFormatDate(iso, 'd MMMM', 'en-US'); }
export function monthName(iso: string): string { return ngFormatDate(iso, 'MMMM', 'en-US'); }
```

`src/app/shared/to-api-error.ts`:

```ts
import { ApiError } from '../core/api/api-client';

/** Normalises any thrown value into an ApiError so templates can branch on `code`. */
export function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0);
}
```

`src/app/shared/upgrade-redirect.ts`:

```ts
import { ApiError } from '../core/api/api-client';

/** The plan gate lives on /pricing. With a site id the gate shows that site's locked plan. */
export function pricingUrlFor(siteId?: string | null): string {
  return siteId ? `/pricing?site=${encodeURIComponent(siteId)}` : '/pricing';
}

export function isUpgradeRequired(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'upgrade_required';
}
```

- [ ] **Step 4: Update `types.ts` and `config.ts`**

Replace the full content of `src/app/core/api/types.ts`:

```ts
export type Tier = 'free' | 'pro';
export type AssessmentStatus = 'queued' | 'crawling' | 'analyzing' | 'planning' | 'ready' | 'failed';
export type TaskStatus = 'todo' | 'done' | 'verified';
export type Impact = 'high' | 'medium' | 'low';
export type Severity = 'high' | 'medium' | 'low' | 'good';

export interface UserDto { id: string; email: string; emailVerified: boolean; tier: Tier; }
export interface Scores { seo: number; aeo: number; geo: number; overall: number; }
export interface ScoreNotes { seo: string; aeo: string; geo: string; }
export interface LatestAssessmentDto { id: string; status: AssessmentStatus; createdAt: string; completedAt: string | null; }
export interface SiteDto {
  id: string; domain: string; url: string; platform: string | null; latestScores: Scores | null; readOnly: boolean;
  latestAssessment: LatestAssessmentDto | null; latestReadyAssessmentId: string | null;
}
export interface Finding { id: string; category: string; severity: Severity | string; evidence: string; affectedPages: string[]; }
export interface TaskChangeDto { title: string; kind: 'done' | 'verified'; }
export interface AssessmentDto {
  id: string; siteId: string; status: AssessmentStatus; scores: Scores | null;
  summary: string | null; scoreNotes: ScoreNotes | null;
  findings: Finding[]; pageCount: number | null;
  errorCode: string | null; errorMessage: string | null;
  createdAt: string; completedAt: string | null;
  changes: TaskChangeDto[];
}
export interface PlanTaskDto {
  taskId: string; title: string; category: string; impact: Impact; effortMinutes: number; stepCount: number;
  whyItMatters: string | null; steps: string[] | null; doneCheck: string | null; status: TaskStatus;
}
export interface PlanProgressDto { done: number; verified: number; total: number; }
export interface PlanDto { id: string; assessmentId: string; siteId: string; locked: boolean; tasks: PlanTaskDto[]; progress: PlanProgressDto; }
export interface UsageDto { assessmentsUsed: number; assessmentsLimit: number; sitesUsed: number; sitesLimit: number; nextCheckAt: string | null; }
```

Append to `src/app/core/config.ts`:

```ts
/** Shown price. Freemius bills the real price; keep the two equal (launch checklist 7.1a). */
export const PRO_PRICE_LABEL = '$9';
/** Tier numbers used in copy. Keep equal to the backend env values (launch checklist 7.1a). */
export const FREE_TIER_COPY = { sites: 1, checks: 1 };
export const PRO_TIER_COPY = { sites: 5, checks: 10 };
```

- [ ] **Step 5: Point the five components at the shared `toApiError`**

In each of `features/dashboard/dashboard.ts`, `features/report/report.ts`, `features/plan/plan.ts`, `features/history/history.ts`, `features/account/account.ts`: delete the local `function toApiError(e: unknown): ApiError { … }` and add `import { toApiError } from '../../shared/to-api-error';`. Keep the `ApiError` import where the file still uses the type.

- [ ] **Step 6: Fix the spec fixtures that build DTOs**

The existing specs build `SiteDto`, `AssessmentDto`, `PlanDto`, `PlanTaskDto`, `UsageDto` literals. TypeScript now requires the new fields. Update the `makeSite`, `makeAssessment`, `makePlan`, task and usage factories in `dashboard.spec.ts`, `report.spec.ts`, `plan.spec.ts`, `history.spec.ts`, `account.spec.ts`, `progress.spec.ts` to add:

- site: `latestAssessment: null, latestReadyAssessmentId: null`
- assessment: `summary: null, scoreNotes: null, pageCount: null, changes: []`; scores literals gain `overall` (use the rounded mean, e.g. `{ seo: 82, aeo: 65, geo: 47, overall: 65 }`)
- plan: `locked: false`; tasks: `stepCount: steps.length`
- usage: `nextCheckAt: null`

Then run the suite. Every existing test must still pass; these are type-only additions.

- [ ] **Step 7: Run tests and build**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

- [ ] **Step 8: Commit**

```bash
git add src/app/core src/app/shared src/app/features
git commit -m "feat(frontend): 5a contract types, price and tier constants, shared copy helpers"
```

---

### Task 2: Visual system — fonts, tokens, base styles, and the shell

**Files:**
- Modify: `package.json` (two dependencies)
- Modify: `src/styles.css` (full content)
- Create: `src/app/core/site-context.ts`
- Modify: `src/app/app.ts`, `src/app/app.html`, `src/app/app.css`, `src/app/app.spec.ts`
- Modify: `src/index.html` (`<meta name="theme-color">`, background)

**Interfaces (produces):**
- `SiteContext` (`providedIn: 'root'`): `readonly domain = signal<string | null>(null)`; `set(domain: string | null)`; `clear()`. Site-scoped pages call `set` in `ngOnInit` and `clear` in `ngOnDestroy`.
- Global CSS classes used by every later task: `.page` (max-width 1080, padding), `.surface`, `.card`, `.card-soft`, `.btn`, `.btn-primary`, `.btn-outline`, `.btn-text`, `.btn-dark`, `.eyebrow`, `.mono`, `.pill`, `.pill-free`, `.pill-pro`, `.badge`, `.badge-high`, `.badge-mid`, `.badge-low`, `.badge-good`, `.bar`, `.bar-fill`, `.tone-low`, `.tone-mid`, `.tone-high`, `.row`, `.stack`, `.muted`, `.faint`, `.error-note`, `.note-box`, `.two-col`.

- [ ] **Step 1: Install the fonts**

Run: `npm install @fontsource/libre-franklin@^5 @fontsource/ibm-plex-mono@^5`
Expected: `package.json` lists both under `dependencies`.

- [ ] **Step 2: Write `styles.css`**

Replace the full content of `src/styles.css`:

```css
@import '@fontsource/libre-franklin/400.css';
@import '@fontsource/libre-franklin/500.css';
@import '@fontsource/libre-franklin/600.css';
@import '@fontsource/libre-franklin/700.css';
@import '@fontsource/ibm-plex-mono/400.css';
@import '@fontsource/ibm-plex-mono/500.css';

:root {
  --bg: #efe7db; --surface: #fdf7ee; --card: #ffffff; --card-soft: #fdfaf5; --strip: #fbf2e5; --note: #fbf6ee;
  --line: #f0e5d4; --line-strong: #ecdfcc; --line-input: #e0cdb2;
  --ink: #221c15; --body: #4c4237; --body-long: #5c4f40; --muted: #7a6a58;
  --faint: #a89478; --faint-2: #b09a7e; --faint-3: #cbb79a;
  --accent: #b4552f; --accent-hover: #8e3f20; --accent-tint: #fbeae1;
  --olive: #6b7d4f; --olive-text: #5c7040; --olive-tint: #eaf0e0;
  --amber: #8a6a2f; --amber-tint: #f7eed8; --pill: #f3e9da;
  --sans: 'Libre Franklin', system-ui, sans-serif; --mono: 'IBM Plex Mono', ui-monospace, monospace;
  --r-btn: 9px; --r-card: 14px; --r-small: 10px; --r-badge: 4px;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--body); font-family: var(--sans); font-size: 16px; line-height: 1.5; }
h1, h2, h3, h4 { margin: 0; color: var(--ink); font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; }
p { margin: 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }
input, button, select, textarea { font: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.page { max-width: 1080px; margin: 0 auto; padding: 44px; }
.surface { background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-small); }
.card { background: var(--card); border: 1.5px solid var(--line-strong); border-radius: var(--r-card); padding: 34px 40px; }
.card-soft { background: var(--card-soft); border: 1px solid var(--line); border-radius: var(--r-small); }
.note-box { background: var(--note); border-radius: var(--r-small); padding: 18px 20px; }
.stack { display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; align-items: center; gap: 14px; }
.two-col { display: flex; gap: 48px; align-items: flex-start; }
.spacer { flex: 1; }
.muted { color: var(--muted); }
.faint { color: var(--faint); }
.mono { font-family: var(--mono); letter-spacing: 0.06em; text-transform: uppercase; }
.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: var(--r-btn); padding: 14px 24px; font-weight: 600; font-size: 15px; cursor: pointer; border: 1.5px solid transparent; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-outline { background: transparent; color: var(--ink); border-color: var(--line-input); font-weight: 500; }
.btn-text { background: transparent; color: var(--muted); border: none; padding: 0; font-weight: 500; }
.btn-dark { background: var(--ink); color: #fff; }

input[type=text], input[type=email], input[type=password] { width: 100%; padding: 15px 18px; background: #fff; border: 1.5px solid var(--line-input); border-radius: var(--r-btn); color: var(--ink); }

.pill { display: inline-block; border-radius: 999px; padding: 5px 11px; font-size: 13px; }
.pill-free { background: var(--pill); color: #8a7a66; }
.pill-pro { background: var(--accent-tint); color: var(--accent); font-weight: 500; }
.badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; padding: 4px 9px; border-radius: var(--r-badge); text-align: center; }
.badge-high { color: var(--accent); background: var(--accent-tint); }
.badge-mid { color: var(--amber); background: var(--amber-tint); }
.badge-low { color: var(--muted); background: var(--pill); }
.badge-good { color: var(--olive-text); background: var(--olive-tint); }

.tone-low { color: var(--accent); } .tone-mid { color: var(--amber); } .tone-high { color: var(--olive); }
.bar { height: 7px; background: var(--line); border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; }
.bar-fill.tone-low { background: var(--accent); } .bar-fill.tone-mid { background: var(--amber); } .bar-fill.tone-high { background: var(--olive); }

.error-note { background: var(--accent-tint); color: var(--accent-hover); padding: 12px 16px; border-radius: var(--r-small); }
.divider { border-top: 1px solid var(--line); }
table.data { width: 100%; border-collapse: collapse; }
table.data th { text-align: left; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: var(--faint); padding: 0 0 12px; border-bottom: 1px solid var(--line-input); }
table.data td { padding: 17px 0; border-bottom: 1px solid var(--line); }
table.data .num { text-align: right; }
.table-scroll { overflow-x: auto; }

@media (max-width: 760px) {
  .page { padding: 20px; }
  .two-col { flex-direction: column; gap: 24px; }
  .card { padding: 24px 20px; }
}
```

- [ ] **Step 3: Create `SiteContext`**

`src/app/core/site-context.ts`:

```ts
import { Injectable, signal } from '@angular/core';

/** The domain of the site the current page is about. The header shows it. */
@Injectable({ providedIn: 'root' })
export class SiteContext {
  readonly domain = signal<string | null>(null);
  set(domain: string | null): void { this.domain.set(domain); }
  clear(): void { this.domain.set(null); }
}
```

- [ ] **Step 4: Write the failing shell tests**

Add to `src/app/app.spec.ts` (inside the `describe`), and add `import { SiteContext } from './core/site-context';`:

```ts
  it('shows the tier pill, the site domain and Account when logged in', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(UserStore);
    store.loaded.set(true);
    store.user.set({ id: 'u1', email: 'a@example.com', emailVerified: true, tier: 'pro' } as UserDto);
    TestBed.inject(SiteContext).set('rivertonbakery.com');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('rivertonbakery.com');
    expect(text).toContain('Pro');
    expect(text).toContain('Account');
    expect(text).not.toContain('Log in');
  });

  it('shows Pricing, Log in and Check my site when logged out', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(UserStore);
    store.loaded.set(true);
    store.user.set(null);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Pricing');
    expect(text).toContain('Log in');
    expect(text).toContain('Check my site');
  });
```

Delete the old header tests that assert "Sign up" or "Dashboard" links if they exist in the file (the new header has neither).

- [ ] **Step 5: Rewrite the shell**

`src/app/app.html`:

```html
<header class="site-header">
  <nav class="site-nav" aria-label="Main">
    <a [routerLink]="userStore.user() ? '/dashboard' : '/'" class="brand">GEOSTRATEGY</a>
    <span class="spacer"></span>
    @if (userStore.user(); as user) {
      @if (siteContext.domain(); as domain) {
        <a routerLink="/dashboard" class="site-domain">{{ domain }}</a>
      }
      <span class="pill" [class.pill-pro]="user.tier === 'pro'" [class.pill-free]="user.tier !== 'pro'">
        {{ user.tier === 'pro' ? 'Pro' : 'Free plan' }}
      </span>
      <a routerLink="/account" routerLinkActive="active">Account</a>
    } @else {
      <a routerLink="/pricing">Pricing</a>
      <a routerLink="/login">Log in</a>
      <a routerLink="/" class="btn btn-dark btn-small">Check my site</a>
    }
  </nav>
</header>

<main>
  <router-outlet />
</main>
```

`src/app/app.css`:

```css
.site-header { background: var(--surface); border-bottom: 1px solid var(--line); }
.site-nav { max-width: 1080px; margin: 0 auto; display: flex; align-items: center; gap: 22px; padding: 16px 44px; }
.brand { font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--ink); }
.site-nav a { color: var(--muted); font-size: 14px; }
.site-nav a.active { color: var(--ink); font-weight: 600; }
.site-domain { color: var(--muted); }
.btn-small { padding: 9px 16px; font-size: 14px; }
@media (max-width: 760px) { .site-nav { padding: 12px 20px; gap: 12px; flex-wrap: wrap; } }
```

`src/app/app.ts` — replace the imports and the class head:

```ts
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UserStore } from './core/auth/user-store';
import { SiteContext } from './core/site-context';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly userStore = inject(UserStore);
  protected readonly siteContext = inject(SiteContext);

  constructor() {
    // Fire-and-forget: settles the header's auth state on load.
    void this.userStore.refresh();
  }
}
```

The logout action moves to the Account page (Task 11); the shell no longer needs `ApiClient` or `Router`.

`src/index.html`: add `<meta name="theme-color" content="#efe7db">` in `<head>`.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS; build green. If the build warns about the initial bundle size because of font CSS, raise `maximumWarning` for `initial` in `angular.json` to `700kB` (fonts load as separate media files; the CSS is small, so this warning is unlikely).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/styles.css src/index.html src/app/app.ts src/app/app.html src/app/app.css src/app/app.spec.ts src/app/core/site-context.ts
git commit -m "feat(frontend): one thing tokens, self-hosted fonts and the new shell"
```

---
### Task 3: Presentational pieces and the landing page (screen 04)

**Files:**
- Create: `src/app/shared/score-bar.ts`, `src/app/shared/severity-badge.ts`, `src/app/shared/impact-badge.ts`
- Modify: `src/app/features/landing/landing.ts`, `src/app/features/landing/landing.spec.ts`

**Interfaces (produces):**
- `<app-score-bar [value]="n" [width]="130">` — a `.bar` with a `.bar-fill` whose class is `tone-<tone>` and width `n%`. `role="img"`, `aria-label="Score {n} of 100"`.
- `<app-severity-badge [severity]="'high'">` — `.badge.badge-{high|mid|low|good}` with `severityLabel`.
- `<app-impact-badge [impact]="'high'">` — same classes with HIGH/MED/LOW.

- [ ] **Step 1: Write the pieces**

`src/app/shared/score-bar.ts`:

```ts
import { Component, computed, input } from '@angular/core';
import { bandFor } from './copy';

@Component({
  selector: 'app-score-bar',
  template: `<div class="bar" role="img" [attr.aria-label]="'Score ' + value() + ' of 100'" [style.width.px]="width()">
    <div [class]="'bar-fill tone-' + tone()" [style.width.%]="clamped()"></div>
  </div>`,
})
export class ScoreBar {
  value = input.required<number>();
  width = input<number | null>(null);
  protected readonly clamped = computed(() => Math.min(100, Math.max(0, this.value())));
  protected readonly tone = computed(() => bandFor(this.value()).tone);
}
```

`src/app/shared/severity-badge.ts`:

```ts
import { Component, computed, input } from '@angular/core';
import { severityLabel } from './copy';

const CLASS: Record<string, string> = { high: 'badge-high', medium: 'badge-mid', low: 'badge-low', good: 'badge-good' };

@Component({
  selector: 'app-severity-badge',
  template: `<span [class]="'badge ' + cls()">{{ label() }}</span>`,
})
export class SeverityBadge {
  severity = input.required<string>();
  protected readonly label = computed(() => severityLabel(this.severity()));
  protected readonly cls = computed(() => CLASS[this.severity()] ?? 'badge-low');
}
```

`src/app/shared/impact-badge.ts`:

```ts
import { Component, computed, input } from '@angular/core';
import { severityLabel } from './copy';

const CLASS: Record<string, string> = { high: 'badge-high', medium: 'badge-mid', low: 'badge-low' };

@Component({
  selector: 'app-impact-badge',
  template: `<span [class]="'badge ' + cls()">{{ label() }}</span>`,
})
export class ImpactBadge {
  impact = input.required<string>();
  protected readonly label = computed(() => severityLabel(this.impact()));
  protected readonly cls = computed(() => CLASS[this.impact()] ?? 'badge-low');
}
```

- [ ] **Step 2: Write the failing landing tests**

Replace `src/app/features/landing/landing.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Landing } from './landing';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PENDING_URL_KEY, PRO_PRICE_LABEL } from '../../core/config';
import { UserDto } from '../../core/api/types';

@Component({ selector: 'landing-spec-blank', template: '' })
class BlankPage {}

class FakeApiClient { me(): Promise<UserDto> { return Promise.reject(new Error('not used')); } }

describe('Landing', () => {
  beforeEach(async () => {
    sessionStorage.removeItem(PENDING_URL_KEY);
    await TestBed.configureTestingModule({
      imports: [Landing],
      providers: [
        { provide: ApiClient, useValue: new FakeApiClient() },
        provideRouter([{ path: 'signup', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
      ],
    }).compileComponents();
  });
  afterEach(() => sessionStorage.removeItem(PENDING_URL_KEY));

  it('shows the hero, the three steps, the free promise and the price', () => {
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Your customers ask AI. Does it know you exist?');
    expect(text).toContain('You give us your web address');
    expect(text).toContain('We read it the way machines do');
    expect(text).toContain('You fix one thing at a time');
    expect(text).toContain('Your score and every problem we find. No card, no trial clock.');
    expect(text).toContain(`${PRO_PRICE_LABEL} a month`);
    expect(text).toContain('EXAMPLE RESULT, FREE TIER');
  });

  it('stores the url and goes to signup when signed out', async () => {
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[type=text]')!;
    input.value = 'rivertonbakery.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBe('rivertonbakery.com');
    expect(TestBed.inject(Location).path()).toBe('/signup');
  });

  it('goes to the dashboard when signed in', async () => {
    TestBed.inject(UserStore).user.set({ id: 'u1', email: 'a@example.com', emailVerified: true, tier: 'free' });
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[type=text]')!;
    input.value = 'x.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('/dashboard');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL on the hero text.

- [ ] **Step 4: Rewrite the landing**

Replace `src/app/features/landing/landing.ts`:

```ts
import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { UserStore } from '../../core/auth/user-store';
import { PENDING_URL_KEY, PRO_PRICE_LABEL } from '../../core/config';
import { ScoreBar } from '../../shared/score-bar';

@Component({
  selector: 'app-landing',
  imports: [ReactiveFormsModule, RouterLink, ScoreBar],
  template: `
    <div class="page surface landing">
      <section class="hero">
        <span class="eyebrow">FOR PEOPLE WHO RUN ONE WEBSITE</span>
        <h1>Your customers ask AI. Does it know you exist?</h1>
        <p class="lead">People used to search. Now they ask ChatGPT for a bakery near them, and it answers with somebody. We check whether that somebody is you, and tell you what to fix.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" class="hero-form" id="check">
          <label class="sr-only" for="url">Your website</label>
          <input id="url" type="text" formControlName="url" placeholder="yourbusiness.com" autocomplete="url" />
          <button type="submit" class="btn btn-primary" [disabled]="form.invalid">Check my site free</button>
          <span class="faint small">Two minutes. No card. Your score and every problem, free.</span>
        </form>
      </section>

      <section class="steps divider">
        <div><span class="mono step-no">01</span><h3>You give us your web address</h3><p>Nothing to install, no password to your site, no plugin. We only read the pages anyone can see.</p></div>
        <div><span class="mono step-no">02</span><h3>We read it the way machines do</h3><p>Then we score how findable you are in Google, in answer boxes, and inside AI assistants — and list what is holding you back.</p></div>
        <div><span class="mono step-no">03</span><h3>You fix one thing at a time</h3><p>We show you the single biggest win, with steps you can follow yourself, then confirm it worked at your next check.</p></div>
      </section>

      <section class="card free-card two-col">
        <div class="stack">
          <span class="eyebrow">WHAT YOU GET FREE</span>
          <p class="promise">Your score and every problem we find. No card, no trial clock.</p>
          <p class="muted">The step-by-step plan that fixes them is {{ price }} a month. You will know exactly what is in it before you decide.</p>
        </div>
        <div class="example stack">
          <div class="row"><span class="example-score">41</span><span class="tone-low semi">Needs work</span></div>
          <app-score-bar [value]="41" />
          <div class="row example-subs">
            <div><span class="faint small">Google</span><strong>62</strong></div>
            <div><span class="faint small">Answers</span><strong>34</strong></div>
            <div><span class="faint small">AI</span><strong>28</strong></div>
          </div>
          <span class="mono faint small">EXAMPLE RESULT, FREE TIER</span>
        </div>
      </section>

      <footer class="site-footer divider">
        <span class="brand-faint">GEOSTRATEGY</span>
        <span class="spacer"></span>
        <a routerLink="/pricing">Pricing</a><a routerLink="/terms">Terms</a><a routerLink="/privacy">Privacy</a>
      </footer>
    </div>
  `,
  styles: `
    .landing { padding-top: 0; }
    .hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px; padding: 84px 0 76px; }
    .hero h1 { font-size: 54px; letter-spacing: -0.035em; line-height: 1.08; max-width: 20ch; }
    .lead { font-size: 19px; line-height: 1.6; color: var(--body-long); max-width: 50ch; }
    .hero-form { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; max-width: 480px; margin-top: 18px; }
    .hero-form input { text-align: center; font-size: 17px; }
    .hero-form .btn { width: 100%; font-size: 17px; padding: 17px 0; }
    .steps { display: flex; gap: 40px; padding: 38px 0 46px; }
    .steps > div { flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .steps > div + div { border-left: 1px solid var(--line); padding-left: 40px; }
    .step-no { font-size: 13px; font-weight: 700; color: var(--faint-2); }
    .steps h3 { font-size: 21px; }
    .steps p { color: var(--body-long); }
    .promise { font-size: 20px; font-weight: 600; color: var(--ink); max-width: 28ch; }
    .example { width: 320px; flex-shrink: 0; padding-left: 40px; border-left: 1px solid var(--line); }
    .example-score { font-size: 44px; font-weight: 700; color: var(--ink); letter-spacing: -0.04em; line-height: 1; }
    .semi { font-weight: 600; }
    .example-subs { gap: 20px; } .example-subs div { display: flex; flex-direction: column; } .example-subs strong { color: var(--ink); }
    .small { font-size: 13px; }
    .site-footer { display: flex; align-items: center; gap: 24px; padding: 26px 0 0; margin-top: 46px; }
    .site-footer a { color: var(--muted); font-size: 14px; }
    .brand-faint { font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--faint-2); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 760px) { .hero h1 { font-size: 36px; } .steps { flex-direction: column; } .steps > div + div { border-left: none; padding-left: 0; border-top: 1px solid var(--line); padding-top: 24px; } .example { width: 100%; padding-left: 0; border-left: none; } }
  `,
})
export class Landing {
  private store = inject(UserStore);
  private router = inject(Router);
  protected readonly price = PRO_PRICE_LABEL;

  protected readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected submit(): void {
    if (this.form.invalid) return;
    const { url } = this.form.getRawValue();
    sessionStorage.setItem(PENDING_URL_KEY, url.trim());
    void this.router.navigateByUrl(this.store.user() ? '/dashboard' : '/signup');
  }
}
```

If the component style exceeds the 4 kB warning, move the `.steps`, `.hero`, and `.site-footer` rules into `styles.css` under a `/* landing */` comment.

- [ ] **Step 5: Run tests and build; commit**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

```bash
git add src/app/shared src/app/features/landing
git commit -m "feat(frontend): landing page and score, severity and impact pieces"
```

---
### Task 4: Upgrade flow service, public pricing, and the plan gate (screen 02)

**Files:**
- Create: `src/app/features/pricing/upgrade-flow.ts`, `src/app/features/pricing/upgrade-flow.spec.ts`
- Create: `src/app/features/pricing/plan-cards.ts`
- Modify: `src/app/features/pricing/pricing.ts`, `src/app/features/pricing/pricing.spec.ts`

**Interfaces (produces):**
- `UpgradeFlow` (`providedIn: 'root'`):
  - public seams: `productId`, `publicKey`, `loadScript`, `pollMs` (default 2000), `maxPolls` (default 30).
  - `openCheckout(email: string, onSuccess: () => void): Promise<void>` — throws `Error('not_connected')` when `productId` starts with `REPLACE_ME`; else loads the script and opens the overlay.
  - `awaitUpgrade(): Promise<boolean>` — polls `api.me()` up to `maxPolls` times, `pollMs` apart. On `tier === 'pro'` it updates `UserStore` and resolves `true`; on timeout `false`.
- `<app-plan-cards [taskCount] [context]="'gate'|'public'" [isPro] [busy] [portalUrl] [freeButton] (unlock) (stayFree)>`.
- `Pricing` reads `?site=`; for a signed-in Free user with a locked plan it renders the gate; else the public variant.

- [ ] **Step 1: Write the failing upgrade-flow tests**

`src/app/features/pricing/upgrade-flow.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { UpgradeFlow } from './upgrade-flow';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { UserDto } from '../../core/api/types';

class FakeApiClient {
  tiers: Array<'free' | 'pro'> = [];
  calls = 0;
  me(): Promise<UserDto> {
    const tier = this.tiers[Math.min(this.calls, this.tiers.length - 1)] ?? 'free';
    this.calls++;
    return Promise.resolve({ id: 'u1', email: 'a@example.com', emailVerified: true, tier });
  }
}

describe('UpgradeFlow', () => {
  let api: FakeApiClient;
  let flow: UpgradeFlow;

  beforeEach(() => {
    api = new FakeApiClient();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    flow = TestBed.inject(UpgradeFlow);
    flow.pollMs = 0;
  });

  it('rejects with not_connected while the product id is a placeholder', async () => {
    flow.productId = 'REPLACE_ME_FREEMIUS_PRODUCT_ID';
    await expectAsync(flow.openCheckout('a@example.com', () => {})).toBeRejectedWithError('not_connected');
  });

  it('resolves true and updates the store once the tier turns pro', async () => {
    api.tiers = ['free', 'free', 'pro'];
    flow.maxPolls = 10;
    expect(await flow.awaitUpgrade()).toBeTrue();
    expect(api.calls).toBe(3);
    expect(TestBed.inject(UserStore).user()?.tier).toBe('pro');
  });

  it('resolves false after maxPolls without pro', async () => {
    api.tiers = ['free'];
    flow.maxPolls = 3;
    expect(await flow.awaitUpgrade()).toBeFalse();
    expect(api.calls).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: compilation error, `./upgrade-flow` not found.

- [ ] **Step 3: Write `UpgradeFlow`**

`src/app/features/pricing/upgrade-flow.ts` (the script loader moves here from `pricing.ts`):

```ts
import { inject, Injectable } from '@angular/core';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { FREEMIUS_PRODUCT_ID, FREEMIUS_PUBLIC_KEY } from '../../core/config';

type FreemiusCheckout = { open: (o: object) => void };
type FreemiusGlobal = { FS?: { Checkout: new (o: object) => FreemiusCheckout } };

const FREEMIUS_SCRIPT_TIMEOUT_MS = 10_000;

/** Module-level cache so the checkout script is appended once, however many times checkout opens. */
let freemiusScriptPromise: Promise<void> | null = null;

export function loadFreemiusScript(): Promise<void> {
  if (!freemiusScriptPromise) {
    const scriptLoad = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.freemius.com/js/v1/';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the checkout script.'));
      document.head.appendChild(script);
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Timed out loading the checkout script.')), FREEMIUS_SCRIPT_TIMEOUT_MS);
    });
    // A rejection must not poison the cache: null it so the next click can retry.
    freemiusScriptPromise = Promise.race([scriptLoad, timeout]).catch((e: unknown) => {
      freemiusScriptPromise = null;
      throw e;
    });
  }
  return freemiusScriptPromise;
}

/** Opens the Freemius overlay and waits for the webhook to flip the tier. Spec §5.5. */
@Injectable({ providedIn: 'root' })
export class UpgradeFlow {
  private api = inject(ApiClient);
  private store = inject(UserStore);

  // Test seams.
  productId = FREEMIUS_PRODUCT_ID;
  publicKey = FREEMIUS_PUBLIC_KEY;
  loadScript: () => Promise<void> = loadFreemiusScript;
  pollMs = 2000;
  maxPolls = 30;

  async openCheckout(email: string, onSuccess: () => void): Promise<void> {
    if (this.productId.startsWith('REPLACE_ME')) throw new Error('not_connected');
    await this.loadScript();
    const fs = (window as unknown as FreemiusGlobal).FS;
    const handler = new fs!.Checkout({ product_id: this.productId, public_key: this.publicKey });
    handler.open({ email, success: onSuccess });
  }

  async awaitUpgrade(): Promise<boolean> {
    for (let i = 0; i < this.maxPolls; i++) {
      try {
        const me = await this.api.me();
        if (me.tier === 'pro') {
          this.store.user.set(me);
          return true;
        }
      } catch {
        // A failed poll is not the end; wait and try again.
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    return false;
  }
}
```

- [ ] **Step 4: Run the upgrade-flow tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: the three `UpgradeFlow` tests PASS. The old pricing tests still compile against the old component; they change in Step 6.

- [ ] **Step 5: Write `PlanCards`**

`src/app/features/pricing/plan-cards.ts`:

```ts
import { Component, input, output } from '@angular/core';
import { FREE_TIER_COPY, PRO_PRICE_LABEL, PRO_TIER_COPY } from '../../core/config';
import { numberWord } from '../../shared/copy';

@Component({
  selector: 'app-plan-cards',
  template: `
    <div class="cards">
      <section class="plan-card card-soft">
        <div class="stack head">
          <div class="row"><strong class="name">Free</strong>@if (context() === 'gate') {<span class="badge badge-low">YOUR PLAN NOW</span>}</div>
          <span class="price">$0</span>
        </div>
        <ul class="features">
          <li class="ok">One site, {{ freeChecks }} each month</li>
          <li class="ok">Your visibility score and the three sub-scores</li>
          <li class="ok">Every problem we found, in plain language</li>
          <li class="no">No step-by-step plan</li>
          <li class="no">No progress tracking or history</li>
        </ul>
        <span class="spacer"></span>
        <button type="button" class="btn btn-outline" (click)="stayFree.emit()">{{ freeButton() }}</button>
      </section>

      <section class="plan-card pro">
        <div class="stack head">
          <div class="row"><strong class="name">Pro</strong><span class="badge badge-high">{{ context() === 'gate' ? 'UNLOCKS YOUR PLAN' : 'THE PLAN' }}</span></div>
          <span class="price">{{ price }} <span class="per">a month</span> <span class="faint small">· cancel any time</span></span>
        </div>
        <ul class="features pro-features">
          <li class="ok">@if (taskCount(); as n) {<strong>All {{ word(n) }} tasks with their steps</strong>, in the order that helps most first} @else {<strong>Every task with its steps</strong>, in the order that helps most first}</li>
          <li class="ok">A way to check each fix actually worked</li>
          <li class="ok">We re-check your site and confirm your fixes for you</li>
          <li class="ok">{{ proSites }} sites, {{ proChecks }} checks each month</li>
          <li class="ok">Score history, so you can see it working</li>
        </ul>
        <span class="spacer"></span>
        @if (isPro()) {
          <a class="btn btn-outline" [href]="portalUrl()" target="_blank" rel="noopener">Manage subscription</a>
          <span class="faint small center">You are on Pro.</span>
        } @else {
          <button type="button" class="btn btn-primary" (click)="unlock.emit()" [disabled]="busy()">Unlock my plan</button>
          <span class="faint small center">{{ context() === 'gate' ? 'Your plan is already written and waiting.' : 'Cancel any time. Your score stays free.' }}</span>
        }
      </section>
    </div>
  `,
  styles: `
    .cards { display: flex; gap: 20px; align-items: stretch; width: 100%; max-width: 860px; }
    .plan-card { flex: 1; padding: 30px 30px 34px; display: flex; flex-direction: column; gap: 22px; border-radius: var(--r-card); }
    .plan-card.pro { flex: 1.15; background: var(--card); border: 2px solid var(--accent); }
    .name { font-size: 17px; color: var(--ink); }
    .price { font-size: 34px; font-weight: 700; color: var(--ink); letter-spacing: -0.03em; }
    .per { font-size: 15px; font-weight: 400; color: var(--muted); }
    .features { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .features li { padding-left: 24px; position: relative; font-size: 15px; line-height: 1.5; color: var(--body); }
    .features li::before { position: absolute; left: 0; }
    .features li.ok::before { content: '✓'; color: var(--olive); }
    .pro-features li.ok::before { color: var(--accent); }
    .pro-features li { color: var(--ink); }
    .features li.no { color: var(--faint); } .features li.no::before { content: '—'; color: var(--faint-3); }
    .small { font-size: 13px; } .center { text-align: center; }
    @media (max-width: 760px) { .cards { flex-direction: column; } }
  `,
})
export class PlanCards {
  taskCount = input<number | null>(null);
  context = input<'gate' | 'public'>('public');
  isPro = input(false);
  busy = input(false);
  portalUrl = input('');
  freeButton = input('Stay on Free');
  unlock = output<void>();
  stayFree = output<void>();

  protected readonly price = PRO_PRICE_LABEL;
  protected readonly freeChecks = FREE_TIER_COPY.checks === 1 ? 'one check' : `${numberWord(FREE_TIER_COPY.checks)} checks`;
  protected readonly proSites = numberWord(PRO_TIER_COPY.sites).replace(/^./, (c) => c.toUpperCase());
  protected readonly proChecks = numberWord(PRO_TIER_COPY.checks);
  protected readonly word = numberWord;
}
```

- [ ] **Step 6: Write the failing pricing tests**

Replace `src/app/features/pricing/pricing.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Pricing } from './pricing';
import { UpgradeFlow } from './upgrade-flow';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PlanDto, SiteDto, UserDto } from '../../core/api/types';

@Component({ selector: 'pricing-spec-blank', template: '' })
class BlankPage {}

function site(overrides: Partial<SiteDto> = {}): SiteDto {
  return {
    id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress',
    latestScores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, readOnly: false,
    latestAssessment: { id: 'A1', status: 'ready', createdAt: '2026-07-28T10:00:00Z', completedAt: '2026-07-28T10:03:00Z' },
    latestReadyAssessmentId: 'A1', ...overrides,
  };
}
function lockedPlan(): PlanDto {
  const t = (i: number, title: string, impact: 'high' | 'medium' | 'low', minutes: number, steps: number) => ({
    taskId: `T${i}`, title, category: 'geo', impact, effortMinutes: minutes, stepCount: steps,
    whyItMatters: null, steps: null, doneCheck: null, status: 'todo' as const,
  });
  return {
    id: 'P1', assessmentId: 'A1', siteId: 'S1', locked: true, progress: { done: 0, verified: 0, total: 8 },
    tasks: [
      t(1, 'Put your address and hours where machines can read them', 'high', 20, 4),
      t(2, 'Write the one page that answers what people ask', 'high', 45, 6),
      t(3, 'Add prices to your shop pages', 'medium', 30, 3),
      t(4, 'A', 'low', 5, 1), t(5, 'B', 'low', 5, 1), t(6, 'C', 'low', 5, 1), t(7, 'D', 'low', 5, 1), t(8, 'E', 'low', 5, 1),
    ],
  };
}

class FakeApiClient {
  sites: SiteDto[] = [site()];
  plan: PlanDto = lockedPlan();
  listSites() { return Promise.resolve(this.sites); }
  getPlanForSite(_id: string) { return Promise.resolve(this.plan); }
  me(): Promise<UserDto> { return Promise.reject(new Error('not used')); }
}

class FakeUpgradeFlow {
  openCheckoutCalls: string[] = [];
  succeed = true;
  upgraded = true;
  async openCheckout(email: string, onSuccess: () => void): Promise<void> {
    this.openCheckoutCalls.push(email);
    if (!this.succeed) throw new Error('not_connected');
    onSuccess();
  }
  async awaitUpgrade(): Promise<boolean> { return this.upgraded; }
}

const freeUser: UserDto = { id: 'u1', email: 'dana@rivertonbakery.com', emailVerified: true, tier: 'free' };

async function setup(query: Record<string, string>, user: UserDto | null) {
  const api = new FakeApiClient();
  const flow = new FakeUpgradeFlow();
  await TestBed.configureTestingModule({
    imports: [Pricing],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: UpgradeFlow, useValue: flow },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      provideRouter([{ path: 'sites/:siteId', component: BlankPage }, { path: 'signup', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
    ],
  }).compileComponents();
  const store = TestBed.inject(UserStore);
  store.loaded.set(true);
  store.user.set(user);
  const fixture = TestBed.createComponent(Pricing);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, api, flow, el: fixture.nativeElement as HTMLElement };
}

function button(el: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text))!;
}

describe('Pricing', () => {
  it('shows the plan gate for a signed-in free user with a locked plan', async () => {
    const { el } = await setup({ site: 'S1' }, freeUser);
    const text = el.textContent ?? '';
    expect(text).toContain('YOUR PLAN IS READY');
    expect(text).toContain('Eight things to fix, written for your site.');
    expect(text).toContain('WHAT IS WAITING FOR YOU');
    expect(text).toContain('Put your address and hours where machines can read them');
    expect(text).toContain('4 steps · 20 minutes · biggest single win');
    expect(text).toContain('and five more');
    expect(text).toContain('Back to my result');
  });

  it('shows the public pricing when signed out', async () => {
    const { el } = await setup({}, null);
    const text = el.textContent ?? '';
    expect(text).toContain('Your score is free. The plan is $9 a month.');
    expect(text).not.toContain('WHAT IS WAITING FOR YOU');
    expect(text).toContain('Check my site free');
  });

  it('opens checkout with the email, then polls and navigates to the site home', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(flow.openCheckoutCalls).toEqual(['dana@rivertonbakery.com']);
    expect(TestBed.inject(Location).path()).toBe('/sites/S1');
  });

  it('shows the not-connected note when checkout is not configured', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    flow.succeed = false;
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Checkout is not connected yet.');
  });

  it('shows the timeout copy when the tier does not flip', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    flow.upgraded = false;
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Your payment went through. Your plan unlocks in a minute. Refresh this page.');
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL (the old pricing has no gate).

- [ ] **Step 8: Rewrite `Pricing`**

Replace `src/app/features/pricing/pricing.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PlanDto, SiteDto } from '../../core/api/types';
import { FREEMIUS_PORTAL_URL, PRO_PRICE_LABEL } from '../../core/config';
import { numberWord } from '../../shared/copy';
import { ImpactBadge } from '../../shared/impact-badge';
import { PlanCards } from './plan-cards';
import { UpgradeFlow } from './upgrade-flow';

type Phase = 'idle' | 'opening' | 'unlocking' | 'timeout';

@Component({
  selector: 'app-pricing',
  imports: [RouterLink, PlanCards, ImpactBadge],
  template: `
    <div class="page surface pricing">
      @if (gate(); as g) {
        <a class="back muted" [routerLink]="['/sites', g.site.id]">← Back to my result</a>
        <div class="intro stack">
          <span class="eyebrow">YOUR PLAN IS READY</span>
          <h1>{{ capWord(g.plan.tasks.length) }} things to fix, written for your site.</h1>
          <p class="lead">Your score and your findings stay free, always. The step-by-step plan, the check that confirms each fix worked, and your score history are part of Pro.</p>
        </div>
      } @else {
        <div class="intro stack">
          <span class="eyebrow">PRICING</span>
          <h1>Your score is free. The plan is {{ price }} a month.</h1>
        </div>
      }

      <app-plan-cards
        [taskCount]="gate()?.plan?.tasks?.length ?? null"
        [context]="gate() ? 'gate' : 'public'"
        [isPro]="store.user()?.tier === 'pro'"
        [busy]="phase() !== 'idle'"
        [portalUrl]="portalUrl"
        [freeButton]="gate() ? 'Stay on Free' : 'Check my site free'"
        (unlock)="unlock()"
        (stayFree)="stayFree()" />

      @if (note(); as n) {<p class="error-note" role="status">{{ n }}</p>}
      @if (phase() === 'unlocking') {<p class="muted" role="status">Unlocking your plan…</p>}
      @if (phase() === 'timeout') {
        <div class="note-box stack" role="status">
          <span>Your payment went through. Your plan unlocks in a minute. Refresh this page.</span>
          <button type="button" class="btn btn-outline" (click)="refreshOnce()">Refresh</button>
        </div>
      }

      @if (gate(); as g) {
        <section class="waiting stack divider">
          <span class="eyebrow">WHAT IS WAITING FOR YOU</span>
          <div class="card-soft list">
            @for (task of g.plan.tasks.slice(0, 3); track task.taskId; let i = $index) {
              <div class="row item">
                <span class="mono faint idx">0{{ i + 1 }}</span>
                <div class="stack tight">
                  <span class="title">{{ task.title }}</span>
                  <span class="faint small">{{ task.stepCount }} steps · {{ task.effortMinutes }} minutes{{ i === 0 ? ' · biggest single win' : '' }}</span>
                </div>
                <span class="spacer"></span>
                <app-impact-badge [impact]="task.impact" />
                <span class="mono faint small">LOCKED</span>
              </div>
            }
            @if (g.plan.tasks.length > 3) {
              <div class="row item faint"><span class="mono idx">04</span><span>and {{ word(g.plan.tasks.length - 3) }} more</span><span class="spacer"></span><span class="mono small">LOCKED</span></div>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .pricing { display: flex; flex-direction: column; align-items: center; gap: 40px; padding-top: 56px; padding-bottom: 64px; }
    .back { align-self: flex-start; font-size: 14px; }
    .intro { align-items: center; text-align: center; max-width: 54ch; }
    .intro h1 { font-size: 36px; letter-spacing: -0.03em; }
    .lead { font-size: 17px; line-height: 1.6; color: var(--body-long); }
    .waiting { width: 100%; max-width: 860px; padding-top: 26px; }
    .list { display: flex; flex-direction: column; }
    .item { padding: 16px 20px; border-bottom: 1px solid var(--line); }
    .item:last-child { border-bottom: none; }
    .idx { width: 18px; font-size: 12px; color: var(--faint-3); }
    .tight { gap: 4px; }
    .title { font-size: 15px; font-weight: 600; color: var(--ink); }
    .small { font-size: 12px; }
  `,
})
export class Pricing implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private flow = inject(UpgradeFlow);
  protected readonly store = inject(UserStore);

  protected readonly price = PRO_PRICE_LABEL;
  protected readonly portalUrl = FREEMIUS_PORTAL_URL;
  protected readonly word = numberWord;
  protected readonly gate = signal<{ site: SiteDto; plan: PlanDto } | null>(null);
  protected readonly phase = signal<Phase>('idle');
  protected readonly note = signal<string | null>(null);
  private siteId: string | null = null;

  ngOnInit(): void { void this.init(); }

  private async init(): Promise<void> {
    this.siteId = this.route.snapshot.queryParamMap.get('site');
    const user = this.store.user();
    if (!user || user.tier === 'pro') return;
    try {
      const sites = await this.api.listSites();
      const site = (this.siteId ? sites.find((s) => s.id === this.siteId) : sites.find((s) => s.latestReadyAssessmentId)) ?? null;
      if (!site || !site.latestReadyAssessmentId) return;
      const plan = await this.api.getPlanForSite(site.id);
      if (plan.locked) this.gate.set({ site, plan });
    } catch {
      // No gate: the public cards still show.
    }
  }

  protected capWord(n: number): string { const w = numberWord(n); return w.charAt(0).toUpperCase() + w.slice(1); }

  protected stayFree(): void {
    const g = this.gate();
    void this.router.navigateByUrl(g ? `/sites/${g.site.id}` : this.store.user() ? '/dashboard' : '/');
  }

  protected async unlock(): Promise<void> {
    const user = this.store.user();
    if (!user) { void this.router.navigateByUrl('/signup'); return; }
    if (this.phase() !== 'idle') return;
    this.note.set(null);
    this.phase.set('opening');
    try {
      await this.flow.openCheckout(user.email, () => void this.afterPayment());
      // The overlay is open. Return to idle so a closed overlay leaves the button usable.
      if (this.phase() === 'opening') this.phase.set('idle');
    } catch (e) {
      this.phase.set('idle');
      this.note.set(e instanceof Error && e.message === 'not_connected' ? 'Checkout is not connected yet.' : 'Checkout did not open. Please try again.');
    }
  }

  private async afterPayment(): Promise<void> {
    this.phase.set('unlocking');
    const ok = await this.flow.awaitUpgrade();
    if (!ok) { this.phase.set('timeout'); return; }
    this.goToSite();
  }

  protected async refreshOnce(): Promise<void> {
    try {
      const me = await this.api.me();
      if (me.tier === 'pro') { this.store.user.set(me); this.goToSite(); }
    } catch {
      // Stay on the timeout copy.
    }
  }

  private goToSite(): void {
    const target = this.gate()?.site.id ?? this.siteId;
    void this.router.navigateByUrl(target ? `/sites/${target}` : '/dashboard');
  }
}
```

- [ ] **Step 9: Run tests and build; commit**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

```bash
git add src/app/features/pricing
git commit -m "feat(frontend): plan gate, public pricing and the upgrade poll flow"
```

---

### Task 5: Progress page (screen 05)

**Files:**
- Modify: `src/app/features/progress/progress.ts`, `src/app/features/progress/progress.spec.ts`

**Interfaces (produces):**
- Exported constants for tests: `STEP_LABELS: Record<'queued'|'crawling'|'analyzing'|'planning', { active: string; done: string }>`, `FAILURE_HEADLINES: Record<string, string>`, `failureHeadline(code: string | null): string`.
- On `ready` the page navigates to `/sites/:siteId` (from the assessment DTO). On `failed` it shows the failure state in place.

- [ ] **Step 1: Write the failing tests**

Add these tests to `progress.spec.ts` inside the existing `describe`. The file already has `FakeApiClient`, `FakeEventSource`, `makeAssessment`, `BlankPage`, and a `provideRouter` list; add `{ path: 'sites/:siteId', component: BlankPage }` to that list and update `makeAssessment` if needed so `siteId` is `'S1'`.

```ts
  it('names the rail steps in plain words and marks done steps with the done label', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'analyzing' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Checking how findable you are…');   // headline = active label + …
    expect(text).toContain('Found your site');                  // done form
    expect(text).toContain('Read your pages');                  // done form
    expect(text).toContain('Writing your plan');                // later step keeps the active form
    expect(text).toContain('You can close this tab. We will email you when your result is ready.');
    expect(text).toContain('QUEUED → CRAWLING → ANALYZING → PLANNING');
  });

  it('shows the failure state with the headline for the code, the message verbatim and the free quota note', async () => {
    TestBed.inject(UserStore).user.set({ id: 'u1', email: 'a@example.com', emailVerified: true, tier: 'free' } as UserDto);
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'failed', errorCode: 'robots_blocked', errorMessage: 'Your robots.txt file tells crawlers to stay away.' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('WE COULD NOT FINISH');
    expect(text).toContain('Your site would not let us read it.');
    expect(text).toContain('Your robots.txt file tells crawlers to stay away.');
    expect(text).toContain('Your free check this month was not used.');
    expect(text).toContain('Try again');
    expect(text).toContain('Back to my site');
  });

  it('navigates to the site home after the done beat when ready', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'ready', siteId: 'S1' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    tick();
    tick(1500);
    expect(TestBed.inject(Location).path()).toBe('/sites/S1');
  }));
```

Delete the old tests that assert the previous narration strings ("You are in line", "Done! Your plan is ready.", raw enum labels) or the old `/assessments/:id/report` navigation. Keep the SSE, retry-cap, and destroy-guard tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL on the new copy.

- [ ] **Step 3: Rewrite the template and the labels**

In `progress.ts` replace the top-level constants and the `@Component` template, and add the imports listed after the code. Keep the class body from `ngOnInit` through `cleanup()` as it is, with these three edits: (a) `applyAssessment` navigates to `` `/sites/${assessment.siteId}` `` instead of the report; (b) remove `failureMessage` and `quotaConsumed`; (c) add the members shown at the end.

```ts
export const STEP_LABELS: Record<'queued' | 'crawling' | 'analyzing' | 'planning', { active: string; done: string }> = {
  queued: { active: 'Finding your site', done: 'Found your site' },
  crawling: { active: 'Reading your pages', done: 'Read your pages' },
  analyzing: { active: 'Checking how findable you are', done: 'Checked how findable you are' },
  planning: { active: 'Writing your plan', done: 'Wrote your plan' },
};

/** Simple 4-step rail; ready/failed are terminal outcomes shown separately, not rail steps. */
const STEPS: Array<keyof typeof STEP_LABELS> = ['queued', 'crawling', 'analyzing', 'planning'];

export const FAILURE_HEADLINES: Record<string, string> = {
  robots_blocked: 'Your site would not let us read it.',
  js_only_site: 'Your site needs JavaScript to show its content.',
  site_unreachable: 'We could not reach your site.',
  invalid_url: 'We could not reach your site.',
  assessment_failed: 'Something went wrong on our side.',
};
export function failureHeadline(code: string | null): string {
  return (code && FAILURE_HEADLINES[code]) || 'We could not finish the check.';
}

const RETRY_DELAY_MS = 2000;
const DONE_BEAT_MS = 1500;
const MAX_REFETCH_FAILURES = 5;

function isTerminal(status: AssessmentStatus): boolean {
  return status === 'ready' || status === 'failed';
}

@Component({
  selector: 'app-progress',
  imports: [RouterLink, ErrorNote],
  template: `
    <div class="page surface progress">
      @if (failed(); as f) {
        <div class="stack failure">
          <span class="eyebrow tone-low">WE COULD NOT FINISH</span>
          <h1>{{ headline(f) }}</h1>
          @if (f.errorMessage) {<p class="lead">{{ f.errorMessage }}</p>}
          <div class="note-box stack tight">
            <span class="eyebrow">GOOD NEWS</span>
            <span>{{ isPro() ? 'This check did not count against your monthly checks.' : 'Your free check this month was not used.' }}</span>
          </div>
          <div class="row">
            <button type="button" class="btn btn-primary" (click)="tryAgain(f)" [disabled]="retryBusy()">Try again</button>
            <a class="btn btn-text" [routerLink]="['/sites', f.siteId]">Back to my site</a>
          </div>
          @if (retryError(); as e) {<app-error-note [error]="e" />}
        </div>
      } @else if (retriesExhausted()) {
        <div class="stack">
          <app-error-note [error]="retryError()" />
          <p><a routerLink="/dashboard">Back to my sites</a></p>
        </div>
      } @else {
        <div class="stack">
          <h1>{{ headlineActive() }}</h1>
          <p class="lead muted">You can close this tab. We will email you when your result is ready.</p>
        </div>
        <ol class="rail">
          @for (step of steps; track step) {
            <li [class.done]="isDone(step)" [class.active]="isActive(step)">
              <span class="dot" aria-hidden="true">{{ isDone(step) ? '✓' : '' }}</span>
              <span class="label">{{ isDone(step) ? labels[step].done : labels[step].active }}</span>
            </li>
          }
        </ol>
        <span class="mono faint small">QUEUED → CRAWLING → ANALYZING → PLANNING</span>
      }
    </div>
  `,
  styles: `
    .progress { max-width: 620px; padding-top: 56px; display: flex; flex-direction: column; gap: 38px; }
    h1 { font-size: 29px; letter-spacing: -0.025em; }
    .lead { font-size: 16px; line-height: 1.6; max-width: 44ch; }
    .rail { list-style: none; margin: 0; padding: 0; }
    .rail li { display: flex; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); color: var(--faint-2); }
    .rail li:last-child { border-bottom: none; }
    .rail li.active { color: var(--ink); font-weight: 600; }
    .rail li.done { color: var(--ink); }
    .dot { width: 22px; height: 22px; border-radius: 999px; border: 2px solid #e6d6be; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
    .active .dot { border-color: var(--accent); }
    .done .dot { background: var(--accent); border-color: var(--accent); color: #fff; }
    .tight { gap: 6px; }
    .small { font-size: 13px; }
  `,
})
```

New imports at the top of the file: `import { UserStore } from '../../core/auth/user-store';` (already there), and no other new import.

Add these members to the class (next to the other signals):

```ts
  protected readonly labels = STEP_LABELS;
  protected readonly retryBusy = signal(false);
  protected readonly isPro = computed(() => this.userStore.user()?.tier === 'pro');
  protected readonly headlineActive = computed(() => {
    const s = this.status();
    if (!s || s === 'ready' || s === 'failed') return 'Loading…';
    return `${STEP_LABELS[s].active}…`;
  });

  protected headline(a: AssessmentDto): string { return failureHeadline(a.errorCode); }

  protected isDone(step: keyof typeof STEP_LABELS): boolean {
    const current = this.status();
    if (!current || current === 'failed') return false;
    if (current === 'ready') return true;
    return STEPS.indexOf(step) < STEPS.indexOf(current);
  }
  protected isActive(step: keyof typeof STEP_LABELS): boolean { return this.status() === step; }

  protected tryAgain(a: AssessmentDto): void {
    if (this.retryBusy()) return;
    this.retryBusy.set(true);
    this.retryError.set(null);
    this.api.submitAssessment(a.siteId)
      .then((next) => this.router.navigateByUrl(`/assessments/${next.id}/progress`), (e: unknown) => this.retryError.set(toApiError(e)))
      .finally(() => this.retryBusy.set(false));
  }
```

Add `import { toApiError } from '../../shared/to-api-error';`. Remove `stepDone`, `NARRATION`, `QUOTA_CONSUMING_ERROR_CODES`, and the old `steps` typing (`protected readonly steps = STEPS;` stays).

Note: the same component instance handles a retry only through navigation to a new id; `this.id` is read once from the snapshot, so `navigateByUrl` to the new id re-creates the component (default `onSameUrlNavigation` re-renders through the router outlet because the URL differs).

- [ ] **Step 4: Run tests and build; commit**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

```bash
git add src/app/features/progress
git commit -m "feat(frontend): plain-word progress rail and failure state"
```

---
