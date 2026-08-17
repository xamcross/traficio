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
      // provideRouter registers its own ActivatedRoute.
      // The override must come after it. The last provider wins.
      // See features/report/report.spec.ts for the same ordering.
      provideRouter([{ path: 'assessments/:id/progress', component: BlankPage }, { path: 'assessments/:id/plan', component: BlankPage }, { path: 'assessments/:id/report', component: BlankPage }, { path: 'pricing', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ siteId: 'S1' }) } } },
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
    // The note reads the date from the fetched failed assessment.
    // Set it here so the assertion below matches.
    const failed = assessment({ id: 'A2', status: 'failed', errorCode: 'site_unreachable', errorMessage: 'We could not reach it.', createdAt: '2026-08-01T00:00:00Z', completedAt: '2026-08-01T00:01:00Z' });
    const ready = assessment();
    api.getAssessment = (id: string) => Promise.resolve(id === 'A2' ? failed : ready);
    const { el } = await setup(api, 'free');
    expect(el.textContent).toContain('Your last check on 1 August 2026 did not finish. We could not reach it.');
    expect(el.textContent).toContain('Visibility out of 100');
  });
});
