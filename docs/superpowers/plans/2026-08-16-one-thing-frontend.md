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
### Task 6: The result view (screen 01) and the report route

**Files:**
- Create: `src/app/features/result/locked-plan-list.ts`
- Create: `src/app/features/result/result-view.ts`, `src/app/features/result/result-view.spec.ts`
- Modify: `src/app/features/report/report.ts`, `src/app/features/report/report.spec.ts`
- Delete: `src/app/shared/score-dial.ts`

**Interfaces (produces):**
- `<app-locked-plan-list [plan]="PlanDto">` — the "YOUR PLAN · N TASKS / LOCKED" box: first task with BIGGEST WIN and "{stepCount} steps · {min} min", tasks 2–3 with minutes, then "{N−3} more" when N > 3.
- `<app-result-view [assessment]="AssessmentDto" [plan]="PlanDto | null" [tier]="'free'|'pro'" [siteId]="string">` — screen 01. Free with a plan: shows the NEXT teaser. Pro: shows the "Do this next →" and "See all N tasks" links.
- Exported pure helpers in `result-view.ts`: `sortedFindings(findings)`, `openMinutes(plan)` (sum of `effortMinutes` over `todo` tasks), `distinctAreas(findings)`.

- [ ] **Step 1: Write the failing result-view tests**

`src/app/features/result/result-view.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ResultView } from './result-view';
import { AssessmentDto, PlanDto } from '../../core/api/types';

function assessment(): AssessmentDto {
  return {
    id: 'A1', siteId: 'S1', status: 'ready',
    scores: { seo: 62, aeo: 34, geo: 28, overall: 41 },
    summary: 'People searching Google for a bakery in Riverton can find you. People asking ChatGPT or Perplexity cannot.',
    scoreNotes: { seo: 'Indexed and titled well enough to rank.', aeo: 'Rarely pulled into the box at the top of results.', geo: 'Assistants have to guess your address and hours.' },
    pageCount: 18,
    findings: [
      { id: 'f-good', category: 'geo', severity: 'good', evidence: 'AI crawlers are allowed to read your site. Nothing to do here.', affectedPages: [] },
      { id: 'f-med', category: 'aeo', severity: 'medium', evidence: '14 of your 18 product pages give no price.', affectedPages: Array.from({ length: 14 }, (_, i) => `https://x/p${i}`) },
      { id: 'f-high', category: 'geo', severity: 'high', evidence: 'No page states your address.', affectedPages: [] },
      { id: 'f-one', category: 'seo', severity: 'low', evidence: 'One page has no title.', affectedPages: ['https://x/a'] },
    ],
    errorCode: null, errorMessage: null, createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z', changes: [],
  };
}
function plan(locked: boolean): PlanDto {
  const t = (i: number, title: string, impact: 'high' | 'medium' | 'low', minutes: number, steps: number, status: 'todo' | 'done' = 'todo') => ({
    taskId: `T${i}`, title, category: 'geo', impact, effortMinutes: minutes, stepCount: steps,
    whyItMatters: locked ? null : 'why', steps: locked ? null : Array(steps).fill('step'), doneCheck: locked ? null : 'check', status,
  });
  return { id: 'P1', assessmentId: 'A1', siteId: 'S1', locked, progress: { done: 0, verified: 0, total: 8 }, tasks: [
    t(1, 'Put your address and hours where machines can read them', 'high', 20, 4), t(2, 'Write the one page that answers what people ask', 'high', 45, 6),
    t(3, 'Add prices to your shop pages', 'medium', 30, 3), t(4, 'A', 'low', 15, 1), t(5, 'B', 'low', 15, 1), t(6, 'C', 'low', 15, 1), t(7, 'D', 'low', 15, 1), t(8, 'E', 'low', 20, 1),
  ] };
}

async function render(tier: 'free' | 'pro', p: PlanDto | null) {
  await TestBed.configureTestingModule({ imports: [ResultView], providers: [provideRouter([])] }).compileComponents();
  const fixture = TestBed.createComponent(ResultView);
  fixture.componentRef.setInput('assessment', assessment());
  fixture.componentRef.setInput('plan', p);
  fixture.componentRef.setInput('tier', tier);
  fixture.componentRef.setInput('siteId', 'S1');
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('ResultView', () => {
  it('shows the checked date, overall, band, summary, sub-scores and notes', async () => {
    const text = await render('free', plan(true));
    expect(text).toContain('CHECKED 28 JULY 2026');
    expect(text).toContain('41');
    expect(text).toContain('Needs work');
    expect(text).toContain('Visibility out of 100');
    expect(text).toContain('People asking ChatGPT or Perplexity cannot.');
    expect(text).toContain('Google search');
    expect(text).toContain('Indexed and titled well enough to rank.');
    expect(text).toContain('AI assistants');
  });

  it('sorts findings high, medium, low, good and captions the pages', async () => {
    const text = await render('free', plan(true));
    expect(text).toContain('4 things, across 3 areas');
    const hi = text.indexOf('No page states your address.');
    const med = text.indexOf('14 of your 18 product pages');
    const low = text.indexOf('One page has no title.');
    const good = text.indexOf('AI crawlers are allowed');
    expect(hi).toBeLessThan(med); expect(med).toBeLessThan(low); expect(low).toBeLessThan(good);
    expect(text).toContain('AI ASSISTANTS · AFFECTS EVERY PAGE');
    expect(text).toContain('ANSWER BOXES · 14 PAGES');
    expect(text).toContain('GOOGLE SEARCH · 1 PAGE');
    expect(text).toContain('FINE');
  });

  it('shows the NEXT teaser with the locked list for a free user', async () => {
    const text = await render('free', plan(true));
    expect(text).toContain('We wrote you eight things to fix, in order.');
    expect(text).toContain('About about 3 hours of work in total.'.replace('About about', 'About'));
    expect(text).toContain('Read my plan');
    expect(text).toContain('Included with Pro, from $9 a month');
    expect(text).toContain('YOUR PLAN · 8 TASKS');
    expect(text).toContain('BIGGEST WIN');
    expect(text).toContain('4 steps · 20 min');
    expect(text).toContain('5 more');
  });

  it('shows the pro links instead of the teaser for a pro user', async () => {
    const text = await render('pro', plan(false));
    expect(text).not.toContain('Read my plan');
    expect(text).toContain('Do this next →');
    expect(text).toContain('See all 8 tasks');
  });
});
```

Effort check: minutes of the eight `todo` tasks = 20+45+30+15+15+15+15+20 = 175 → "about 3 hours". The teaser sentence is "About 3 hours of work in total." — the component capitalises the first letter of `effortText`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: compilation error, `./result-view` not found.

- [ ] **Step 3: Write `LockedPlanList`**

`src/app/features/result/locked-plan-list.ts`:

```ts
import { Component, input } from '@angular/core';
import { PlanDto } from '../../core/api/types';

@Component({
  selector: 'app-locked-plan-list',
  template: `
    <div class="locked card-soft">
      <div class="row head"><span class="mono faint tiny">YOUR PLAN · {{ plan().tasks.length }} TASKS</span><span class="spacer"></span><span class="mono faint tiny">LOCKED</span></div>
      @for (task of plan().tasks.slice(0, 3); track task.taskId; let i = $index) {
        <div class="row item">
          <span class="box" aria-hidden="true"></span>
          <span class="title">{{ task.title }}</span>
          @if (i > 0) {<span class="faint tiny">{{ task.effortMinutes }} min</span>}
        </div>
        @if (i === 0) {
          <div class="row sub"><span class="badge badge-high">BIGGEST WIN</span><span class="faint tiny">{{ task.stepCount }} steps · {{ task.effortMinutes }} min</span></div>
        }
      }
      @if (plan().tasks.length > 3) {
        <div class="row item more"><span class="box" aria-hidden="true"></span><span class="title">{{ plan().tasks.length - 3 }} more</span></div>
      }
    </div>
  `,
  styles: `
    .locked { width: 400px; max-width: 100%; overflow: hidden; }
    .head { padding: 11px 16px; background: #faf3e9; border-bottom: 1px solid var(--line); }
    .item { padding: 13px 16px; border-bottom: 1px solid #f5ece0; gap: 11px; }
    .item:last-child { border-bottom: none; }
    .sub { padding: 0 16px 13px 43px; border-bottom: 1px solid #f5ece0; gap: 10px; }
    .box { width: 16px; height: 16px; border: 1.5px solid var(--line-input); border-radius: 4px; flex-shrink: 0; }
    .title { font-size: 14px; color: var(--ink); flex: 1; }
    .more { opacity: 0.45; }
    .tiny { font-size: 10px; letter-spacing: 0.1em; }
  `,
})
export class LockedPlanList {
  plan = input.required<PlanDto>();
}
```

- [ ] **Step 4: Write `ResultView`**

`src/app/features/result/result-view.ts`:

```ts
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssessmentDto, Finding, PlanDto, Tier } from '../../core/api/types';
import { PRO_PRICE_LABEL } from '../../core/config';
import { areaCode, areaName, bandFor, effortText, formatDate, numberWord, pagesCaption, severityOrder } from '../../shared/copy';
import { pricingUrlFor } from '../../shared/upgrade-redirect';
import { ScoreBar } from '../../shared/score-bar';
import { SeverityBadge } from '../../shared/severity-badge';
import { LockedPlanList } from './locked-plan-list';

