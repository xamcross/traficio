import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { History } from './history';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, SiteDto } from '../../core/api/types';
import { SiteContext } from '../../core/site-context';

/** No-op routed targets so provideRouter() has something real to navigate to. */
@Component({ selector: 'history-spec-blank', template: '' })
class BlankPage {}

function activatedRouteWithSiteId(siteId: string): ActivatedRoute {
  return { snapshot: { paramMap: convertToParamMap({ siteId }) } } as ActivatedRoute;
}

function makeAssessment(overrides: Partial<AssessmentDto> = {}): AssessmentDto {
  return {
    id: 'A1',
    siteId: 's1',
    status: 'ready',
    scores: { seo: 40, aeo: 45, geo: 50, overall: 45 },
    summary: null,
    scoreNotes: null,
    findings: [],
    pageCount: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    changes: [],
    ...overrides,
  };
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

/** A promise whose resolution is controlled from the test, to simulate an in-flight request. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  listAssessmentsResult: Promise<AssessmentDto[]> = Promise.resolve([]);
  submitAssessmentResult: Promise<AssessmentDto> = Promise.resolve(makeAssessment());
  listSitesResult: Promise<SiteDto[]> = Promise.resolve([]);
  resendVerificationResult: Promise<void> = Promise.resolve();

  listAssessmentsCalls: string[] = [];
  submitAssessmentCalls: string[] = [];
  resendVerificationCalls = 0;

  listAssessments(siteId: string): Promise<AssessmentDto[]> {
    this.listAssessmentsCalls.push(siteId);
    return this.listAssessmentsResult;
  }
  submitAssessment(siteId: string): Promise<AssessmentDto> {
    this.submitAssessmentCalls.push(siteId);
    return this.submitAssessmentResult;
  }
  listSites(): Promise<SiteDto[]> {
    return this.listSitesResult;
  }
  resendVerification(): Promise<void> {
    this.resendVerificationCalls++;
    return this.resendVerificationResult;
  }
}

describe('History', () => {
  let api: FakeApiClient;

  beforeEach(async () => {
    api = new FakeApiClient();
    await TestBed.configureTestingModule({
      imports: [History],
      providers: [
        { provide: ApiClient, useValue: api },
        provideRouter([
          { path: 'assessments/:id/progress', component: BlankPage },
          { path: 'pricing', component: BlankPage },
        ]),
        { provide: ActivatedRoute, useValue: activatedRouteWithSiteId('s1') },
      ],
    }).compileComponents();
  });

  it('renders the headline, the legend, and the table with what changed', async () => {
    api.listAssessmentsResult = Promise.resolve([
      makeAssessment({ id: 'A2', status: 'ready', scores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, createdAt: '2026-07-28T10:00:00Z', completedAt: '2026-07-28T10:03:00Z', changes: [{ title: 'a', kind: 'verified' }, { title: 'b', kind: 'verified' }] }),
      makeAssessment({ id: 'F1', status: 'failed', scores: null, createdAt: '2026-06-16T10:00:00Z', completedAt: '2026-06-16T10:01:00Z' }),
      makeAssessment({ id: 'A1', status: 'ready', scores: { seo: 55, aeo: 26, geo: 13, overall: 31 }, createdAt: '2026-03-02T10:00:00Z', completedAt: '2026-03-02T10:03:00Z' }),
    ]);
    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('It is working.');
    expect(text).toContain('You have gone from 31 to 41 since March.');
    expect(text).toContain('Google search');
    expect(text).toContain('WHAT CHANGED');
    expect(text).toContain('28 July 2026');
    expect(text).toContain('Two tasks confirmed fixed');
    expect(text).toContain('We could not read your site that day');
    expect(text).toContain('Your first check');
    expect(text).toContain('MAR – JUL 2026');

    const svgText = (fixture.nativeElement as HTMLElement).querySelector('svg')?.textContent ?? '';
    expect(svgText).toContain('62');
    expect(svgText).toContain('34');
    expect(svgText).toContain('28');
    expect(svgText).toContain('MAR');
    expect(svgText).toContain('JUL');
  });

  it('redirects to /pricing when listAssessments is rejected with upgrade_required', async () => {
    api.listAssessmentsResult = Promise.reject(new ApiError('upgrade_required', 'Score history needs the Pro plan.', 403));

    const fixture = TestBed.createComponent(History);
    const location = TestBed.inject(Location);
    expect(() => fixture.detectChanges()).not.toThrow();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(location.path()).toBe('/pricing?site=s1');
  });

  it('calls submitAssessment for the routed site and navigates to the progress route on "Check again"', async () => {
    api.listAssessmentsResult = Promise.resolve([]);
    api.submitAssessmentResult = Promise.resolve(makeAssessment({ id: 'A9' }));
    const fixture = TestBed.createComponent(History);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const button = Array.from(compiled.querySelectorAll('button')).find((b) => b.textContent?.includes('Check again'));
    expect(button).toBeTruthy();
    button!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.submitAssessmentCalls).toEqual(['s1']);
    expect(location.path()).toBe('/assessments/A9/progress');
  });

  it('resends the verification email and shows a confirmation', async () => {
    api.listAssessmentsResult = Promise.resolve([]);
    api.submitAssessmentResult = Promise.reject(new ApiError('email_not_verified', 'Confirm your email first.', 403));

    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const checkAgain = Array.from(compiled.querySelectorAll('button')).find((b) => b.textContent?.includes('Check again'));
    checkAgain!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const resendButton = Array.from(compiled.querySelectorAll('button')).find((b) => b.textContent?.includes('Send the email again'));
    expect(resendButton).toBeTruthy();
    resendButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.resendVerificationCalls).toBe(1);
    expect(compiled.textContent).toContain('Sent. Check your inbox.');
  });

  it('sets SiteContext to the site domain from listSites', async () => {
    api.listAssessmentsResult = Promise.resolve([]);
    api.listSitesResult = Promise.resolve([makeSite({ id: 's1', domain: 'example.com' })]);
    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(SiteContext).domain()).toBe('example.com');
  });

  it('does not let a listSites() that resolves after destroy overwrite SiteContext with a stale domain', async () => {
    const sites = deferred<SiteDto[]>();
    api.listAssessmentsResult = Promise.resolve([]);
    api.listSitesResult = sites.promise;
    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.destroy();
    sites.resolve([makeSite({ id: 's1', domain: 'late.example.com' })]);
    await Promise.resolve();

    expect(TestBed.inject(SiteContext).domain()).toBeNull();
  });

  it('does not let a listAssessments() that resolves after destroy write to the assessments signal', async () => {
    const list = deferred<AssessmentDto[]>();
    api.listAssessmentsResult = list.promise;
    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();

    fixture.destroy();
    list.resolve([makeAssessment({ id: 'LATE' })]);
    await Promise.resolve();

    const instance = fixture.componentInstance as unknown as { assessments: () => unknown[] };
    expect(instance.assessments()).toEqual([]);
  });
});
