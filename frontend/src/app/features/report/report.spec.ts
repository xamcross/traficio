import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Report } from './report';
import { ScoreDial } from '../../shared/score-dial';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto } from '../../core/api/types';

/** No-op routed targets so provideRouter() has something real to navigate to. */
@Component({ selector: 'report-spec-blank', template: '' })
class BlankPage {}

function makeAssessment(overrides: Partial<AssessmentDto> = {}): AssessmentDto {
  return {
    id: 'A1',
    siteId: 's1',
    status: 'ready',
    scores: { seo: 72, aeo: 55, geo: 30 },
    findings: [
      {
        id: 'f1',
        category: 'Meta tags',
        severity: 'high',
        evidence: 'Your homepage is missing a title tag.',
        affectedPages: ['/'],
      },
      {
        id: 'f2',
        category: 'Meta tags',
        severity: 'medium',
        evidence: 'Some pages have duplicate descriptions.',
        affectedPages: ['/about'],
      },
      {
        id: 'f3',
        category: 'Structured data',
        severity: 'low',
        evidence: 'Add FAQ schema to improve AI answers.',
        affectedPages: ['/faq'],
      },
    ],
    errorCode: null,
    errorMessage: null,
    createdAt: '',
    completedAt: null,
    ...overrides,
  };
}

function activatedRouteWithId(id: string): ActivatedRoute {
  return { snapshot: { paramMap: convertToParamMap({ id }) } } as ActivatedRoute;
}

/** Hand-rolled fake with a controllable, per-call-configurable promise. No jasmine.createSpy. */
class FakeApiClient {
  getAssessmentResult: Promise<AssessmentDto> = Promise.resolve(makeAssessment());
  getAssessmentCalls: string[] = [];

  getAssessment(id: string): Promise<AssessmentDto> {
    this.getAssessmentCalls.push(id);
    return this.getAssessmentResult;
  }
}

describe('ScoreDial', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ScoreDial] }).compileComponents();
  });

  it('renders the value text and an arc whose stroke-dashoffset is proportional to the value', () => {
    const circumference = 2 * Math.PI * 54;
    const fixture = TestBed.createComponent(ScoreDial);
    fixture.componentRef.setInput('label', 'SEO');
    fixture.componentRef.setInput('value', 0);
    fixture.detectChanges();
    let compiled = fixture.nativeElement as HTMLElement;
    let arc = compiled.querySelectorAll('circle')[1]!;
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference, 1);

    fixture.componentRef.setInput('value', 100);
    fixture.detectChanges();
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 1);

    fixture.componentRef.setInput('value', 50);
    fixture.detectChanges();
    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('50');
    arc = compiled.querySelectorAll('circle')[1]!;
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference / 2, 1);
  });
});

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

  it('renders three dials, findings grouped by category with severity badges, and a plan link for a ready assessment', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment());
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading');
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Your site report');

    const dials = compiled.querySelectorAll('app-score-dial');
    expect(dials.length).toBe(3);

    expect(compiled.textContent).toContain('Meta tags');
    expect(compiled.textContent).toContain('Structured data');
    expect(compiled.textContent).toContain('Your homepage is missing a title tag.');
    expect(compiled.textContent).toContain('Some pages have duplicate descriptions.');
    expect(compiled.textContent).toContain('Add FAQ schema to improve AI answers.');
    expect(compiled.textContent).toContain('high');
    expect(compiled.textContent).toContain('medium');
    expect(compiled.textContent).toContain('low');

    const planLink = compiled.querySelector('a[href$="/plan"]') as HTMLAnchorElement | null;
    expect(planLink).toBeTruthy();
    expect(planLink!.textContent).toContain('See my plan');
    expect(planLink!.getAttribute('href')).toBe('/assessments/A1/plan');
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

  it('renders the error note and no dials when the initial fetch is rejected', async () => {
    api.getAssessmentResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.error-note')?.textContent).toContain('We could not reach the server.');
    expect(compiled.querySelectorAll('app-score-dial').length).toBe(0);
    const backLink = compiled.querySelector('a[href="/dashboard"]');
    expect(backLink).toBeTruthy();
  });

  it('renders a fallback message instead of throwing when a ready assessment has null scores and no findings', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ scores: null, findings: [] }));
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('app-score-dial').length).toBe(0);
    expect(compiled.textContent).toContain('We could not read the scores for this check. Run a new check.');
    expect(compiled.textContent).toContain('We found no problems to report. Great job.');
  });
});