export function sortedFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
}
export function distinctAreas(findings: Finding[]): number {
  return new Set(findings.map((f) => f.category)).size;
}
export function openMinutes(plan: PlanDto): number {
  return plan.tasks.filter((t) => t.status === 'todo').reduce((sum, t) => sum + t.effortMinutes, 0);
}

const AREAS: Array<{ key: 'seo' | 'aeo' | 'geo' }> = [{ key: 'seo' }, { key: 'aeo' }, { key: 'geo' }];

@Component({
  selector: 'app-result-view',
  imports: [RouterLink, ScoreBar, SeverityBadge, LockedPlanList],
  template: `
    <section class="two-col top">
      <div class="stack overall">
        <span class="mono faint small">CHECKED {{ checked() }}</span>
        <div class="row big">
          <span class="number">{{ scores().overall }}</span>
          <div class="stack tight">
            <span class="band" [class]="'band tone-' + band().tone">{{ band().label }}</span>
            <span class="muted">Visibility out of 100</span>
          </div>
        </div>
        <app-score-bar [value]="scores().overall" />
        @if (assessment().summary; as s) {<p class="summary">{{ s }}</p>}
      </div>
      <div class="areas">
        @for (a of areas; track a.key) {
          <div class="row area">
            <div class="stack tight name"><span class="area-name">{{ areaName(a.key) }}</span><span class="mono faint small">{{ areaCode(a.key) }}</span></div>
            <app-score-bar [value]="scores()[a.key]" [width]="130" />
            <span class="area-score">{{ scores()[a.key] }}</span>
            @if (assessment().scoreNotes; as n) {<p class="muted note">{{ n[a.key] }}</p>}
          </div>
        }
      </div>
    </section>

    <section class="stack findings">
      <div class="row baseline"><h2>What we found</h2><span class="faint">{{ findings().length }} things, across {{ areaCount() }} areas</span></div>
      @if (findings().length === 0) {
        <p class="muted">{{ tier() === 'pro' ? 'We found nothing to fix. Check again after your next change.' : 'We found nothing to fix.' }}</p>
      } @else {
        <div class="divider">
          @for (f of findings(); track f.id) {
            <div class="row finding" [class.good]="f.severity === 'good'">
              <app-severity-badge [severity]="f.severity" />
              <div class="stack tight">
                <p class="evidence">{{ f.evidence }}</p>
                <span class="mono faint small">{{ areaCode(f.category) === areaCode(f.category) ? areaName(f.category).toUpperCase() : '' }} · {{ pages(f) }}</span>
              </div>
            </div>
          }
        </div>
      }
    </section>

    @if (plan(); as p) {
      @if (tier() !== 'pro') {
        <section class="card teaser two-col">
          <div class="stack">
            <span class="eyebrow">NEXT</span>
            <h2 class="teaser-h">We wrote you {{ word(p.tasks.length) }} things to fix, in order.</h2>
            <p class="lead">Each one is a short set of steps you can follow yourself, with a way to check it worked. {{ effortSentence(p) }} The first one alone should move your score the most.</p>
            <div class="row"><a class="btn btn-primary" [routerLink]="pricingLink()" [queryParams]="{ site: siteId() }">Read my plan</a><span class="faint">Included with Pro, from {{ price }} a month</span></div>
          </div>
          <app-locked-plan-list [plan]="p" />
        </section>
      } @else {
        <div class="row pro-links">
          <a [routerLink]="['/sites', siteId()]">Do this next →</a>
          <a [routerLink]="['/assessments', assessment().id, 'plan']">See all {{ p.tasks.length }} tasks</a>
        </div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 46px; }
    .overall { width: 400px; flex-shrink: 0; gap: 16px; }
    .big { align-items: flex-end; gap: 16px; }
    .number { font-size: 92px; font-weight: 700; color: var(--ink); letter-spacing: -0.045em; line-height: 0.85; }
    .band { font-size: 20px; font-weight: 600; }
    .summary { font-size: 17px; line-height: 1.6; color: var(--body); }
    .areas { flex: 1; border-top: 1px solid var(--line); }
    .area { gap: 22px; padding: 19px 0; border-bottom: 1px solid var(--line); }
    .name { width: 150px; } .area-name { font-size: 16px; font-weight: 600; color: var(--ink); }
    .area-score { font-size: 24px; font-weight: 700; color: var(--ink); width: 40px; }
    .note { flex: 1; font-size: 14px; }
    .baseline { align-items: baseline; }
    h2 { font-size: 22px; }
    .finding { gap: 22px; padding: 20px 0; border-bottom: 1px solid var(--line); align-items: flex-start; }
    .evidence { font-size: 17px; line-height: 1.55; color: var(--ink); }
    .good .evidence { color: var(--muted); }
    .teaser { padding: 36px 40px; align-items: center; }
    .teaser-h { font-size: 27px; max-width: 26ch; }
    .lead { font-size: 16px; line-height: 1.6; color: var(--body-long); max-width: 46ch; }
    .tight { gap: 4px; } .small { font-size: 12px; }
    .pro-links { gap: 24px; }
    @media (max-width: 760px) { .overall { width: 100%; } .number { font-size: 64px; } .area { flex-wrap: wrap; } }
  `,
})
export class ResultView {
  assessment = input.required<AssessmentDto>();
  plan = input<PlanDto | null>(null);
  tier = input<Tier>('free');
  siteId = input.required<string>();

  protected readonly areas = AREAS;
  protected readonly price = PRO_PRICE_LABEL;
  protected readonly areaName = areaName;
  protected readonly areaCode = areaCode;
  protected readonly word = numberWord;
  protected readonly scores = computed(() => this.assessment().scores ?? { seo: 0, aeo: 0, geo: 0, overall: 0 });
  protected readonly band = computed(() => bandFor(this.scores().overall));
  protected readonly checked = computed(() => formatDate(this.assessment().completedAt ?? this.assessment().createdAt).toUpperCase());
  protected readonly findings = computed(() => sortedFindings(this.assessment().findings));
  protected readonly areaCount = computed(() => distinctAreas(this.assessment().findings));

  protected pages(f: Finding): string { return pagesCaption(f.affectedPages.length, this.assessment().pageCount); }
  protected pricingLink(): string { return pricingUrlFor(null); }
  protected effortSentence(p: PlanDto): string {
    const e = effortText(openMinutes(p));
    return `${e.charAt(0).toUpperCase()}${e.slice(1)} of work in total.`;
  }
}
```

Simplify the finding caption line to `{{ areaName(f.category).toUpperCase() }} · {{ pages(f) }}` — the ternary above is a leftover; write the simple form.

- [ ] **Step 5: Rewrite the report route**

Replace `src/app/features/report/report.ts`:

```ts
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto } from '../../core/api/types';
import { UserStore } from '../../core/auth/user-store';
import { SiteContext } from '../../core/site-context';
import { ErrorNote } from '../../shared/error-note';
import { toApiError } from '../../shared/to-api-error';
import { ResultView } from '../result/result-view';

