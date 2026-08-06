# Angular Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GeoStrategy Angular SPA: landing, auth, dashboard, live assessment progress, report, plan checklist, history, and account — against the finished Kotlin backend.

**Architecture:** Angular 20 standalone SPA in `frontend/` at the repo root. Signals hold state. Feature routes lazy-load. A thin typed API client wraps `HttpClient` and maps the backend error envelope to a typed `ApiError`. Live progress uses the browser `EventSource` API. One small backend addition (a usage endpoint) supports the account page.

**Tech Stack:** Angular 20 (standalone components, signals, `@if`/`@for` control flow), TypeScript, Angular CLI test runner (TestBed), Playwright (one happy path, mocked backend), Cloudflare Pages for hosting.

## Global Constraints

- Frontend lives in `frontend/` at the repo root. The backend stays untouched except Task 10 Part A (usage endpoint).
- Angular 20 via `npx @angular/cli@20`. Standalone components only. No NgModules. Signals for state. Lazy `loadComponent` routes.
- No dependencies beyond what `ng new` installs, plus `@playwright/test` (dev). No chart library — charts and dials are inline SVG. No state library.
- All HTTP goes through `ApiClient` (Task 1). Every request sends `withCredentials: true`. The only request header is `Content-Type: application/json`.
- Error handling branches on the machine `code` from the error envelope `{"code","message"}` — never on `message` text.
- All user-facing copy is for a complete beginner: short sentences, active voice, no undefined jargon, one action per instruction (ASD-STE100 aligned). Documentation (README additions) is ASD-STE100.
- Tests use `describe`/`it`/`expect` + Angular `TestBed` only. No `jasmine.createSpy` — use hand-rolled fakes, so tests stay runner-agnostic.
- Unit test command: `npm test -- --watch=false`. Run from `frontend/`.
- Unknown external values (Freemius product/plan ids, production domains) get named placeholder constants (`REPLACE_ME_*`) — do not block on them.
- The exact backend API contract is in the "Backend API Contract" section below. The TypeScript types in Task 1 mirror it exactly. Do not invent fields.
- Commit after every task. Frontend commits use the `feat(frontend):`/`fix(frontend):`/`test(frontend):` prefixes.

## Backend API Contract (authoritative for this plan)

Serializer: all fields always emitted; nullable fields serialize as explicit `null`. JSON names equal the names below.

```
GET    /healthz                              | none    | 200 text "ok"
POST   /v1/auth/register                     | none    | body {email, password} -> 201 {ok} | invalid_email 400, weak_password 400, email_taken 409
POST   /v1/auth/verify-email                 | none    | body {token} -> 200 {ok} | invalid_token 400
POST   /v1/auth/login                        | none    | body {email, password} -> 200 UserDto + Set-Cookie gs_session | invalid_credentials 401
GET    /v1/me                                | session | 200 UserDto | unauthenticated 401
POST   /v1/auth/logout                       | any     | 204, clears cookie
POST   /v1/auth/resend-verification          | session | 202 {ok} | unauthenticated 401
POST   /v1/auth/password-reset/request       | none    | body {email} -> always 202 {ok}
POST   /v1/auth/password-reset/confirm       | none    | body {token, newPassword} -> 200 {ok} | weak_password 400, invalid_token 400 (revokes all sessions)
GET    /v1/auth/google/start                 | none    | 302 to Google | google_disabled 404
GET    /v1/auth/google/callback              | none    | 302 to {APP_URL}/auth/complete with session cookie set
POST   /v1/sites                             | session | body {url} -> 201 SiteDto | invalid_url 400, site_limit_reached 403, site_exists 409
GET    /v1/sites                             | session | 200 {sites: SiteDto[]}
POST   /v1/sites/{siteId}/assessments        | session | no body -> 202 AssessmentDto (queued) | email_not_verified 403, not_found 404, site_read_only 403, upgrade_required 403, quota_exceeded 403, site_unreachable 400, invalid_url 400
GET    /v1/sites/{siteId}/assessments        | session | 200 {assessments: AssessmentDto[]} newest first | upgrade_required 403 (free tier), not_found 404
GET    /v1/assessments/{id}                  | session | 200 AssessmentDto | not_found 404
GET    /v1/assessments/{id}/events           | session | SSE stream, frames: data: {"status":"<status>"} ; closes at terminal status or server cap; NO final sentinel — re-fetch the assessment after close
GET    /v1/assessments/{id}/plan             | session | 200 PlanDto | not_found 404
GET    /v1/sites/{siteId}/plan               | session | 200 PlanDto (latest) | not_found 404
PATCH  /v1/plans/{planId}/tasks/{taskId}     | session | body {status: "todo"|"done"} -> 200 PlanDto (full, recomputed progress) | invalid_status 400, not_found 404
```

DTOs (exact JSON names):

```
UserDto        { id, email, emailVerified, tier }                      // tier: "free"|"pro"
SiteDto        { id, domain, url, platform|null, latestScores: Scores|null, readOnly }
Scores         { seo, aeo, geo }                                       // ints 0-100
Finding        { id, category, severity, evidence, affectedPages: string[] }
AssessmentDto  { id, siteId, status, scores: Scores|null, findings: Finding[],
                 errorCode|null, errorMessage|null, createdAt, completedAt|null }  // ISO-8601 strings
PlanTaskDto    { taskId, title, category, impact, effortMinutes, whyItMatters,
                 steps: string[], doneCheck, status }                  // status: "todo"|"done"|"verified"
PlanDto        { id, assessmentId, siteId, tasks: PlanTaskDto[], progress: {done, verified, total} }
```

- `AssessmentDto.status`: `queued | crawling | analyzing | planning | ready | failed` (terminal: ready, failed).
- Background failure codes surfaced in `AssessmentDto.errorCode`: `js_only_site`, `robots_blocked`, `site_unreachable`, `assessment_failed`, `invalid_url`.
- `PlanTaskDto.status` `verified` is server-set; the client may PATCH only `todo`/`done`.
- Error envelope everywhere: `{"code": string, "message": string}`. `401 unauthenticated` on every protected route without a valid session.
- Session cookie `gs_session` is HttpOnly — the SPA never reads it; auth state comes from `GET /v1/me`.
- Google flow: navigate the BROWSER (full page redirect) to `{apiBase}/v1/auth/google/start`; the callback redirects the browser back to `{APP_URL}/auth/complete`.
- Dev setup: the Angular dev server proxies `/v1` and `/healthz` to `http://localhost:8080`, so the app and API share an origin in dev and cookies flow without CORS.

