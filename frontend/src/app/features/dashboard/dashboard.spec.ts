import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Dashboard } from './dashboard';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto, SiteDto, UsageDto, UserDto } from '../../core/api/types';
import { PENDING_URL_KEY } from '../../core/config';

/** No-op routed targets so provideRouter() has something real to navigate to. */
@Component({ selector: 'dashboard-spec-blank', template: '' })
class BlankPage {}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function submitForm(compiled: HTMLElement): void {
  compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
}

function findButtonByText(compiled: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(compiled.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;
}

function addSiteInput(compiled: HTMLElement): HTMLInputElement | null {
  return compiled.querySelector<HTMLInputElement>('input[type=text]');
}

/** A promise whose resolution is controlled from the test, to simulate an in-flight request. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeSite(overrides: Partial<SiteDto> = {}): SiteDto {
  return {
    id: 's1',
    domain: 'example.com',
    url: 'https://example.com',
    platform: null,
    latestScores: null,
    readOnly: false,
    latestAssessment: null,
    latestReadyAssessmentId: null,
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<AssessmentDto> = {}): AssessmentDto {
  return {
    id: 'A1',
    siteId: 's1',
    status: 'queued',
    scores: null,
    summary: null,
    scoreNotes: null,
    findings: [],
    pageCount: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '',
    completedAt: null,
    changes: [],
    publicSlug: null,
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanDto> = {}): PlanDto {
  return {
    id: 'p1',
    assessmentId: 'A1',
    siteId: 's1',
    locked: false,
    tasks: [],
    progress: { done: 0, verified: 0, total: 0 },
    ...overrides,
  };
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  listSitesResult: Promise<SiteDto[]> = Promise.resolve([]);
  createSiteResult: Promise<SiteDto> = Promise.resolve(makeSite());
  submitAssessmentResult: Promise<AssessmentDto> = Promise.resolve(makeAssessment());
  getPlanForSiteResult: Promise<PlanDto> = Promise.resolve(makePlan());
  resendVerificationResult: Promise<unknown> = Promise.resolve(undefined);
  usageResult: Promise<UsageDto> = Promise.resolve({ assessmentsUsed: 0, assessmentsLimit: 1, sitesUsed: 0, sitesLimit: 1, nextCheckAt: null });

  createSiteCalls: string[] = [];
  submitAssessmentCalls: string[] = [];
  getPlanForSiteCalls: string[] = [];
  resendVerificationCalls = 0;

  listSites(): Promise<SiteDto[]> {
    return this.listSitesResult;
  }
  createSite(url: string): Promise<SiteDto> {
    this.createSiteCalls.push(url);
    return this.createSiteResult;
  }
  submitAssessment(siteId: string): Promise<AssessmentDto> {
    this.submitAssessmentCalls.push(siteId);
    return this.submitAssessmentResult;
  }
  getPlanForSite(siteId: string): Promise<PlanDto> {
    this.getPlanForSiteCalls.push(siteId);
    return this.getPlanForSiteResult;
  }
  resendVerification(): Promise<unknown> {
    this.resendVerificationCalls++;
    return this.resendVerificationResult;
  }
  usage(): Promise<UsageDto> {
    return this.usageResult;
  }
  me(): Promise<UserDto> {
    return Promise.reject(new Error('not used by Dashboard'));
  }
}

describe('Dashboard', () => {
  let api: FakeApiClient;

  beforeEach(async () => {
    api = new FakeApiClient();
    sessionStorage.removeItem(PENDING_URL_KEY);
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        { provide: ApiClient, useValue: api },
        provideRouter([
          { path: 'assessments/:id/progress', component: BlankPage },
          { path: 'assessments/:id/plan', component: BlankPage },
          { path: 'sites/:siteId', component: BlankPage },
          { path: 'sites/:siteId/history', component: BlankPage },
          { path: 'pricing', component: BlankPage },
        ]),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    sessionStorage.removeItem(PENDING_URL_KEY);
  });

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

  it('with a pending url: shows the add-site error when site creation fails, without starting a check', async () => {
    sessionStorage.setItem(PENDING_URL_KEY, 'not a url');
    api.createSiteResult = Promise.reject(new ApiError('invalid_url', 'Bad url.', 400));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(addSiteInput(el)!.value).toBe('not a url');
    expect(el.textContent).toContain('That address does not look right. Enter it like example.com.');
    expect(api.submitAssessmentCalls).toEqual([]);
    expect(TestBed.inject(Location).path()).toBe('');
  });

  it('with a pending url and one site already listed: a check error blocks the one-site redirect', async () => {
    sessionStorage.setItem(PENDING_URL_KEY, 'rivertonbakery.com');
    api.createSiteResult = Promise.resolve(makeSite({ id: 'S1' }));
    api.submitAssessmentResult = Promise.reject(new ApiError('email_not_verified', 'Confirm first.', 403));
    api.listSitesResult = Promise.resolve([makeSite({ id: 'S1' })]);
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(TestBed.inject(Location).path()).not.toBe('/sites/S1');
    expect(el.textContent).toContain('Confirm your email first.');
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

  it('clicking "Upgrade to work with this site" opens the pricing page for that site, not the site home', async () => {
    api.listSitesResult = Promise.resolve([
      makeSite({ id: 'S1', domain: 'one.com' }),
      makeSite({ id: 'S2', domain: 'two.com', readOnly: true }),
    ]);
    api.usageResult = Promise.resolve({ assessmentsUsed: 0, assessmentsLimit: 1, sitesUsed: 2, sitesLimit: 2, nextCheckAt: null });
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const upgradeLink = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Upgrade to work with this site')) as HTMLAnchorElement;
    upgradeLink.click();
    await fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('/pricing?site=S2');
  });

  it('adding a site from the form navigates to the new site home', async () => {
    api.listSitesResult = Promise.resolve([]);
    api.createSiteResult = Promise.resolve(makeSite({ id: 'S7' }));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    setValue(addSiteInput(el)!, 'new.example.com');
    fixture.detectChanges();
    submitForm(el);
    await fixture.whenStable();
    expect(api.createSiteCalls).toEqual(['new.example.com']);
    expect(TestBed.inject(Location).path()).toBe('/sites/S7');
  });
});