@Component({
  selector: 'app-report',
  imports: [RouterLink, ErrorNote, ResultView],
  template: `
    <div class="page surface">
      @if (error(); as e) {
        <app-error-note [error]="e" />
        <p><a routerLink="/dashboard">Back to my sites</a></p>
      } @else if (assessment(); as a) {
        <app-result-view [assessment]="a" [plan]="plan()" [tier]="store.user()?.tier ?? 'free'" [siteId]="a.siteId" />
      } @else {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
})
export class Report implements OnInit, OnDestroy {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private siteContext = inject(SiteContext);
  protected readonly store = inject(UserStore);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly assessment = signal<AssessmentDto | null>(null);
  protected readonly plan = signal<PlanDto | null>(null);
  protected readonly error = signal<ApiError | null>(null);

  ngOnInit(): void { void this.init(); }
  ngOnDestroy(): void { this.siteContext.clear(); }

  private async init(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch (e) {
      this.error.set(toApiError(e));
      return;
    }
    if (assessment.status !== 'ready') {
      void this.router.navigateByUrl(`/assessments/${this.id}/progress`);
      return;
    }
    this.assessment.set(assessment);
    try {
      const sites = await this.api.listSites();
      this.siteContext.set(sites.find((s) => s.id === assessment.siteId)?.domain ?? null);
    } catch { /* the header just shows no domain */ }
    try {
      this.plan.set(await this.api.getPlanForAssessment(this.id));
    } catch { /* a missing plan hides the teaser; the result still shows */ }
  }
}
```

Update `report.spec.ts`: the `FakeApiClient` gains `listSites()` (returns `[]`) and `getPlanForAssessment()` (returns a locked plan or rejects); keep the tests "redirects to progress when not ready", "shows the error note on failure", and replace the dial assertions with `expect(text).toContain('Visibility out of 100')` and `expect(text).toContain('What we found')`. Delete `src/app/shared/score-dial.ts` and its references.

- [ ] **Step 6: Run tests and build; commit**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

```bash
git add src/app/features/result src/app/features/report src/app/shared
git commit -m "feat(frontend): result view with findings and the locked plan teaser"
```

---

### Task 7: Site home and the next-task view (screen 03), new route

**Files:**
- Create: `src/app/features/site-home/next-task-view.ts`, `src/app/features/site-home/next-task-view.spec.ts`
- Create: `src/app/features/site-home/site-home.ts`, `src/app/features/site-home/site-home.spec.ts`
- Create: `src/app/features/site-home/skips.ts` (session skip store)
- Modify: `src/app/app.routes.ts`

**Interfaces (produces):**
- `skips.ts`: `readSkips(planId): Set<string>`, `addSkip(planId, taskId)`, `clearSkips(planId)` — `sessionStorage` key `geostrategy.skipped.<planId>`.
- `nextTaskFor(plan: PlanDto, skipped: Set<string>): PlanTaskDto | null` — first `todo` task not in `skipped`; when every `todo` task is skipped, returns the first `todo` task (the caller clears the set).
- `<app-next-task-view [site] [assessment] [plan] [previousOverall] (done)="taskId" (checkAgain)>` — screen 03 without the header.
- `SiteHome` route component at `/sites/:siteId` with the states of spec §4.2.
- Routes: add `{ path: 'sites/:siteId', canActivate: [authGuard], loadComponent: … SiteHome }` before the history route.

- [ ] **Step 1: Write the failing next-task tests**

`src/app/features/site-home/next-task-view.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NextTaskView, nextTaskFor } from './next-task-view';
import { AssessmentDto, PlanDto, SiteDto } from '../../core/api/types';
import { clearSkips } from './skips';

const site: SiteDto = { id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress', latestScores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, readOnly: false, latestAssessment: null, latestReadyAssessmentId: 'A1' };
const assessment: AssessmentDto = { id: 'A1', siteId: 'S1', status: 'ready', scores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, summary: null, scoreNotes: null, findings: [], pageCount: 18, errorCode: null, errorMessage: null, createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z', changes: [] };
function plan(): PlanDto {
  const t = (i: number, title: string, minutes: number, status: 'todo' | 'done' | 'verified' = 'todo') => ({
    taskId: `T${i}`, title, category: 'geo', impact: (i === 1 ? 'high' : 'medium') as 'high' | 'medium', effortMinutes: minutes, stepCount: 4,
    whyItMatters: `why ${i}`, steps: ['Open your SEO plugin settings in WordPress.', 'Find the section called Local Business or Organization.', 'Fill in your business name, street address, phone number and opening hours.', 'Save, then clear your site cache.'], doneCheck: `check ${i}`, status,
  });
  return { id: 'P1', assessmentId: 'A1', siteId: 'S1', locked: false, progress: { done: 2, verified: 0, total: 8 }, tasks: [
    t(1, 'Put your address and hours where machines can read them', 20), t(2, 'Write the one page that answers what people ask', 45), t(3, 'Add prices to your shop pages', 30),
    t(4, 'Link your opening hours from every page footer', 15), t(5, 'E', 15), t(6, 'F', 15), t(7, 'G', 20, 'done'), t(8, 'H', 20, 'done'),
  ] };
}

describe('nextTaskFor', () => {
  it('returns the first todo task, skips skipped ones, and wraps when all are skipped', () => {
    const p = plan();
    expect(nextTaskFor(p, new Set())?.taskId).toBe('T1');
    expect(nextTaskFor(p, new Set(['T1']))?.taskId).toBe('T2');
    expect(nextTaskFor(p, new Set(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']))?.taskId).toBe('T1');
    const allDone = { ...p, tasks: p.tasks.map((t) => ({ ...t, status: 'done' as const })) };
    expect(nextTaskFor(allDone, new Set())).toBeNull();
  });
});

describe('NextTaskView', () => {
  beforeEach(() => clearSkips('P1'));
  async function render(p: PlanDto, previousOverall: number | null = 37) {
    await TestBed.configureTestingModule({ imports: [NextTaskView], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(NextTaskView);
    fixture.componentRef.setInput('site', site);
    fixture.componentRef.setInput('assessment', assessment);
    fixture.componentRef.setInput('plan', p);
    fixture.componentRef.setInput('previousOverall', previousOverall);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the strip, the next task with steps, and the THEN list', async () => {
    const fixture = await render(plan());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('41');
    expect(text).toContain('of 100');
    expect(text).toContain('Up 4 points since your last check');
    expect(text).toContain('DO THIS NEXT');
    expect(text).toContain('2 of 8 done · about 2 hours left');   // 20+45+30+15+15+15 = 140 -> 2 hours
    expect(text).toContain('See all 8');
    expect(text).toContain('BIGGEST WIN');
    expect(text).toContain('About 20 minutes');
    expect(text).toContain('Put your address and hours where machines can read them');
    expect(text).toContain('Open your SEO plugin settings in WordPress.');
    expect(text).toContain('HOW YOU KNOW IT WORKED');
    expect(text).toContain('I did this');
    expect(text).toContain('Skip for now');
    expect(text).toContain('THEN');
    expect(text).toContain('Write the one page that answers what people ask');
    expect(text).toContain('3 more');
  });

  it('skip shows the following task and emits done with the task id', async () => {
    const fixture = await render(plan());
    const el = fixture.nativeElement as HTMLElement;
    const buttons = () => Array.from(el.querySelectorAll('button'));
    buttons().find((b) => b.textContent?.includes('Skip for now'))!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Write the one page that answers what people ask');
    expect(el.textContent).not.toContain('BIGGEST WIN');
    let emitted: string | null = null;
    fixture.componentInstance.done.subscribe((id) => (emitted = id));
    buttons().find((b) => b.textContent?.includes('I did this'))!.click();
    expect(emitted).toBe('T2');
  });

  it('shows the all-done card when no todo task is left', async () => {
    const p = plan();
    const fixture = await render({ ...p, tasks: p.tasks.map((t) => ({ ...t, status: 'done' as const })) }, null);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('You have done everything on your plan.');
    expect(text).toContain('Check again');
    expect(text).not.toContain('since your last check');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: compilation error, `./next-task-view` not found.

- [ ] **Step 3: Write `skips.ts` and `NextTaskView`**

`src/app/features/site-home/skips.ts`:

```ts
/** Session-only "skip for now" set per plan. Spec §4.4. Never sent to the server. */
const KEY = (planId: string) => `geostrategy.skipped.${planId}`;

export function readSkips(planId: string): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(KEY(planId)) ?? '[]') as string[]); } catch { return new Set(); }
}
export function addSkip(planId: string, taskId: string): Set<string> {
  const s = readSkips(planId); s.add(taskId);
  sessionStorage.setItem(KEY(planId), JSON.stringify([...s]));
  return s;
}
export function clearSkips(planId: string): void { sessionStorage.removeItem(KEY(planId)); }
```

`src/app/features/site-home/next-task-view.ts`:

```ts
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssessmentDto, PlanDto, PlanTaskDto, SiteDto } from '../../core/api/types';
import { areaName, bandFor, effortText, numberWord } from '../../shared/copy';
import { openMinutes } from '../result/result-view';
import { addSkip, clearSkips, readSkips } from './skips';