## File Structure

```
frontend/
  proxy.conf.json
  playwright.config.ts
  e2e/happy-path.spec.ts
  public/_redirects                      # Cloudflare Pages SPA fallback
  src/app/
    app.config.ts, app.routes.ts, app.ts, app.html, app.css   # shell (header/nav/outlet)
    core/
      config.ts                          # API_BASE, FREEMIUS consts
      api/types.ts                       # full contract types
      api/api-client.ts                  # typed client + ApiError
      api/credentials.interceptor.ts
      auth/user-store.ts                 # signals: user, loaded
      auth/guards.ts                     # authGuard, guestGuard
      sse/assessment-stream.ts           # EventSource wrapper
    shared/
      score-dial.ts                      # SVG dial component
      error-note.ts                      # inline error box component
    features/
      landing/landing.ts
      pricing/pricing.ts
      legal/terms.ts, legal/privacy.ts
      auth/login.ts, auth/register.ts, auth/verify-email.ts, auth/auth-complete.ts
      auth/reset-request.ts, auth/reset-confirm.ts
      dashboard/dashboard.ts
      progress/progress.ts
      report/report.ts
      plan/plan.ts
      history/history.ts
      account/account.ts
backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt     # Task 10A: + GET /v1/me/usage
```

Each feature file is one standalone component with an inline template (small screens) or a sibling `.html` (dashboard, plan). One component per route. Shared visual pieces live in `shared/`.

---

### Task 1: Scaffold, typed API client, user store, app shell

**Files:**
- Create: `frontend/` (via `ng new`), `frontend/proxy.conf.json`, `frontend/src/app/core/config.ts`, `frontend/src/app/core/api/types.ts`, `frontend/src/app/core/api/api-client.ts`, `frontend/src/app/core/api/credentials.interceptor.ts`, `frontend/src/app/core/auth/user-store.ts`, `frontend/src/app/core/auth/guards.ts`, `frontend/src/app/shared/error-note.ts`
- Modify: `frontend/src/app/app.config.ts`, `frontend/src/app/app.routes.ts`, `frontend/src/app/app.ts`, `frontend/src/app/app.html`, root `.gitignore` (add `frontend/node_modules`, `frontend/dist`, `frontend/.angular`)
- Test: `frontend/src/app/core/api/api-client.spec.ts`, `frontend/src/app/app.spec.ts`

**Interfaces:**
- Consumes: the Backend API Contract above.
- Produces (every later task relies on these exact names):
  - `ApiError { code: string; message: string; status: number }` (class, `instanceof`-checkable)
  - `ApiClient` methods: `register(email, password)`, `verifyEmail(token)`, `login(email, password): Promise<UserDto>`, `logout()`, `me(): Promise<UserDto>`, `resendVerification()`, `requestPasswordReset(email)`, `confirmPasswordReset(token, newPassword)`, `createSite(url): Promise<SiteDto>`, `listSites(): Promise<SiteDto[]>`, `submitAssessment(siteId): Promise<AssessmentDto>`, `listAssessments(siteId): Promise<AssessmentDto[]>`, `getAssessment(id): Promise<AssessmentDto>`, `getPlanForAssessment(assessmentId): Promise<PlanDto>`, `getPlanForSite(siteId): Promise<PlanDto>`, `setTaskStatus(planId, taskId, status): Promise<PlanDto>`, `usage(): Promise<UsageDto>` (endpoint arrives in Task 10; type now)
  - `UserStore` with `user: Signal<UserDto | null>`, `loaded: Signal<boolean>`, `refresh(): Promise<void>`, `clear(): void`
  - `authGuard` (redirects to `/login` when logged out), `guestGuard` (redirects to `/dashboard` when logged in)
  - `API_BASE` const (empty string: same-origin/proxied)
  - `<app-error-note [error]="..." />` renders an `ApiError | null` as a friendly box; renders nothing for `null`

- [ ] **Step 1: Scaffold**

```bash
cd /c/Users/xamcr/GeoStrategy
npx --yes @angular/cli@20 new frontend --style=css --ssr=false --skip-git --defaults
```

Verify `node --version` is >= 20 first; report BLOCKED if Node is missing. Accept whatever unit-test runner the CLI scaffolds. Add the three ignore lines to the ROOT `.gitignore` (the repo root is the git root).

- [ ] **Step 2: Dev proxy**

`frontend/proxy.conf.json`:
```json
{ "/v1": { "target": "http://localhost:8080", "secure": false }, "/healthz": { "target": "http://localhost:8080", "secure": false } }
```
In `frontend/angular.json`, under `projects.frontend.architect.serve.options`, add `"proxyConfig": "proxy.conf.json"` (create the `options` object if the scaffold did not).

- [ ] **Step 3: Config and contract types**

`src/app/core/config.ts`:
```ts
export const API_BASE = ''; // same origin: dev proxy in dev, Cloudflare route in prod
export const FREEMIUS_PRODUCT_ID = 'REPLACE_ME_FREEMIUS_PRODUCT_ID';
export const FREEMIUS_PUBLIC_KEY = 'REPLACE_ME_FREEMIUS_PUBLIC_KEY';
export const FREEMIUS_PORTAL_URL = 'https://users.freemius.com'; // customer portal entry
```

