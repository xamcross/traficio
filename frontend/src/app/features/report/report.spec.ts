import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Report } from './report';
import { environment } from '../../../environments/environment';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto, SiteDto } from '../../core/api/types';
import { SiteContext } from '../../core/site-context';

/** No-op routed targets so provideRouter() has something real to navigate to. */
@Component({ selector: 'report-spec-blank', template: '' })
class BlankPage {}

function makeAssessment(overrides: Partial<AssessmentDto> = {}): AssessmentDto {
  return {
    id: 'A1',
    siteId: 's1',
    status: 'ready',
    scores: { seo: 72, aeo: 55, geo: 30, overall: 52 },
    summary: null,
    scoreNotes: null,
    findings: [
      {
        id: 'f1',
        category: 'seo',
        severity: 'high',
        evidence: 'Your homepage is missing a title tag.',
        affectedPages: ['/'],
      },
    ],
    pageCount: 10,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-07-01T00:00:00Z',
    completedAt: '2026-07-01T01:00:00Z',
    changes: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanDto> = {}): PlanDto {
  return {
    id: 'P1',
    assessmentId: 'A1',
    siteId: 's1',
    locked: true,
    tasks: [
      { taskId: 'T1', title: 'Fix the title tag', category: 'seo', impact: 'high', effortMinutes: 15, stepCount: 2, whyItMatters: null, steps: null, doneCheck: null, status: 'todo' },
    ],
    progress: { done: 0, verified: 0, total: 1 },
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

function activatedRouteWithId(id: string): ActivatedRoute {
  return { snapshot: { paramMap: convertToParamMap({ id }) } } as ActivatedRoute;
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
  getAssessmentResult: Promise<AssessmentDto> = Promise.resolve(makeAssessment());
  getAssessmentCalls: string[] = [];
  listSitesResult: Promise<SiteDto[]> = Promise.resolve([]);
  getPlanForAssessmentResult: Promise<PlanDto> = Promise.resolve(makePlan());
  shareAssessmentResult: Promise<{ slug: string }> = Promise.resolve({ slug: 'abc123' });
  shareAssessmentCalls: string[] = [];
  unshareAssessmentResult: Promise<void> = Promise.resolve();
  unshareAssessmentCalls: string[] = [];

  getAssessment(id: string): Promise<AssessmentDto> {
    this.getAssessmentCalls.push(id);
    return this.getAssessmentResult;
  }
  listSites(): Promise<SiteDto[]> {
    return this.listSitesResult;
  }
  getPlanForAssessment(_assessmentId: string): Promise<PlanDto> {
    return this.getPlanForAssessmentResult;
  }
  shareAssessment(id: string): Promise<{ slug: string }> {
    this.shareAssessmentCalls.push(id);
    return this.shareAssessmentResult;
  }
  unshareAssessment(id: string): Promise<void> {
    this.unshareAssessmentCalls.push(id);
    return this.unshareAssessmentResult;
  }
}

describe('Report', () => {
  let api: FakeApiClient;

  beforeEach(async () => {
    api = new FakeApiClient();
    await TestBed.configureTestingModule({
      imports: [Report],
      providers: [
        { provide: ApiClient, useValue: api },
        provideRouter([
          { path: 'assessments/:id/progress', component: BlankPage },
          { path: 'assessments/:id/plan', component: BlankPage },
        ]),
        { provide: ActivatedRoute, useValue: activatedRouteWithId('A1') },
      ],
    }).compileComponents();
  });

  it('renders the result view for a ready assessment', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment());
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading');
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Visibility out of 100');
    expect(compiled.textContent).toContain('What we found');
  });

  it('redirects to the progress route when the assessment is not ready', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'crawling', scores: null, findings: [] }));
    const fixture = TestBed.createComponent(Report);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(location.path()).toBe('/assessments/A1/progress');
  });

  it('shows the error note on failure', async () => {
    api.getAssessmentResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.error-note')?.textContent).toContain('We could not reach the server.');
    expect(compiled.querySelectorAll('app-result-view').length).toBe(0);
    const backLink = compiled.querySelector('a[href="/dashboard"]');
    expect(backLink).toBeTruthy();
  });

  it('does not let a listSites() that resolves after destroy overwrite SiteContext with a stale domain', async () => {
    const sites = deferred<SiteDto[]>();
    api.getAssessmentResult = Promise.resolve(makeAssessment());
    api.listSitesResult = sites.promise;
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.destroy();
    sites.resolve([makeSite({ id: 's1', domain: 'late.example.com' })]);
    await Promise.resolve();

    expect(TestBed.inject(SiteContext).domain()).toBeNull();
  });

  it('shows the share URL once the owner turns sharing on', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment());
    api.shareAssessmentResult = Promise.resolve({ slug: 'abc123' });
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const shareButton = compiled.querySelector('.share-control button') as HTMLButtonElement;
    expect(shareButton.textContent).toContain('Share this result');
    expect(compiled.querySelector('.share-url-input')).toBeNull();

    shareButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.shareAssessmentCalls).toEqual(['A1']);
    const input = compiled.querySelector('.share-url-input') as HTMLInputElement;
    expect(input.value).toBe(`${environment.siteOrigin}/r/abc123`);
    expect(shareButton.textContent).toContain('Stop sharing');
  });

  it('hides the share URL once the owner turns sharing off', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment());
    api.shareAssessmentResult = Promise.resolve({ slug: 'abc123' });
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const shareButton = compiled.querySelector('.share-control button') as HTMLButtonElement;
    shareButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('.share-url-input')).not.toBeNull();

    api.unshareAssessmentResult = Promise.resolve();
    shareButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.unshareAssessmentCalls).toEqual(['A1']);
    expect(compiled.querySelector('.share-url-input')).toBeNull();
    expect(shareButton.textContent).toContain('Share this result');
  });

  it('shows an error and does not claim success when the share call fails', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment());
    api.shareAssessmentResult = Promise.reject(new ApiError('server_error', 'Something went wrong. Please try again.', 500));
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const shareButton = compiled.querySelector('.share-control button') as HTMLButtonElement;
    shareButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.share-control .error-note')?.textContent).toContain('Something went wrong');
    expect(compiled.querySelector('.share-url-input')).toBeNull();
    expect(shareButton.textContent).toContain('Share this result');
  });

  it('shows an error and keeps the URL visible when the unshare call fails', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment());
    api.shareAssessmentResult = Promise.resolve({ slug: 'abc123' });
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const shareButton = compiled.querySelector('.share-control button') as HTMLButtonElement;
    shareButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    api.unshareAssessmentResult = Promise.reject(new ApiError('server_error', 'Something went wrong. Please try again.', 500));
    shareButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.share-control .error-note')?.textContent).toContain('Something went wrong');
    expect(compiled.querySelector('.share-url-input')).not.toBeNull();
    expect(shareButton.textContent).toContain('Stop sharing');
  });
});