export function nextTaskFor(plan: PlanDto, skipped: Set<string>): PlanTaskDto | null {
  const open = plan.tasks.filter((t) => t.status === 'todo');
  if (open.length === 0) return null;
  return open.find((t) => !skipped.has(t.taskId)) ?? open[0];
}

@Component({
  selector: 'app-next-task-view',
  imports: [RouterLink],
  template: `
    <div class="strip row">
      <div class="row big"><span class="overall">{{ overall() }}</span><span class="muted">of 100</span></div>
      <span class="vline" aria-hidden="true"></span>
      <div class="stack tight">
        <span class="semi" [class]="'semi tone-' + band().tone">{{ band().label }}</span>
        @if (delta(); as d) {<span class="muted small">{{ d }}</span>}
      </div>
      <span class="spacer"></span>
      <div class="row subs">
        <div class="stack tight right"><span class="faint small">Google search</span><strong>{{ scores().seo }}</strong></div>
        <div class="stack tight right"><span class="faint small">Answer boxes</span><strong>{{ scores().aeo }}</strong></div>
        <div class="stack tight right"><span class="faint small">AI assistants</span><strong>{{ scores().geo }}</strong></div>
      </div>
      <a class="small" [routerLink]="['/assessments', assessment().id, 'report']">Full report →</a>
      <button type="button" class="btn btn-text small" (click)="checkAgain.emit()" [disabled]="checkBusy()">Check again</button>
    </div>

    <div class="body stack">
      <div class="row baseline">
        <h1 class="eyebrow-h">DO THIS NEXT</h1>
        <span class="faint small">{{ doneCount() }} of {{ plan().tasks.length }} done · {{ effortLeft() }} left</span>
        <span class="spacer"></span>
        <a class="small" [routerLink]="['/assessments', assessment().id, 'plan']">See all {{ plan().tasks.length }}</a>
      </div>

      @if (task(); as t) {
        <article class="card task stack">
          <div class="row">
            @if (isBiggest(t)) {<span class="badge badge-high">BIGGEST WIN</span>}
            <span class="faint small">About {{ t.effortMinutes }} minutes</span><span class="faint small">·</span><span class="faint small">{{ areaName(t.category) }}</span>
          </div>
          <h2>{{ t.title }}</h2>
          @if (t.whyItMatters) {<p class="lead">{{ t.whyItMatters }}</p>}
          <ol class="steps">
            @for (s of t.steps ?? []; track $index) {<li><span class="num" aria-hidden="true">{{ $index + 1 }}</span><span>{{ s }}</span></li>}
          </ol>
          @if (t.doneCheck) {
            <div class="note-box stack tight"><span class="eyebrow">HOW YOU KNOW IT WORKED</span><span class="check">{{ t.doneCheck }}</span></div>
          }
          <div class="row">
            <button type="button" class="btn btn-primary" (click)="done.emit(t.taskId)" [disabled]="doneBusy()">I did this</button>
            <button type="button" class="btn btn-text" (click)="skip(t)">Skip for now</button>
          </div>
        </article>

        @if (then().length > 0) {
          <div class="then stack">
            <span class="eyebrow faint-3">THEN</span>
            @for (n of then(); track n.taskId) {<div class="row item"><span class="muted">{{ n.title }}</span><span class="spacer"></span><span class="faint small">{{ n.effortMinutes }} min</span></div>}
            @if (rest() > 0) {<div class="row item"><span class="faint">{{ rest() }} more</span></div>}
          </div>
        }
      } @else {
        <article class="card stack">
          <h2>You have done everything on your plan.</h2>
          <p class="lead">Check again to see your new score and to confirm your fixes.</p>
          <div class="row"><button type="button" class="btn btn-primary" (click)="checkAgain.emit()" [disabled]="checkBusy()">Check again</button></div>
        </article>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .strip { padding: 22px 44px; background: var(--strip); border-bottom: 1px solid var(--line); gap: 20px; flex-wrap: wrap; }
    .big { align-items: baseline; gap: 10px; } .overall { font-size: 30px; font-weight: 700; color: var(--ink); letter-spacing: -0.025em; }
    .vline { width: 1px; height: 30px; background: var(--line-strong); }
    .subs { gap: 24px; } .right { align-items: flex-end; } .subs strong { color: var(--ink); font-size: 16px; }
    .body { padding: 44px 44px 56px; gap: 26px; }
    .eyebrow-h { font-size: 14px; letter-spacing: 0.12em; color: var(--faint); font-weight: 700; }
    .baseline { align-items: baseline; }
    .task { padding: 38px 44px; gap: 26px; }
    h2 { font-size: 31px; letter-spacing: -0.025em; max-width: 30ch; }
    .lead { font-size: 17px; line-height: 1.65; color: var(--body-long); max-width: 58ch; }
    .steps { list-style: none; margin: 0; padding: 6px 0 0; display: flex; flex-direction: column; gap: 16px; }
    .steps li { display: flex; gap: 18px; align-items: flex-start; font-size: 17px; line-height: 1.5; color: var(--ink); }
    .num { width: 28px; height: 28px; border-radius: 999px; background: #f3e6d5; color: #8a6a48; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .check { font-size: 16px; color: var(--ink); }
    .then { padding-top: 10px; gap: 0; } .then .eyebrow { padding-bottom: 10px; color: #c0ad94; }
    .item { padding: 13px 0; border-bottom: 1px solid var(--line); } .item:last-child { border-bottom: none; }
    .semi { font-weight: 600; } .tight { gap: 3px; } .small { font-size: 13px; }
    @media (max-width: 760px) { .strip, .body { padding-left: 20px; padding-right: 20px; } .task { padding: 24px 20px; } }
  `,
})
export class NextTaskView {
  site = input.required<SiteDto>();
  assessment = input.required<AssessmentDto>();
  plan = input.required<PlanDto>();
  previousOverall = input<number | null>(null);
  doneBusy = input(false);
  checkBusy = input(false);
  done = output<string>();
  checkAgain = output<void>();

  protected readonly areaName = areaName;
  private readonly skipped = signal<Set<string>>(new Set());
  constructor() {
    effect(() => { this.skipped.set(readSkips(this.plan().id)); });
  }

  protected readonly scores = computed(() => this.assessment().scores ?? { seo: 0, aeo: 0, geo: 0, overall: 0 });
  protected readonly overall = computed(() => this.scores().overall);
  protected readonly band = computed(() => bandFor(this.overall()));
  protected readonly delta = computed(() => {
    const prev = this.previousOverall();
    if (prev == null) return '';
    const d = this.overall() - prev;
    if (d > 0) return `Up ${d} points since your last check`;
    if (d < 0) return `Down ${-d} points since your last check`;
    return 'Same as your last check';
  });
  protected readonly doneCount = computed(() => this.plan().tasks.filter((t) => t.status !== 'todo').length);
  protected readonly effortLeft = computed(() => effortText(openMinutes(this.plan())));
  protected readonly task = computed(() => nextTaskFor(this.plan(), this.skipped()));
  protected readonly then = computed(() => {
    const t = this.task();
    const open = this.plan().tasks.filter((x) => x.status === 'todo' && x.taskId !== t?.taskId);
    return open.slice(0, 3);
  });
  protected readonly rest = computed(() => {
    const t = this.task();
    return Math.max(0, this.plan().tasks.filter((x) => x.status === 'todo' && x.taskId !== t?.taskId).length - 3);
  });

  protected isBiggest(t: PlanTaskDto): boolean { return this.plan().tasks[0]?.taskId === t.taskId; }

  protected skip(t: PlanTaskDto): void {
    const next = addSkip(this.plan().id, t.taskId);
    const open = this.plan().tasks.filter((x) => x.status === 'todo');
    if (open.every((x) => next.has(x.taskId))) { clearSkips(this.plan().id); this.skipped.set(new Set()); return; }
    this.skipped.set(next);
  }
}
```

`numberWord` is imported for parity with the spec's word rule in the "N more" line: the mockup shows "3 more, smaller" as digits; keep digits here (`{{ rest() }} more`) and remove the unused import.

- [ ] **Step 4: Run the next-task tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: `nextTaskFor` and `NextTaskView` tests PASS.

- [ ] **Step 5: Write the failing site-home tests**

`src/app/features/site-home/site-home.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { SiteHome } from './site-home';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { AssessmentDto, PlanDto, SiteDto, UserDto } from '../../core/api/types';

