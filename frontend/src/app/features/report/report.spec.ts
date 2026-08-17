import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Report } from './report';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto, SiteDto } from '../../core/api/types';

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

function activatedRouteWithId(id: string): ActivatedRoute {
  return { snapshot: { paramMap: convertToParamMap({ id }) } } as ActivatedRoute;
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  getAssessmentResult: Promise<AssessmentDto> = Promise.resolve(makeAssessment());
  getAssessmentCalls: string[] = [];
  listSitesResult: Promise<SiteDto[]> = Promise.resolve([]);
  getPlanForAssessmentResult: Promise<PlanDto> = Promise.resolve(makePlan());

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
});