`src/app/core/api/types.ts` — transcribe the contract exactly:
```ts
export type Tier = 'free' | 'pro';
export type AssessmentStatus = 'queued' | 'crawling' | 'analyzing' | 'planning' | 'ready' | 'failed';
export type TaskStatus = 'todo' | 'done' | 'verified';
export type Impact = 'high' | 'medium' | 'low';

export interface UserDto { id: string; email: string; emailVerified: boolean; tier: Tier; }
export interface Scores { seo: number; aeo: number; geo: number; }
export interface SiteDto { id: string; domain: string; url: string; platform: string | null; latestScores: Scores | null; readOnly: boolean; }
export interface Finding { id: string; category: string; severity: string; evidence: string; affectedPages: string[]; }
export interface AssessmentDto {
  id: string; siteId: string; status: AssessmentStatus; scores: Scores | null;
  findings: Finding[]; errorCode: string | null; errorMessage: string | null;
  createdAt: string; completedAt: string | null;
}
export interface PlanTaskDto {
  taskId: string; title: string; category: string; impact: Impact; effortMinutes: number;
  whyItMatters: string; steps: string[]; doneCheck: string; status: TaskStatus;
}
export interface PlanProgressDto { done: number; verified: number; total: number; }
export interface PlanDto { id: string; assessmentId: string; siteId: string; tasks: PlanTaskDto[]; progress: PlanProgressDto; }
export interface UsageDto { assessmentsUsed: number; assessmentsLimit: number; sitesUsed: number; sitesLimit: number; }
```

- [ ] **Step 4: Interceptor, ApiError, ApiClient**

`src/app/core/api/credentials.interceptor.ts`:
```ts
import { HttpInterceptorFn } from '@angular/common/http';
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
```

`src/app/core/api/api-client.ts`:
```ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';
import { API_BASE } from '../config';
import { AssessmentDto, PlanDto, SiteDto, UsageDto, UserDto } from './types';

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

async function unwrap<T>(obs: Observable<T>): Promise<T> {
  try {
    return await firstValueFrom(obs);
  } catch (e) {
    if (e instanceof HttpErrorResponse) {
      const body = e.error as { code?: unknown; message?: unknown } | null;
      if (body && typeof body.code === 'string') {
        throw new ApiError(body.code, typeof body.message === 'string' ? body.message : '', e.status);
      }
      throw new ApiError('network_error', 'We could not reach the server. Check your connection and try again.', e.status);
    }
    throw e;
  }
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private http = inject(HttpClient);
  private url(p: string) { return `${API_BASE}${p}`; }

  register(email: string, password: string) { return unwrap(this.http.post(this.url('/v1/auth/register'), { email, password })); }
  verifyEmail(token: string) { return unwrap(this.http.post(this.url('/v1/auth/verify-email'), { token })); }
  login(email: string, password: string) { return unwrap(this.http.post<UserDto>(this.url('/v1/auth/login'), { email, password })); }
  logout() { return unwrap(this.http.post(this.url('/v1/auth/logout'), null)); }
  me() { return unwrap(this.http.get<UserDto>(this.url('/v1/me'))); }
  resendVerification() { return unwrap(this.http.post(this.url('/v1/auth/resend-verification'), null)); }
  requestPasswordReset(email: string) { return unwrap(this.http.post(this.url('/v1/auth/password-reset/request'), { email })); }
  confirmPasswordReset(token: string, newPassword: string) { return unwrap(this.http.post(this.url('/v1/auth/password-reset/confirm'), { token, newPassword })); }
  createSite(url: string) { return unwrap(this.http.post<SiteDto>(this.url('/v1/sites'), { url })); }
  async listSites() { return (await unwrap(this.http.get<{ sites: SiteDto[] }>(this.url('/v1/sites')))).sites; }
  submitAssessment(siteId: string) { return unwrap(this.http.post<AssessmentDto>(this.url(`/v1/sites/${siteId}/assessments`), null)); }
  async listAssessments(siteId: string) { return (await unwrap(this.http.get<{ assessments: AssessmentDto[] }>(this.url(`/v1/sites/${siteId}/assessments`)))).assessments; }
  getAssessment(id: string) { return unwrap(this.http.get<AssessmentDto>(this.url(`/v1/assessments/${id}`))); }
  getPlanForAssessment(assessmentId: string) { return unwrap(this.http.get<PlanDto>(this.url(`/v1/assessments/${assessmentId}/plan`))); }
  getPlanForSite(siteId: string) { return unwrap(this.http.get<PlanDto>(this.url(`/v1/sites/${siteId}/plan`))); }
  setTaskStatus(planId: string, taskId: string, status: 'todo' | 'done') {
    return unwrap(this.http.patch<PlanDto>(this.url(`/v1/plans/${planId}/tasks/${taskId}`), { status }));
  }
  usage() { return unwrap(this.http.get<UsageDto>(this.url('/v1/me/usage'))); }
}
```

- [ ] **Step 5: UserStore and guards**

`src/app/core/auth/user-store.ts`:
```ts
import { inject, Injectable, signal } from '@angular/core';
import { ApiClient } from '../api/api-client';
import { UserDto } from '../api/types';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private api = inject(ApiClient);
  readonly user = signal<UserDto | null>(null);
  readonly loaded = signal(false);

  async refresh(): Promise<void> {
    try { this.user.set(await this.api.me()); }
    catch { this.user.set(null); }
    finally { this.loaded.set(true); }
  }
  clear(): void { this.user.set(null); this.loaded.set(true); }
}
```

`src/app/core/auth/guards.ts`:
```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserStore } from './user-store';

export const authGuard: CanActivateFn = async () => {
  const store = inject(UserStore); const router = inject(Router);
  if (!store.loaded()) await store.refresh();
  return store.user() ? true : router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = async () => {
  const store = inject(UserStore); const router = inject(Router);
  if (!store.loaded()) await store.refresh();
  return store.user() ? router.createUrlTree(['/dashboard']) : true;
};
```

- [ ] **Step 6: Error note component**

