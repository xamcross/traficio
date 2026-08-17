import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { History } from './history';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto } from '../../core/api/types';

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

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  listAssessmentsResult: Promise<AssessmentDto[]> = Promise.resolve([]);
  submitAssessmentResult: Promise<AssessmentDto> = Promise.resolve(makeAssessment());

  listAssessmentsCalls: string[] = [];
  submitAssessmentCalls: string[] = [];

  listAssessments(siteId: string): Promise<AssessmentDto[]> {
    this.listAssessmentsCalls.push(siteId);
    return this.listAssessmentsResult;
  }
  submitAssessment(siteId: string): Promise<AssessmentDto> {
    this.submitAssessmentCalls.push(siteId);
    return this.submitAssessmentResult;
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

  it('renders an SVG trend chart with three polylines and a table row per assessment, newest first', async () => {
    const older = makeAssessment({
      id: 'A1',
      scores: { seo: 40, aeo: 45, geo: 50, overall: 45 },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = makeAssessment({
      id: 'A2',
      scores: { seo: 60, aeo: 65, geo: 70, overall: 65 },
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    // API returns newest first.
    api.listAssessmentsResult = Promise.resolve([newer, older]);

    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    const svg = compiled.querySelector('svg[viewBox="0 0 400 160"]');
    expect(svg).toBeTruthy();
    const polylines = svg!.querySelectorAll('polyline');
    expect(polylines.length).toBe(3);
    polylines.forEach((p) => expect(p.getAttribute('fill')).toBe('none'));

    // seo polyline: oldest (40) at x=0, newest (60) at x=400. y = 150 - score*1.4.
    const seoPoints = Array.from(polylines).map((p) => p.getAttribute('points')).find((pts) => pts?.includes('94') && pts?.includes('66'));
    expect(seoPoints).toBe('0,94 400,66');

    const rows = compiled.querySelectorAll('table tbody tr');
    expect(rows.length).toBe(2);
    // Newest first in the table.
    expect(rows[0].textContent).toContain('60');
    expect(rows[0].textContent).toContain('65');
    expect(rows[0].textContent).toContain('70');
    expect(rows[1].textContent).toContain('40');
    expect(rows[1].textContent).toContain('45');
    expect(rows[1].textContent).toContain('50');
  });

  it('renders the upsell panel with a /pricing link when listAssessments is rejected with upgrade_required, without crashing', async () => {
    api.listAssessmentsResult = Promise.reject(new ApiError('upgrade_required', 'Score history needs the Pro plan.', 403));

    const fixture = TestBed.createComponent(History);
    expect(() => fixture.detectChanges()).not.toThrow();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Score history needs the Pro plan.');
    const upgradeLink = Array.from(compiled.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/pricing');
    expect(upgradeLink).toBeTruthy();
    expect(compiled.querySelector('table')).toBeNull();
    expect(compiled.querySelector('svg')).toBeNull();
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

  it('renders a "Failed" row with no scores for a failed assessment and excludes it from the chart', async () => {
    const ready1 = makeAssessment({ id: 'A1', scores: { seo: 40, aeo: 45, geo: 50, overall: 45 }, createdAt: '2026-01-01T00:00:00.000Z' });
    const ready2 = makeAssessment({ id: 'A2', scores: { seo: 60, aeo: 65, geo: 70, overall: 65 }, createdAt: '2026-02-01T00:00:00.000Z' });
    const failed = makeAssessment({
      id: 'A3',
      status: 'failed',
      scores: null,
      errorCode: 'crawl_failed',
      errorMessage: 'We could not read this site.',
      createdAt: '2026-03-01T00:00:00.000Z',
      completedAt: null,
    });
    api.listAssessmentsResult = Promise.resolve([failed, ready2, ready1]);

    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const rows = compiled.querySelectorAll('table tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('Failed');
    expect(rows[0].textContent).not.toContain('40');

    // Only the two ready assessments should feed the chart: still exactly 3 polylines
    // (one per score series), each built from 2 points, not 3.
    const svg = compiled.querySelector('svg[viewBox="0 0 400 160"]');
    expect(svg).toBeTruthy();
    const polylines = svg!.querySelectorAll('polyline');
    expect(polylines.length).toBe(3);
    polylines.forEach((p) => {
      const points = p.getAttribute('points') ?? '';
      expect(points.trim().split(' ').length).toBe(2);
    });
  });
});