@Component({ selector: 'site-home-spec-blank', template: '' })
class BlankPage {}

function site(overrides: Partial<SiteDto> = {}): SiteDto {
  return { id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress', latestScores: null, readOnly: false, latestAssessment: null, latestReadyAssessmentId: null, ...overrides };
}
function assessment(overrides: Partial<AssessmentDto> = {}): AssessmentDto {
  return { id: 'A1', siteId: 'S1', status: 'ready', scores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, summary: 'Summary.', scoreNotes: { seo: 'a', aeo: 'b', geo: 'c' }, findings: [], pageCount: 3, errorCode: null, errorMessage: null, createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z', changes: [], ...overrides };
}
function plan(locked: boolean): PlanDto {
  return { id: 'P1', assessmentId: 'A1', siteId: 'S1', locked, progress: { done: 0, verified: 0, total: 1 }, tasks: [
    { taskId: 'T1', title: 'Put your address and hours where machines can read them', category: 'geo', impact: 'high', effortMinutes: 20, stepCount: 2, whyItMatters: locked ? null : 'why', steps: locked ? null : ['a', 'b'], doneCheck: locked ? null : 'c', status: 'todo' },
  ] };
}

class FakeApiClient {
  sites: SiteDto[] = [site()];
  assessment: AssessmentDto = assessment();
  planResult: Promise<PlanDto> = Promise.resolve(plan(true));
  history: AssessmentDto[] = [];
  submitted: string[] = [];
  patched: Array<[string, string, string]> = [];
  listSites() { return Promise.resolve(this.sites); }
  getAssessment(_id: string) { return Promise.resolve(this.assessment); }
  getPlanForAssessment(_id: string) { return this.planResult; }
  listAssessments(_id: string) { return Promise.resolve(this.history); }
  submitAssessment(id: string) { this.submitted.push(id); return Promise.resolve(assessment({ id: 'A9', status: 'queued' })); }
  setTaskStatus(planId: string, taskId: string, status: 'todo' | 'done') { this.patched.push([planId, taskId, status]); return Promise.resolve({ ...plan(false), tasks: [{ ...plan(false).tasks[0], status: 'done' as const }] }); }
  resendVerification() { return Promise.resolve(undefined); }
  me(): Promise<UserDto> { return Promise.reject(new Error('not used')); }
}

async function setup(api: FakeApiClient, tier: 'free' | 'pro' = 'free', emailVerified = true) {
  await TestBed.configureTestingModule({
    imports: [SiteHome],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ siteId: 'S1' }) } } },
      provideRouter([{ path: 'assessments/:id/progress', component: BlankPage }, { path: 'assessments/:id/plan', component: BlankPage }, { path: 'assessments/:id/report', component: BlankPage }, { path: 'pricing', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
    ],
  }).compileComponents();
  const store = TestBed.inject(UserStore);
  store.loaded.set(true);
  store.user.set({ id: 'u1', email: 'dana@rivertonbakery.com', emailVerified, tier });
  const fixture = TestBed.createComponent(SiteHome);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(t))!;