`src/app/shared/error-note.ts`:
```ts
import { Component, input } from '@angular/core';
import { ApiError } from '../core/api/api-client';

@Component({
  selector: 'app-error-note',
  template: `@if (error(); as e) {<p class="error-note" role="alert">{{ e.message || 'Something went wrong. Please try again.' }}</p>}`,
  styles: `.error-note { background: #fdecea; color: #b3261e; padding: 0.75rem 1rem; border-radius: 8px; }`,
})
export class ErrorNote {
  error = input<ApiError | null>(null);
}
```

- [ ] **Step 7: App shell, config, routes**

`src/app/app.config.ts`: add `provideHttpClient(withInterceptors([credentialsInterceptor]))` and keep `provideRouter(routes)` in the scaffolded providers.

`src/app/app.routes.ts`:
```ts
import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/guards';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/landing/landing').then(m => m.Landing) },
  { path: 'pricing', loadComponent: () => import('./features/pricing/pricing').then(m => m.Pricing) },
  { path: 'terms', loadComponent: () => import('./features/legal/terms').then(m => m.Terms) },
  { path: 'privacy', loadComponent: () => import('./features/legal/privacy').then(m => m.Privacy) },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login').then(m => m.Login) },
  { path: 'signup', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register').then(m => m.Register) },
  { path: 'verify-email', loadComponent: () => import('./features/auth/verify-email').then(m => m.VerifyEmail) },
  { path: 'auth/complete', loadComponent: () => import('./features/auth/auth-complete').then(m => m.AuthComplete) },
  { path: 'reset-password', canActivate: [guestGuard], loadComponent: () => import('./features/auth/reset-request').then(m => m.ResetRequest) },
  { path: 'reset-password/confirm', loadComponent: () => import('./features/auth/reset-confirm').then(m => m.ResetConfirm) },
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./features/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'assessments/:id/progress', canActivate: [authGuard], loadComponent: () => import('./features/progress/progress').then(m => m.Progress) },
  { path: 'assessments/:id/report', canActivate: [authGuard], loadComponent: () => import('./features/report/report').then(m => m.Report) },
  { path: 'assessments/:id/plan', canActivate: [authGuard], loadComponent: () => import('./features/plan/plan').then(m => m.Plan) },
  { path: 'sites/:siteId/history', canActivate: [authGuard], loadComponent: () => import('./features/history/history').then(m => m.History) },
  { path: 'account', canActivate: [authGuard], loadComponent: () => import('./features/account/account').then(m => m.Account) },
  { path: '**', redirectTo: '' },
];
```

For this task, create every `features/**` file as a minimal placeholder standalone component (class + `template: '<p>soon</p>'`) so the routes compile; later tasks replace them.

`src/app/app.ts` / `app.html` — header shows brand link, `Pricing`, then per auth state: `Log in` / `Sign up` when logged out; `Dashboard`, `Account`, `Log out` button when logged in. Logout calls `api.logout()`, then `store.clear()`, then navigates to `/`. Shell calls `store.refresh()` in the constructor (fire-and-forget) so the header settles on load. Keep the scaffold's `<router-outlet />`.

- [ ] **Step 8: Write the failing tests**

`src/app/core/api/api-client.spec.ts` — use `provideHttpClient(withInterceptors([credentialsInterceptor]))` + `provideHttpClientTesting()` and `HttpTestingController`:
1. `login` posts to `/v1/auth/login`, the request has `withCredentials === true`, resolves with the UserDto body.
2. An error body `{code:'quota_exceeded', message:'x'}` with status 403 rejects with `ApiError` where `code === 'quota_exceeded'` and `status === 403`.
3. An error with a non-envelope body rejects with `ApiError` code `network_error`.
4. `listSites` unwraps `{sites:[...]}` to the array.

`src/app/app.spec.ts` — app renders; shows `Log in` when `UserStore.user()` is null and `Log out` when a user is set (get the store via `TestBed.inject(UserStore)` and set its signals directly; set `loaded` true first so `refresh()` does not fire a request — also provide `provideHttpClientTesting()` and flush any `/v1/me` request the shell makes).

- [ ] **Step 9: Run tests, verify RED, implement until GREEN**

Run: `cd frontend && npm test -- --watch=false`. RED first (missing implementations), then implement Steps 3-7 fully, then GREEN.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(frontend): scaffold angular app with typed api client and auth shell"
```

### Task 2: Auth screens — register, login, verify, Google return

**Files:**
- Create: `frontend/src/app/features/auth/register.ts`, `login.ts`, `verify-email.ts`, `auth-complete.ts`
- Test: `frontend/src/app/features/auth/auth.spec.ts`

**Interfaces:**
- Consumes: `ApiClient`, `UserStore`, `ErrorNote`, `ApiError`, `API_BASE`.
- Produces: components `Register`, `Login`, `VerifyEmail`, `AuthComplete` (route paths fixed in Task 1).

- [ ] **Step 1: Write the failing tests** (`auth.spec.ts`)

Replace `ApiClient` in TestBed with a hand-rolled fake object whose methods return controllable promises. Test cases:
1. Register: submitting a valid form calls `register`, then shows the check-your-email panel (assert text contains "Check your email").
2. Register: rejection with `new ApiError('email_taken', '...', 409)` shows a message containing "already have an account".
3. Login: success sets the store user (fake `me` response through a real `UserStore` with the fake client) and navigates to `/dashboard` (inject `Router`, replace with a fake object recording `navigateByUrl` calls).
4. Login: `ApiError('invalid_credentials', ..., 401)` renders the error note.
5. VerifyEmail: with `?token=abc` in the route (`provideRouter` + `RouterTestingHarness`, or provide a stub `ActivatedRoute` with the query param), it calls `verifyEmail('abc')` and shows success text; `invalid_token` shows "link does not work" text and a log-in link.

- [ ] **Step 2: Run tests — expect FAIL** (components are placeholders)

- [ ] **Step 3: Implement**

All four are standalone components with inline templates and `ReactiveFormsModule` where there is a form. `busy` and `error` signals; disable the submit button while busy.

`register.ts` — form `{email, password}`. On submit call `api.register`; on success set `sent` signal → template swaps (`@if (sent())`) to: "Check your email. We sent you a link. Click the link to confirm your address." Error mapping: `email_taken` → "You already have an account. Log in instead." with a `/login` link; other `ApiError`s → error note with the server message. Below the form: a link styled as a button `<a [href]="googleUrl">Continue with Google</a>` with `googleUrl = API_BASE + '/v1/auth/google/start'`, and a `/login` link.

`login.ts` — form `{email, password}`. On success: `store.refresh()` then `router.navigateByUrl('/dashboard')`. On `invalid_credentials`: error note. Links: `/signup`, `/reset-password`, and the same Google link.

`verify-email.ts` — reads the `token` query param from `ActivatedRoute.snapshot.queryParamMap` in the constructor; missing token → error state without calling the API. Calls `verifyEmail`; success: "Your email is confirmed. You can log in now." + `/login` link. `invalid_token`: "This link does not work. It may be old. Log in and send a new link."

`auth-complete.ts` — Google callback lands here. Constructor: `store.refresh().then(() => router.navigateByUrl(store.user() ? '/dashboard' : '/login'))`. Template: "One moment…".

- [ ] **Step 4: Run tests — expect PASS.** Also run `npx ng build` — it must succeed.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(frontend): register, login, email verify and google return screens"`

### Task 3: Password reset screens

**Files:**
- Create: `frontend/src/app/features/auth/reset-request.ts`, `reset-confirm.ts`
- Test: `frontend/src/app/features/auth/reset.spec.ts`

**Interfaces:** consumes `ApiClient`, `ErrorNote`. Produces `ResetRequest`, `ResetConfirm`.

- [ ] **Step 1: Write the failing tests**
1. ResetRequest: submit calls `requestPasswordReset(email)` and ALWAYS shows "Check your email" after resolve (the API is enumeration-safe and returns 202 for unknown addresses too).
2. ResetConfirm: with `?token=t`, submit calls `confirmPasswordReset('t', pw)`; success shows "Your password is changed. Log in with the new password." and a `/login` link.
3. ResetConfirm: `weak_password` rejection renders the server message.

- [ ] **Step 2: RED** — `npm test -- --watch=false`.

- [ ] **Step 3: Implement** — same form pattern as Task 2. ResetConfirm with no token in the URL shows the error state immediately.

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): password reset screens"`

### Task 4: Landing, pricing, legal pages

**Files:**
- Create: `frontend/src/app/features/landing/landing.ts`, `features/pricing/pricing.ts`, `features/legal/terms.ts`, `features/legal/privacy.ts`
- Test: `frontend/src/app/features/landing/landing.spec.ts`

**Interfaces:**
- Consumes: `UserStore`, `FREEMIUS_PRODUCT_ID`, `FREEMIUS_PUBLIC_KEY`, `Router`.
- Produces: `Landing`, `Pricing`, `Terms`, `Privacy`; sessionStorage key `geostrategy.pendingUrl` (Dashboard consumes it in Task 5).

- [ ] **Step 1: Write the failing tests** (`landing.spec.ts`)
1. Landing renders the URL input and a button labeled "Check my site".
2. Submitting `example.com` while logged out stores it in sessionStorage under `geostrategy.pendingUrl` and navigates to `/signup`.
3. Submitting while logged in navigates to `/dashboard` (pendingUrl also stored).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

`landing.ts` — hero heading: "See why people cannot find your website." Sub-line: "We read your site. Then we give you a simple plan. You fix one thing at a time." URL input + "Check my site" button; on submit store the raw value in sessionStorage and navigate (`/signup` when logged out, `/dashboard` when logged in). Three short "how it works" blocks (1. Tell us your web address. 2. We check your site. 3. You follow the plan.). Footer links to `/pricing`, `/terms`, `/privacy`.

`pricing.ts` — two-column comparison from the spec: Free (1 site, 1 check each month, the full plan and task tracking) vs Pro (5 sites, 10 checks each month, re-checks with auto-verification, score history). "Go Pro" button behavior: if `FREEMIUS_PRODUCT_ID.startsWith('REPLACE_ME')`, show the note "Checkout is not connected yet." Otherwise load `https://checkout.freemius.com/js/v1/` once (append a `<script>` element; cache the load with a module-level promise), then:
```ts
const fs = (window as unknown as { FS?: { Checkout: new (o: object) => { open: (o: object) => void } } }).FS;
const handler = new fs!.Checkout({ product_id: FREEMIUS_PRODUCT_ID, public_key: FREEMIUS_PUBLIC_KEY });
handler.open({ email: store.user()?.email ?? '', success: () => location.assign('/account') });
```
Wrap in try/catch → error note "Checkout did not open. Please try again."

`terms.ts` / `privacy.ts` — short static v1 pages in plain language: what the service does, what we store (account email, site addresses, reports), and a contact placeholder `REPLACE_ME_CONTACT_EMAIL`.

- [ ] **Step 4: GREEN.** `npx ng build` passes.

- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): landing, pricing with freemius checkout stub, legal pages"`

### Task 5: Dashboard — sites, add site, start a check

**Files:**
- Create: `frontend/src/app/features/dashboard/dashboard.ts` (+ `dashboard.html`)
- Test: `frontend/src/app/features/dashboard/dashboard.spec.ts`

**Interfaces:**
- Consumes: `ApiClient`, `UserStore`, `ErrorNote`, `SiteDto`, sessionStorage `geostrategy.pendingUrl`.
- Produces: `Dashboard`. Navigation contract: starting a check navigates to `/assessments/{id}/progress`; a site card links to `/sites/{siteId}/history` (Pro) and to the latest plan via `/assessments/{assessmentId}/plan` only through the report/plan flow (plan route needs an assessment id — the card's "See my plan" uses `api.getPlanForSite(siteId)` then navigates to `/assessments/{plan.assessmentId}/plan`).

- [ ] **Step 1: Write the failing tests** (fake `ApiClient`)
1. Renders one card per site from `listSites`, with domain, three score numbers when `latestScores` is set, and "No check yet" when null.
2. A site with `readOnly: true` shows the badge text "Read only" and its "Check my site" button is disabled.
3. Submitting the add-site form calls `createSite` and prepends the new site card.
4. `createSite` rejection `site_limit_reached` renders the error note with the server message and an upgrade link to `/pricing`.
5. "Check my site" on a site calls `submitAssessment` and navigates to `/assessments/A1/progress` (fake returns `{id:'A1', ...}`).
6. `submitAssessment` rejection `email_not_verified` shows "Confirm your email first." and a "Send the email again" button that calls `resendVerification`.
7. On init with sessionStorage `geostrategy.pendingUrl` set, the add-site input is pre-filled and the key is removed.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

`dashboard.ts` state: `sites = signal<SiteDto[]>([])`, `loading`, `error`, `addError`, `checkError`, `busySiteId`. `ngOnInit`: load sites; read+clear pendingUrl into the add form.

Card layout (`dashboard.html`): domain, platform chip when set, three score chips (`SEO 72`-style) or "No check yet", buttons: "Check my site" (disabled when `readOnly` or while `busySiteId() === site.id`), "See my plan" (only when `latestScores` set), "History" link (only when `store.user()?.tier === 'pro'`). Read-only badge with the note "This site is over your plan limit. Upgrade to check it again." linking to `/pricing`.

Error mapping for `submitAssessment` (branch on `ApiError.code`):
- `email_not_verified` → "Confirm your email first. Click the link in the email we sent you." + "Send the email again" button → `api.resendVerification()` → "Sent. Check your inbox."
- `quota_exceeded` → server message + "Upgrade" link to `/pricing`.
- `upgrade_required` → "Re-checks need the Pro plan." + `/pricing` link.
- `site_read_only` → same copy as the badge note.
- anything else → error note with the server message.

Add-site error mapping: `invalid_url` → "That address does not look right. Enter it like example.com."; `site_exists` → "You already added this site."; `site_limit_reached` → server message + `/pricing` link.

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): dashboard with sites, add site and start check"`

### Task 6: Live assessment progress (SSE)

**Files:**
- Create: `frontend/src/app/core/sse/assessment-stream.ts`, `frontend/src/app/features/progress/progress.ts`
- Test: `frontend/src/app/features/progress/progress.spec.ts`

**Interfaces:**
- Consumes: `ApiClient`, `AssessmentStatus`, route param `id`.
- Produces:
  - `openAssessmentStream(id: string, onStatus: (s: AssessmentStatus) => void, onClose: () => void): () => void` — opens `EventSource(`${API_BASE}/v1/assessments/${id}/events`, { withCredentials: true })`; parses each message frame as `{status}` and forwards it; on `onerror` closes the source and calls `onClose` exactly once; the returned function closes without calling `onClose`. Injectable indirection for tests: the module also exports `let eventSourceFactory` (default `(url) => new EventSource(url, { withCredentials: true })`) and `setEventSourceFactory(f)` for test override.
  - `Progress` component; on terminal `ready` navigates to `/assessments/{id}/report`.

- [ ] **Step 1: Write the failing tests**

Override `eventSourceFactory` with a fake exposing `onmessage`/`onerror` hooks and a `close()` recorder. Fake `ApiClient.getAssessment` controls the re-fetch.
1. Status frames update the narration text: emit `{"status":"crawling"}` → text contains "Reading your pages".
2. When the fake stream errors and `getAssessment` resolves `status:'ready'`, the component navigates to `/assessments/X/report`.
3. When the stream errors and `getAssessment` resolves `status:'analyzing'` (not terminal), the component reopens a stream (factory called twice) after the retry delay (use `fakeAsync` + `tick(2000)`).
4. `status:'failed'` with `errorCode:'js_only_site'` renders the JS-only explanation text and no report link.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

Narration map (beginner voice, spec §8):
```ts
const NARRATION: Record<AssessmentStatus, string> = {
  queued: 'You are in line. We start in a moment…',
  crawling: 'Reading your pages…',
  analyzing: 'Checking your site for search engines and AI answers…',
  planning: 'Writing your step-by-step plan…',
  ready: 'Done! Your plan is ready.',
  failed: 'We could not finish the check.',
};
```
Component flow: on init `getAssessment` once (immediate terminal handling for old links), else open the stream. Status signal drives the narration line plus a simple 4-step progress rail (queued→crawling→analyzing→planning highlighted in order). On close: `getAssessment`; if `ready` → navigate to report after a 1.5 s "Done!" beat; if `failed` → failure panel; else schedule `setTimeout(reopen, 2000)`. Clean up on destroy (close stream, clear timer).

Failure panel copy by `errorCode` (fallback: `errorMessage` from the DTO, which is already beginner-written by the backend):
- `js_only_site`, `robots_blocked`, `site_unreachable`: show `errorMessage` verbatim (backend copy is authoritative), plus "Your monthly check was not used." and a "Back to my sites" link.
- `assessment_failed` or null: "Something went wrong on our side. Please try again." + back link.

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): live assessment progress over sse"`

### Task 7: Report view — dials and findings

**Files:**
- Create: `frontend/src/app/shared/score-dial.ts`, `frontend/src/app/features/report/report.ts`
- Test: `frontend/src/app/features/report/report.spec.ts`

**Interfaces:**
- Consumes: `ApiClient.getAssessment`, route param `id`.
- Produces: `<app-score-dial [label]="'SEO'" [value]="72" />` (SVG dial, 0-100) and `Report`.

- [ ] **Step 1: Write the failing tests**
1. ScoreDial renders the value text and an arc whose `stroke-dashoffset` is proportional (value 0 → full offset, 100 → 0; assert the computed attribute for value 50 is half the circumference within 1 unit).
2. Report with a ready assessment renders three dials (SEO/AEO/GEO), the findings grouped with severity badges, and a "See my plan" link to `/assessments/{id}/plan`.
3. Report with a non-ready assessment redirects to the progress route.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

`score-dial.ts`:
```ts
import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-score-dial',
  template: `
    <figure class="dial">
      <svg viewBox="0 0 120 120" width="120" height="120" role="img" [attr.aria-label]="label() + ' score ' + value()">
        <circle cx="60" cy="60" r="54" fill="none" stroke="#eee" stroke-width="10" />
        <circle cx="60" cy="60" r="54" fill="none" [attr.stroke]="color()" stroke-width="10"
                stroke-linecap="round" [attr.stroke-dasharray]="C" [attr.stroke-dashoffset]="offset()"
                transform="rotate(-90 60 60)" />
        <text x="60" y="66" text-anchor="middle" font-size="28">{{ value() }}</text>
      </svg>
      <figcaption>{{ label() }}</figcaption>
    </figure>`,
})
export class ScoreDial {
  label = input.required<string>();
  value = input.required<number>();
  readonly C = 2 * Math.PI * 54;
  offset = computed(() => this.C * (1 - Math.min(100, Math.max(0, this.value())) / 100));
  color = computed(() => this.value() >= 70 ? '#1b873f' : this.value() >= 40 ? '#b58900' : '#b3261e');
}
```

`report.ts` — load the assessment; if status is not `ready`, `router.navigateByUrl('/assessments/{id}/progress')`. Render: heading "Your site report", the three dials, a one-line meaning per score band ("Good" >= 70 / "Needs work" 40-69 / "Fix soon" < 40) under each dial, then findings grouped by `category` with a severity badge and the `evidence` sentence (already plain-language from the backend). Bottom: prominent "See my plan" link.

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): report view with score dials and findings"`

### Task 8: Plan view — the core checklist

**Files:**
- Create: `frontend/src/app/features/plan/plan.ts` (+ `plan.html`)
- Test: `frontend/src/app/features/plan/plan.spec.ts`

**Interfaces:**
- Consumes: `ApiClient.getPlanForAssessment`, `setTaskStatus`, `PlanDto`.
- Produces: `Plan` component at `/assessments/:id/plan`.

- [ ] **Step 1: Write the failing tests**
1. Renders tasks in the served order with title, category chip, impact chip, and effort ("about 15 minutes").
2. Clicking a task expands it: whyItMatters, numbered steps, doneCheck under the heading "How you know it worked".
3. Checking a task's checkbox calls `setTaskStatus(planId, taskId, 'done')` and replaces the plan with the response; the progress bar text shows the new `done+verified` of `total`.
4. A `verified` task renders a disabled checkbox with the label "Checked by us" and cannot be toggled.
5. Unchecking a `done` task PATCHes `'todo'`.
6. While a PATCH is in flight the checkbox is disabled (assert with a promise held open).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

State: `plan = signal<PlanDto | null>(null)`, `expanded = signal<string | null>(null)`, `busyTaskId = signal<string | null>(null)`, `error`. Progress bar: `width% = 100 * (progress.done + progress.verified) / progress.total`, label "You finished {done+verified} of {total} tasks." Toggle handler ignores clicks for `verified` tasks; sets busy, calls PATCH, sets the returned plan, clears busy; on `ApiError` shows the error note and leaves the old state. Impact chips colored (high red, medium amber, low green) with visible text, not color alone.

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): plan checklist with task tracking"`

### Task 9: Site history (Pro) and re-check

**Files:**
- Create: `frontend/src/app/features/history/history.ts`
- Test: `frontend/src/app/features/history/history.spec.ts`

**Interfaces:**
- Consumes: `ApiClient.listAssessments`, `submitAssessment`, route param `siteId`, `UserStore`.
- Produces: `History` at `/sites/:siteId/history`.

- [ ] **Step 1: Write the failing tests**
1. With two ready assessments (older scores 40/45/50, newer 60/65/70) it renders an SVG with three polylines and a table row per assessment (date + three scores, newest first).
2. `listAssessments` rejection `upgrade_required` renders the upsell panel ("Score history needs the Pro plan.") with a `/pricing` link — no crash.
3. "Check again" button calls `submitAssessment(siteId)` and navigates to the progress route.
4. Failed assessments in the list render a row with "Failed" and no scores, and are excluded from the chart.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

Chart: inline SVG, `viewBox="0 0 400 160"`, x spread evenly by assessment index (oldest left), y = `150 - score * 1.4`. Three `<polyline>`s (seo/aeo/geo, distinct colors, `fill="none"`) built from ready assessments (`scores != null`) in chronological order, plus a small legend. Fewer than 2 ready assessments → text "Run more checks to see your progress line." instead of the SVG. Below: the table of runs (date from `createdAt` via `toLocaleDateString()`, scores or "Failed"). Top: "Check again" button with the same error mapping as the dashboard (quota/upgrade/read-only copy reused — extract that mapping from Task 5 into a small exported function `assessmentErrorCopy(e: ApiError): string` in `dashboard.ts` or a shared module if the reviewer prefers; keep it in one place either way).

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): pro score history with trend chart and re-check"`

### Task 10: Usage endpoint (backend) + Account page

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt` (add `GET /v1/me/usage`)
- Create: `frontend/src/app/features/account/account.ts`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/UsageRouteTest.kt`, `frontend/src/app/features/account/account.spec.ts`

**Interfaces:**
- Consumes (backend): the same limit values and counting queries the assessment submission gate uses in `assessment/AssessmentRoutes.kt` and the site cap in `sites/SiteRoutes.kt` — open both files and reuse the exact same config fields and repository methods (`countNonFailedForUserSince` for assessments, the sites count/list used by the cap check, and the tier-based limit lookups). Do NOT invent new counting logic; mirror the gates so the meter always matches enforcement.
- Produces: `GET /v1/me/usage` (session-protected) → 200 `{"assessmentsUsed":int,"assessmentsLimit":int,"sitesUsed":int,"sitesLimit":int}`; `unauthenticated` 401. Frontend `Account` component.

- [ ] **Step 1 (backend): Write the failing test** — `UsageRouteTest.kt`, patterned on the existing route tests (testApplication + testDeps + registerVerifyLogin helper):
1. Fresh free user, no sites: usage returns `assessmentsUsed=0`, `sitesUsed=0`, and the free-tier limits from config.
2. After adding a site and running one assessment to `ready` (use the same canned-pipeline path `ReassessmentTest` uses, or insert an assessment document directly with a non-failed status), `assessmentsUsed=1`, `sitesUsed=1`.
3. Unauthenticated request → 401 `unauthenticated`.

- [ ] **Step 2: RED** — `cd backend && ./gradlew test --tests '*UsageRouteTest*'`.

- [ ] **Step 3 (backend): Implement** — in `AuthRoutes.kt` next to `GET /v1/me`: resolve the session user, compute the four numbers by calling exactly what the gates call, respond with a small `@Serializable UsageResponse` DTO. Run the full backend suite (`./gradlew test`) — all green.

- [ ] **Step 4 (frontend): Write the failing tests** (`account.spec.ts`, fake ApiClient)
1. Renders email, tier chip ("Free plan" / "Pro plan"), and the two meters: "Checks this month: 1 of 10", "Sites: 2 of 5" from `usage()`.
2. `emailVerified: false` shows "Confirm your email" note with the resend button.
3. Renders "Manage subscription" as an external link (`FREEMIUS_PORTAL_URL`) for pro users, and an "Upgrade" link to `/pricing` for free users.
4. Log out button calls `logout`, clears the store, navigates to `/`.

- [ ] **Step 5: RED, then implement**

`account.ts` — load `usage()` and render meters as text plus a simple `<progress>` element (`value`/`max`). Pro users get the portal link (`target="_blank" rel="noopener"`); free users the upgrade link. Reuse the resend-verification button behavior from the dashboard (extract if trivial; duplication of three lines is acceptable — do not build an abstraction for it).

- [ ] **Step 6: GREEN both sides.** Frontend `npm test -- --watch=false`; backend full suite.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: usage endpoint and account page with usage meters"`

### Task 11: Playwright happy path (mocked backend)

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/happy-path.spec.ts`
- Modify: `frontend/package.json` (devDependency `@playwright/test`, script `"e2e": "playwright test"`)

**Interfaces:** consumes the whole app over HTTP; backend fully mocked with `page.route`.

- [ ] **Step 1: Install**

```bash
cd frontend && npm i -D @playwright/test && npx playwright install chromium
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4300' },
  webServer: { command: 'npx ng serve --port 4300', url: 'http://localhost:4300', reuseExistingServer: true, timeout: 120000 },
});
```

- [ ] **Step 2: Write the journey test** (`e2e/happy-path.spec.ts`)

One test, full journey, all `/v1/**` routes intercepted with `page.route` and fulfilled from an in-test state object:
1. Open `/` → type `example.com` → "Check my site" → lands on `/signup`.
2. Register (mock 201) → "Check your email" panel.
3. Go to `/login`, log in (mock returns the user, set a state flag so subsequent `/v1/me` returns 200) → dashboard.
4. Add-site input is pre-filled with `example.com` (pendingUrl); submit (mock SiteDto S1) → card appears.
5. "Check my site" (mock 202 AssessmentDto A1 queued) → progress page. Mock the SSE route by fulfilling `/v1/assessments/A1/events` with content-type `text/event-stream` and body:
   `data: {"status":"crawling"}\n\ndata: {"status":"planning"}\n\n` — then the stream ends; mock `GET /v1/assessments/A1` to return `ready` with scores.
6. Auto-navigates to the report → three dials visible → "See my plan".
7. Plan page (mock PlanDto, 2 tasks) → check task 1 (mock PATCH returns progress done=1) → progress bar text "1 of 2".

Assert each waypoint with `await expect(page.getByText(...)).toBeVisible()`.

- [ ] **Step 3: Run** — `npx playwright test` → PASS. (RED evidence for e2e is not required — this is an integration script, not TDD of new logic.)

- [ ] **Step 4: Commit** — `git add -A && git commit -m "test(frontend): playwright happy path with mocked backend"`

### Task 12: Production build, Cloudflare Pages config, README

**Files:**
- Create: `frontend/public/_redirects`
- Modify: `frontend/README.md` (replace scaffold text), root `README.md` (if present at repo root — otherwise `backend/README.md` gains a pointer line)

**Interfaces:** none new.

- [ ] **Step 1: SPA fallback**

`frontend/public/_redirects` (Cloudflare Pages serves this from the build output):
```
/*    /index.html   200
```
Verify `npx ng build` copies it (the scaffold's `public/` assets glob does); check `frontend/dist/frontend/browser/_redirects` exists after build.

- [ ] **Step 2: Frontend README** (ASD-STE100; replace the scaffold README)

Sections:
- **What this is** — two sentences.
- **Run in development** — `npm install`; start the backend first (see backend README); `npm start` (uses the proxy to `localhost:8080`); open `http://localhost:4200`.
- **Test** — `npm test -- --watch=false`; `npm run e2e`.
- **Build** — `npx ng build`; output `dist/frontend/browser`.
- **Deploy to Cloudflare Pages** — build command `npx ng build`, output directory `dist/frontend/browser`, root directory `frontend`. The `_redirects` file makes all routes serve the app.
- **Connect to the API in production** — two options, state both: (a) same-origin: route `app.<domain>/v1/*` to the API with a Cloudflare Origin Rule / Worker (keep `API_BASE = ''`); (b) separate `api.<domain>`: set `API_BASE` in `src/app/core/config.ts` to `https://api.<domain>`, set backend env `APP_URL` to the app origin and `COOKIE_DOMAIN` to `.<domain>` so the session cookie crosses subdomains.
- **Before production** checklist: replace `REPLACE_ME_FREEMIUS_PRODUCT_ID`, `REPLACE_ME_FREEMIUS_PUBLIC_KEY`, `REPLACE_ME_CONTACT_EMAIL`; set the Google OAuth redirect URI to the API callback; test checkout in Freemius sandbox mode.

- [ ] **Step 3: Full verification**

`npm test -- --watch=false` green; `npx ng build` green; `npx playwright test` green; backend suite untouched since Task 10 (do not re-run unless Task 10+ changed backend files after its green run).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(frontend): cloudflare pages config and readme"`

---

## Self-Review Notes (checked while writing)

- **Spec coverage §8:** landing (T4), pricing (T4), login/signup (T2), legal (T4), dashboard (T5), SSE progress narration (T6), report dials + meaning lines (T7), plan checklist with persistence + progress bar (T8), history chart Pro (T9), account with usage meter + portal link (T10). Frontend practices: standalone, signals, lazy routes, thin typed client (T1). ✅
- **Spec §10 frontend testing:** component tests for plan/report rendering (T7, T8); one Playwright happy path with mocked backend (T11). TS types match backend contracts by transcription from the extracted contract (T1) — the api-client spec asserts envelope handling. ✅
- **Type consistency:** `ApiClient` method names used in T2-T10 match the T1 interface list; `UsageDto` defined in T1, endpoint added in T10. Route paths in T5/T6/T7/T8/T9 navigation match the T1 route table. ✅
- **Known constraint:** `AssessmentDto` has no per-page crawl data; the progress screen narrates status transitions only (the spec's "found 12 pages" example is not achievable with the current SSE payload — narration uses status-level lines instead; noted as a deliberate simplification, not a gap to invent backend work for).
- **Placeholders:** only the three `REPLACE_ME_*` consts, per the standing project directive on unknown external values; each is listed in the Task 12 production checklist.