describe('SiteHome', () => {
  it('offers the first check when the site has no assessment', async () => {
    const api = new FakeApiClient();
    const { el } = await setup(api);
    expect(el.textContent).toContain('Run your first check');
    btn(el, 'Check my site').click();
    await Promise.resolve();
    expect(api.submitted).toEqual(['S1']);
  });

  it('redirects to progress while the latest assessment runs', async () => {
    const api = new FakeApiClient();
    api.sites = [site({ latestAssessment: { id: 'A1', status: 'crawling', createdAt: '', completedAt: null } })];
    await setup(api);
    expect(TestBed.inject(Location).path()).toBe('/assessments/A1/progress');
  });

  it('shows the failure panel when the latest failed and nothing was ready before', async () => {
    const api = new FakeApiClient();
    api.sites = [site({ latestAssessment: { id: 'A1', status: 'failed', createdAt: '', completedAt: '' } })];
    api.assessment = assessment({ status: 'failed', errorCode: 'robots_blocked', errorMessage: 'Robots says no.' });
    const { el } = await setup(api);
    expect(el.textContent).toContain('Your site would not let us read it.');
    expect(el.textContent).toContain('Robots says no.');
    expect(el.textContent).toContain('Try again');
  });

  it('shows the free result with the teaser when ready and free', async () => {
    const api = new FakeApiClient();
    api.sites = [site({ latestAssessment: { id: 'A1', status: 'ready', createdAt: '', completedAt: '' }, latestReadyAssessmentId: 'A1' })];
    const { el } = await setup(api, 'free');
    expect(el.textContent).toContain('Visibility out of 100');
    expect(el.textContent).toContain('Read my plan');
    expect(el.textContent).not.toContain('DO THIS NEXT');
  });

  it('shows the next-task view for pro, patches done and reloads the plan', async () => {
    const api = new FakeApiClient();
    api.sites = [site({ latestAssessment: { id: 'A1', status: 'ready', createdAt: '', completedAt: '' }, latestReadyAssessmentId: 'A1' })];
    api.planResult = Promise.resolve(plan(false));
    api.history = [assessment(), assessment({ id: 'A0', scores: { seo: 60, aeo: 30, geo: 21, overall: 37 }, completedAt: '2026-07-14T10:00:00Z' })];
    const { el, fixture } = await setup(api, 'pro');
    expect(el.textContent).toContain('DO THIS NEXT');
    expect(el.textContent).toContain('Up 4 points since your last check');
    btn(el, 'I did this').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.patched).toEqual([['P1', 'T1', 'done']]);
    expect(el.textContent).toContain('You have done everything on your plan.');
  });

  it('shows the earlier result with a note when the latest failed after a ready check', async () => {
    const api = new FakeApiClient();
    api.sites = [site({ latestAssessment: { id: 'A2', status: 'failed', createdAt: '2026-08-01T00:00:00Z', completedAt: '2026-08-01T00:01:00Z' }, latestReadyAssessmentId: 'A1' })];
    const failed = assessment({ id: 'A2', status: 'failed', errorCode: 'site_unreachable', errorMessage: 'We could not reach it.' });
    const ready = assessment();
    api.getAssessment = (id: string) => Promise.resolve(id === 'A2' ? failed : ready);
    const { el } = await setup(api, 'free');
    expect(el.textContent).toContain('Your last check on 1 August 2026 did not finish. We could not reach it.');
    expect(el.textContent).toContain('Visibility out of 100');
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: compilation error, `./site-home` not found.

- [ ] **Step 7: Write `SiteHome`**

`src/app/features/site-home/site-home.ts`:

```ts
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto, SiteDto } from '../../core/api/types';
import { UserStore } from '../../core/auth/user-store';
import { SiteContext } from '../../core/site-context';
import { ErrorNote } from '../../shared/error-note';
import { assessmentErrorCopy } from '../../shared/assessment-error-copy';
import { formatDate } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { isUpgradeRequired, pricingUrlFor } from '../../shared/upgrade-redirect';
import { failureHeadline } from '../progress/progress';
import { ResultView } from '../result/result-view';
import { NextTaskView } from './next-task-view';

type State =
  | { kind: 'loading' }
  | { kind: 'first' }
  | { kind: 'failed'; failed: AssessmentDto }
  | { kind: 'ready'; assessment: AssessmentDto; plan: PlanDto | null; failedNote: AssessmentDto | null; previousOverall: number | null }
  | { kind: 'error'; error: ApiError };

@Component({
  selector: 'app-site-home',
  imports: [RouterLink, ErrorNote, ResultView, NextTaskView],
  template: `
    <div class="page surface home" [class.flush]="state().kind === 'ready' && isPro()">
      @switch (state().kind) {
        @case ('loading') {<p class="muted">Loading…</p>}
        @case ('error') {<app-error-note [error]="errorOf()" /><p><a routerLink="/dashboard">Back to my sites</a></p>}
        @case ('first') {
          <section class="card stack first">
            <span class="eyebrow">YOUR SITE</span>
            <h1>{{ site()?.domain }}</h1>
            <p class="lead">Run your first check. It takes about two minutes. We read your pages and score how findable you are.</p>
            @if (!emailVerified()) {
              <div class="note-box stack tight"><span>Confirm your email first. Click the link in the email we sent you.</span><button type="button" class="btn btn-outline" (click)="resend()" [disabled]="resendBusy()">Send it again</button>@if (resent()) {<span class="muted">Sent. Check your inbox.</span>}</div>
            }
            <div class="row"><button type="button" class="btn btn-primary" (click)="check()" [disabled]="!emailVerified() || checkBusy()">Check my site</button></div>
            @if (checkError(); as e) {<p class="error-note" role="alert">{{ assessmentErrorCopy(e) }}</p>}
          </section>
        }
        @case ('failed') {
          <section class="stack failure">
            <span class="eyebrow tone-low">WE COULD NOT FINISH</span>
            <h1>{{ headline(failedOf()) }}</h1>
            @if (failedOf().errorMessage; as m) {<p class="lead">{{ m }}</p>}
            <div class="note-box stack tight"><span class="eyebrow">GOOD NEWS</span><span>{{ isPro() ? 'This check did not count against your monthly checks.' : 'Your free check this month was not used.' }}</span></div>
            <div class="row"><button type="button" class="btn btn-primary" (click)="check()" [disabled]="checkBusy()">Try again</button></div>
            @if (checkError(); as e) {<p class="error-note" role="alert">{{ assessmentErrorCopy(e) }}</p>}
          </section>
        }
        @case ('ready') {
          @if (readyOf().failedNote; as f) {
            <div class="note-box row failed-note"><span>Your last check on {{ date(f) }} did not finish. {{ f.errorMessage }}</span><span class="spacer"></span><button type="button" class="btn btn-outline" (click)="check()" [disabled]="checkBusy()">Try again</button></div>
          }
          @if (isPro() && readyOf().plan; as p) {
            <app-next-task-view [site]="site()!" [assessment]="readyOf().assessment" [plan]="p" [previousOverall]="readyOf().previousOverall" [doneBusy]="doneBusy()" [checkBusy]="checkBusy()" (done)="markDone($event)" (checkAgain)="check()" />
          } @else {
            <app-result-view [assessment]="readyOf().assessment" [plan]="readyOf().plan" [tier]="isPro() ? 'pro' : 'free'" [siteId]="siteId" />
          }
          @if (checkError(); as e) {<p class="error-note" role="alert">{{ assessmentErrorCopy(e) }}</p>}
          @if (doneError(); as e) {<app-error-note [error]="e" />}
        }
      }
    </div>
  `,
  styles: `
    .home { padding-top: 52px; padding-bottom: 60px; }
    .home.flush { padding: 0; }
    .first { max-width: 620px; padding: 38px 44px; }
    h1 { font-size: 29px; }
    .lead { font-size: 16px; line-height: 1.6; color: var(--body-long); max-width: 44ch; }
    .failure { max-width: 620px; gap: 30px; }
    .failed-note { margin-bottom: 24px; }
    .tight { gap: 8px; }
  `,
})
export class SiteHome implements OnInit, OnDestroy {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private siteContext = inject(SiteContext);
  protected readonly store = inject(UserStore);

  protected readonly siteId = this.route.snapshot.paramMap.get('siteId')!;
  protected readonly site = signal<SiteDto | null>(null);
  protected readonly state = signal<State>({ kind: 'loading' });
  protected readonly checkBusy = signal(false);
  protected readonly checkError = signal<ApiError | null>(null);
  protected readonly doneBusy = signal(false);
  protected readonly doneError = signal<ApiError | null>(null);
  protected readonly resendBusy = signal(false);
  protected readonly resent = signal(false);
  protected readonly assessmentErrorCopy = assessmentErrorCopy;
  protected readonly isPro = computed(() => this.store.user()?.tier === 'pro');
  protected readonly emailVerified = computed(() => this.store.user()?.emailVerified === true);

  ngOnInit(): void { void this.load(); }
  ngOnDestroy(): void { this.siteContext.clear(); }

  private async load(): Promise<void> {
    try {
      const sites = await this.api.listSites();
      const site = sites.find((s) => s.id === this.siteId);
      if (!site) { this.state.set({ kind: 'error', error: new ApiError('not_found', "We couldn't find that site.", 404) }); return; }
      this.site.set(site);
      this.siteContext.set(site.domain);
      const latest = site.latestAssessment;
      if (!latest) { this.state.set({ kind: 'first' }); return; }
      if (latest.status !== 'ready' && latest.status !== 'failed') { void this.router.navigateByUrl(`/assessments/${latest.id}/progress`); return; }
      if (latest.status === 'failed' && !site.latestReadyAssessmentId) {
        this.state.set({ kind: 'failed', failed: await this.api.getAssessment(latest.id) });
        return;
      }
      const readyId = latest.status === 'ready' ? latest.id : site.latestReadyAssessmentId!;
      const [assessment, failedNote] = await Promise.all([
        this.api.getAssessment(readyId),
        latest.status === 'failed' ? this.api.getAssessment(latest.id) : Promise.resolve(null),
      ]);
      const plan = await this.api.getPlanForAssessment(readyId).catch(() => null);
      let previousOverall: number | null = null;
      if (this.isPro()) {
        try {
          const history = await this.api.listAssessments(this.siteId);
          const ready = history.filter((a) => a.status === 'ready' && a.scores);
          const idx = ready.findIndex((a) => a.id === readyId);
          const prev = idx >= 0 ? ready[idx + 1] : null;
          previousOverall = prev?.scores?.overall ?? null;
        } catch { /* no delta line */ }
      }
      this.state.set({ kind: 'ready', assessment, plan, failedNote, previousOverall });
    } catch (e) {
      if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
      this.state.set({ kind: 'error', error: toApiError(e) });
    }
  }

  protected errorOf(): ApiError { const s = this.state(); return s.kind === 'error' ? s.error : new ApiError('unknown', '', 0); }
  protected failedOf(): AssessmentDto { const s = this.state(); return s.kind === 'failed' ? s.failed : (null as unknown as AssessmentDto); }
  protected readyOf() { const s = this.state(); return s.kind === 'ready' ? s : (null as unknown as Extract<State, { kind: 'ready' }>); }
  protected headline(a: AssessmentDto): string { return failureHeadline(a.errorCode); }
  protected date(a: AssessmentDto): string { return formatDate(a.completedAt ?? a.createdAt); }

  protected check(): void {
    if (this.checkBusy()) return;
    this.checkBusy.set(true);
    this.checkError.set(null);
    this.api.submitAssessment(this.siteId)
      .then((a) => this.router.navigateByUrl(`/assessments/${a.id}/progress`), (e: unknown) => {
        if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
        this.checkError.set(toApiError(e));
      })
      .finally(() => this.checkBusy.set(false));
  }

  protected markDone(taskId: string): void {
    const s = this.state();
    if (s.kind !== 'ready' || !s.plan || this.doneBusy()) return;
    this.doneBusy.set(true);
    this.doneError.set(null);
    this.api.setTaskStatus(s.plan.id, taskId, 'done')
      .then((plan) => this.state.set({ ...s, plan }), (e: unknown) => {
        if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
        this.doneError.set(toApiError(e));
      })
      .finally(() => this.doneBusy.set(false));
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.api.resendVerification().then(() => this.resent.set(true), (e: unknown) => this.checkError.set(toApiError(e))).finally(() => this.resendBusy.set(false));
  }
}
```

- [ ] **Step 8: Add the route**

In `src/app/app.routes.ts`, add before the `sites/:siteId/history` entry:

```ts
  { path: 'sites/:siteId', canActivate: [authGuard], loadComponent: () => import('./features/site-home/site-home').then(m => m.SiteHome) },
```

- [ ] **Step 9: Run tests and build; commit**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

```bash
git add src/app/features/site-home src/app/app.routes.ts
git commit -m "feat(frontend): site home with the free result and the pro next-task view"
```

---
### Task 8: Dashboard — redirect, site list, add-site, pending URL

**Files:**
- Modify: `src/app/features/dashboard/dashboard.ts`, `dashboard.html`, `dashboard.spec.ts`

**Interfaces (produces):**
- Rules (spec §4.1, §5.1): on load, consume the pending URL first: create the site, then submit the check, then navigate to progress. Without a pending URL: 0 sites → the add form; exactly 1 site → redirect to `/sites/:id`; 2+ sites → the list + add form (when `sitesUsed < sitesLimit`, read from `GET /v1/me/usage`).
- The list card: domain, `platform · last checked {date}` or `No check yet`, overall, "Read-only" pill and "Upgrade to work with this site" link on read-only sites. Click → `/sites/:id`.

- [ ] **Step 1: Rewrite the dashboard tests**

Replace `src/app/features/dashboard/dashboard.spec.ts`. Keep the helper block at the top of the current file (`BlankPage`, `setValue`, `submitForm`, `findButtonByText`, `deferred`, `makeSite`, `makeAssessment`, `makePlan`, `FakeApiClient`) with these changes: `makeSite` adds `latestAssessment: null, latestReadyAssessmentId: null`; `makeAssessment` adds `summary: null, scoreNotes: null, pageCount: null, changes: []`; `FakeApiClient` gains `usageResult: Promise<UsageDto> = Promise.resolve({ assessmentsUsed: 0, assessmentsLimit: 1, sitesUsed: 0, sitesLimit: 1, nextCheckAt: null })` and `usage() { return this.usageResult; }`; the `provideRouter` list gains `{ path: 'sites/:siteId', component: BlankPage }`. Then replace every `it(...)` with:

```ts
  it('with a pending url: creates the site, starts the check and opens progress', async () => {
    sessionStorage.setItem(PENDING_URL_KEY, 'rivertonbakery.com');
    api.createSiteResult = Promise.resolve(makeSite({ id: 'S1' }));
    api.submitAssessmentResult = Promise.resolve(makeAssessment({ id: 'A1' }));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.createSiteCalls).toEqual(['rivertonbakery.com']);
    expect(api.submitAssessmentCalls).toEqual(['S1']);
    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBeNull();
    expect(TestBed.inject(Location).path()).toBe('/assessments/A1/progress');
  });

  it('with a pending url and an unverified email: creates the site and shows the confirm note', async () => {
    sessionStorage.setItem(PENDING_URL_KEY, 'rivertonbakery.com');
    api.createSiteResult = Promise.resolve(makeSite({ id: 'S1' }));
    api.submitAssessmentResult = Promise.reject(new ApiError('email_not_verified', 'Confirm first.', 403));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Confirm your email first.');
    expect(findButtonByText(fixture.nativeElement, 'Send the email again')).not.toBeNull();
  });

  it('with no sites shows the add form only', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Add your site');
    expect(addSiteInput(el)).not.toBeNull();
  });

  it('with exactly one site redirects to the site home', async () => {
    api.listSitesResult = Promise.resolve([makeSite({ id: 'S1' })]);
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('/sites/S1');
  });

  it('with two sites lists them with scores and read-only state, and hides the add form at the cap', async () => {
    api.listSitesResult = Promise.resolve([
      makeSite({ id: 'S1', domain: 'one.com', platform: 'wordpress', latestScores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, latestAssessment: { id: 'A1', status: 'ready', createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z' }, latestReadyAssessmentId: 'A1' }),
      makeSite({ id: 'S2', domain: 'two.com', readOnly: true }),
    ]);
    api.usageResult = Promise.resolve({ assessmentsUsed: 0, assessmentsLimit: 1, sitesUsed: 2, sitesLimit: 2, nextCheckAt: null });
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('one.com');
    expect(text).toContain('wordpress · last checked 28 July 2026');
    expect(text).toContain('41');
    expect(text).toContain('two.com');
    expect(text).toContain('No check yet');
    expect(text).toContain('Read-only');
    expect(text).toContain('Upgrade to work with this site');
    expect(addSiteInput(el)).toBeNull();
  });

  it('adding a site from the form navigates to the new site home', async () => {
    api.listSitesResult = Promise.resolve([]);
    api.createSiteResult = Promise.resolve(makeSite({ id: 'S7' }));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    setValue(addSiteInput(el), 'new.example.com');
    fixture.detectChanges();
    submitForm(el);
    await fixture.whenStable();
    expect(api.createSiteCalls).toEqual(['new.example.com']);
    expect(TestBed.inject(Location).path()).toBe('/sites/S7');
  });
```

`addSiteInput` may return `null` now: change its return type to `HTMLInputElement | null` and use `!` where a test needs it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL.

- [ ] **Step 3: Rewrite the dashboard**

`src/app/features/dashboard/dashboard.ts`:

```ts
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { SiteDto, UsageDto } from '../../core/api/types';
import { PENDING_URL_KEY } from '../../core/config';
import { ErrorNote } from '../../shared/error-note';
import { assessmentErrorCopy } from '../../shared/assessment-error-copy';
import { formatDate } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { pricingUrlFor } from '../../shared/upgrade-redirect';

@Component({
  selector: 'app-dashboard',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  templateUrl: './dashboard.html',
  styles: `
    .dash { padding-top: 48px; display: flex; flex-direction: column; gap: 34px; max-width: 760px; }
    .site-card { display: flex; align-items: center; gap: 14px; padding: 16px 20px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-small); color: inherit; }
    .site-card .domain { font-size: 16px; font-weight: 600; color: var(--ink); }
    .site-card .score { font-size: 20px; font-weight: 700; color: var(--ink); }
    .add { max-width: 480px; }
    .small { font-size: 13px; }
  `,
})
export class Dashboard implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  protected readonly store = inject(UserStore);

  protected readonly sites = signal<SiteDto[]>([]);
  protected readonly usage = signal<UsageDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly addBusy = signal(false);
  protected readonly addError = signal<ApiError | null>(null);
  protected readonly checkError = signal<ApiError | null>(null);
  protected readonly resent = signal(false);
  protected readonly resendBusy = signal(false);
  protected readonly assessmentErrorCopy = assessmentErrorCopy;
  protected readonly pricingUrl = pricingUrlFor;

  protected readonly addForm = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  ngOnInit(): void { void this.init(); }

  private async init(): Promise<void> {
    const pendingUrl = sessionStorage.getItem(PENDING_URL_KEY);
    if (pendingUrl) {
      sessionStorage.removeItem(PENDING_URL_KEY);
      await this.createAndCheck(pendingUrl);
      if (this.checkError() === null && this.addError() === null) return; // navigated away
    }
    await this.loadSites();
  }

  /** Landing hand-off: create the site, start the first check, open progress. Spec §5.1. */
  private async createAndCheck(url: string): Promise<void> {
    let site: SiteDto;
    try {
      site = await this.api.createSite(url);
    } catch (e) {
      this.addForm.patchValue({ url });
      this.addError.set(toApiError(e));
      return;
    }
    try {
      const a = await this.api.submitAssessment(site.id);
      await this.router.navigateByUrl(`/assessments/${a.id}/progress`);
    } catch (e) {
      this.checkError.set(toApiError(e));
    }
  }

  private async loadSites(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [sites, usage] = await Promise.all([this.api.listSites(), this.api.usage().catch(() => null)]);
      const sorted = [...sites];
      this.sites.set(sorted);
      this.usage.set(usage);
      if (sorted.length === 1 && !this.checkError() && !this.addError()) {
        await this.router.navigateByUrl(`/sites/${sorted[0].id}`);
        return;
      }
    } catch (e) {
      this.error.set(toApiError(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected canAdd(): boolean {
    const u = this.usage();
    return !u || u.sitesUsed < u.sitesLimit;
  }

  protected lastChecked(site: SiteDto): string {
    const at = site.latestAssessment?.completedAt ?? site.latestAssessment?.createdAt;
    const platform = site.platform ?? 'Website';
    return at ? `${platform} · last checked ${formatDate(at)}` : 'No check yet';
  }

  protected submitAdd(): void {
    if (this.addForm.invalid || this.addBusy()) return;
    this.addBusy.set(true);
    this.addError.set(null);
    const { url } = this.addForm.getRawValue();
    this.api.createSite(url)
      .then((created) => this.router.navigateByUrl(`/sites/${created.id}`), (e: unknown) => this.addError.set(toApiError(e)))
      .finally(() => this.addBusy.set(false));
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.api.resendVerification().then(() => this.resent.set(true), (e: unknown) => this.checkError.set(toApiError(e))).finally(() => this.resendBusy.set(false));
  }
}
```

`src/app/features/dashboard/dashboard.html`:

```html
<div class="page surface dash">
  @if (checkError(); as e) {
    @if (e.code === 'email_not_verified') {
      <div class="note-box stack" role="alert">
        <p>{{ assessmentErrorCopy(e) }}</p>
        <div class="row"><button type="button" class="btn btn-outline" (click)="resend()" [disabled]="resendBusy()">Send the email again</button>@if (resent()) {<span class="muted">Sent. Check your inbox.</span>}</div>
      </div>
    } @else if (e.code === 'quota_exceeded' || e.code === 'upgrade_required' || e.code === 'site_read_only') {
      <p class="error-note" role="alert">{{ assessmentErrorCopy(e) }} <a [routerLink]="pricingUrl()">Upgrade</a></p>
    } @else {
      <app-error-note [error]="e" />
    }
  }

  @if (loading()) {
    <p class="muted">Loading your sites…</p>
  } @else if (error(); as e) {
    <app-error-note [error]="e" />
  } @else {
    @if (sites().length > 0) {
      <section class="stack">
        <span class="eyebrow">YOUR SITES</span>
        @for (site of sites(); track site.id) {
          <a class="site-card" [routerLink]="['/sites', site.id]">
            <div class="stack tight" style="flex:1; gap:4px">
              <span class="domain">{{ site.domain }}</span>
              <span class="faint small">{{ lastChecked(site) }}</span>
              @if (site.readOnly) {<span class="row small"><span class="pill pill-free">Read-only</span><a [routerLink]="pricingUrl(site.id)">Upgrade to work with this site</a></span>}
            </div>
            @if (site.latestScores; as s) {<span class="score">{{ s.overall }}</span>}
          </a>
        }
      </section>
    }

    @if (canAdd()) {
      <section class="add stack">
        <h2>{{ sites().length === 0 ? 'Add your site' : 'Add another site' }}</h2>
        <form [formGroup]="addForm" (ngSubmit)="submitAdd()" class="stack">
          <label class="stack tight"><span class="muted small">Website</span><input type="text" formControlName="url" placeholder="yourbusiness.com" autocomplete="url" /></label>
          <div class="row"><button type="submit" class="btn btn-primary" [disabled]="addBusy() || addForm.invalid">Add site</button></div>
        </form>
        @if (addError(); as e) {
          @if (e.code === 'invalid_url') {<p class="error-note" role="alert">That address does not look right. Enter it like example.com.</p>}
          @else if (e.code === 'site_exists') {<p class="error-note" role="alert">You already added this site.</p>}
          @else if (e.code === 'site_limit_reached') {<p class="error-note" role="alert">{{ e.message }} <a [routerLink]="pricingUrl()">Upgrade</a></p>}
          @else {<app-error-note [error]="e" />}
        }
      </section>
    }
  }
</div>
```

- [ ] **Step 4: Run tests and build; commit**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

```bash
git add src/app/features/dashboard
git commit -m "feat(frontend): dashboard hand-off, redirect and compact site list"
```

---

### Task 9: Plan checklist (Pro) with the Free redirect

**Files:**
- Modify: `src/app/features/plan/plan.ts`, `plan.html`, `plan.spec.ts`

**Interfaces (produces):**
- Free (`plan.locked === true`) → `router.navigateByUrl(pricingUrlFor(plan.siteId))`.
- Pro: heading "Your plan", bar, "{done} of {N} done · {effort} left", "← Do this next" link, rows with checkbox, title, area, impact badge, minutes, expand `<button aria-expanded>`.

- [ ] **Step 1: Update the plan tests**

In `plan.spec.ts`: add `{ path: 'pricing', component: BlankPage }` and `{ path: 'sites/:siteId', component: BlankPage }` to the router list (create `BlankPage` if the file has none), set `locked: false` and `stepCount` on the fixtures, keep the existing tests for the checkbox flow, busy-disable, and error reset (adjust the progress label assertion to `'1 of 2 done'`), and add:

```ts
  it('redirects a locked plan to the pricing gate for its site', async () => {
    api.getPlanForAssessmentResult = Promise.resolve(makePlan({ locked: true, siteId: 'S1' }));
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('/pricing?site=S1');
  });

  it('expands a task with a keyboard-reachable button and shows the steps', async () => {
    const fixture = TestBed.createComponent(Plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.textContent).toContain('HOW YOU KNOW IT WORKED');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL (no redirect, no `aria-expanded` button).

- [ ] **Step 3: Rewrite the plan component and template**

`src/app/features/plan/plan.ts` — replace the imports, decorator, and `init()`; keep `toggleExpand`, `isChecked`, `toggleStatus` as they are:

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { PlanDto, PlanTaskDto } from '../../core/api/types';
import { ErrorNote } from '../../shared/error-note';
import { ImpactBadge } from '../../shared/impact-badge';
import { areaName, effortText } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { isUpgradeRequired, pricingUrlFor } from '../../shared/upgrade-redirect';
import { openMinutes } from '../result/result-view';

@Component({
  selector: 'app-plan',
  imports: [RouterLink, ErrorNote, ImpactBadge],
  templateUrl: './plan.html',
  styles: `
    .plan { padding-top: 48px; display: flex; flex-direction: column; gap: 26px; }
    .task { border-bottom: 1px solid var(--line); padding: 14px 0; }
    .task-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .expand { background: none; border: none; padding: 0; text-align: left; font: inherit; color: var(--ink); font-weight: 600; cursor: pointer; flex: 1; }
    .details { padding: 12px 0 0 32px; display: flex; flex-direction: column; gap: 12px; }
    .steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; color: var(--ink); }
    .small { font-size: 13px; }
  `,
})
export class Plan implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly plan = signal<PlanDto | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly patchError = signal<ApiError | null>(null);
  protected readonly expanded = signal<string | null>(null);
  protected readonly busyTaskId = signal<string | null>(null);
  protected readonly areaName = areaName;

  protected readonly progressPercent = computed(() => {
    const p = this.plan()?.progress;
    if (!p || p.total === 0) return 0;
    return (100 * (p.done + p.verified)) / p.total;
  });
  protected readonly progressLabel = computed(() => {
    const plan = this.plan();
    if (!plan) return '';
    const p = plan.progress;
    return `${p.done + p.verified} of ${p.total} done · ${effortText(openMinutes(plan))} left`;
  });

  ngOnInit(): void { void this.init(); }

  private async init(): Promise<void> {
    try {
      const plan = await this.api.getPlanForAssessment(this.id);
      if (plan.locked) { void this.router.navigateByUrl(pricingUrlFor(plan.siteId)); return; }
      this.plan.set(plan);
    } catch (e) {
      if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(null)); return; }
      this.error.set(toApiError(e));
    }
  }
  // toggleExpand, isChecked, toggleStatus: unchanged from the current file
}
```

`src/app/features/plan/plan.html`:

```html
<div class="page surface plan">
  @if (error(); as e) {
    <app-error-note [error]="e" />
    <p><a routerLink="/dashboard">Back to my sites</a></p>
  } @else if (plan(); as p) {
    <div class="row"><a class="muted small" [routerLink]="['/sites', p.siteId]">← Do this next</a></div>
    <h1>Your plan</h1>
    <div class="bar" role="img" [attr.aria-label]="progressLabel()"><div class="bar-fill tone-high" [style.width.%]="progressPercent()"></div></div>
    <p class="muted small">{{ progressLabel() }}</p>
    @if (patchError(); as e) {<app-error-note [error]="e" />}

    <section>
      @for (task of p.tasks; track task.taskId) {
        <article class="task">
          <div class="task-header">
            <label class="row small">
              <input type="checkbox" [checked]="isChecked(task)" [disabled]="task.status === 'verified' || busyTaskId() !== null" (change)="toggleStatus(task, $event)" />
              {{ task.status === 'verified' ? 'Checked by us' : 'Done' }}
            </label>
            <button type="button" class="expand" [attr.aria-expanded]="expanded() === task.taskId" [attr.aria-controls]="'details-' + task.taskId" (click)="toggleExpand(task.taskId)">{{ task.title }}</button>
            <span class="faint small">{{ areaName(task.category) }}</span>
            <app-impact-badge [impact]="task.impact" />
            <span class="faint small">{{ task.effortMinutes }} min</span>
          </div>
          @if (expanded() === task.taskId) {
            <div class="details" [id]="'details-' + task.taskId">
              @if (task.whyItMatters) {<p>{{ task.whyItMatters }}</p>}
              <ol class="steps">@for (step of task.steps ?? []; track $index) {<li>{{ step }}</li>}</ol>
              @if (task.doneCheck) {<div class="note-box stack" style="gap:6px"><span class="eyebrow">HOW YOU KNOW IT WORKED</span><span>{{ task.doneCheck }}</span></div>}
            </div>
          }
        </article>
      }
    </section>
  } @else {
    <p class="muted">Loading…</p>
  }
</div>
```

- [ ] **Step 4: Run tests and build; commit**

Run: `npm test -- --watch=false --browsers=ChromeHeadless` then `npx ng build`
Expected: PASS, build green.

```bash
git add src/app/features/plan
git commit -m "feat(frontend): pro plan checklist with keyboard expand and the free redirect"
```

---
