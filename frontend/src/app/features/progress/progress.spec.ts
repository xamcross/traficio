import { Component } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Progress } from './progress';
import { ApiClient } from '../../core/api/api-client';
import { AssessmentDto, AssessmentStatus } from '../../core/api/types';
import { EventSourceLike, eventSourceFactory, setEventSourceFactory } from '../../core/sse/assessment-stream';

/** No-op routed target so provideRouter() has something real to navigate to. */
@Component({ selector: 'progress-spec-blank', template: '' })
class BlankPage {}

function makeAssessment(overrides: Partial<AssessmentDto> = {}): AssessmentDto {
  return {
    id: 'A1',
    siteId: 's1',
    status: 'queued',
    scores: null,
    findings: [],
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

/** Fake EventSource exposing the onmessage/onerror hooks and a close() recorder. */
class FakeEventSource implements EventSourceLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closeCalls = 0;

  close(): void {
    this.closeCalls++;
  }
}

const originalEventSourceFactory = eventSourceFactory;

describe('Progress', () => {
  let api: FakeApiClient;
  let sources: FakeEventSource[];

  beforeEach(async () => {
    api = new FakeApiClient();
    sources = [];
    setEventSourceFactory(() => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    });

    await TestBed.configureTestingModule({
      imports: [Progress],
      providers: [
        { provide: ApiClient, useValue: api },
        provideRouter([{ path: 'assessments/:id/report', component: BlankPage }]),
        { provide: ActivatedRoute, useValue: activatedRouteWithId('A1') },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    setEventSourceFactory(originalEventSourceFactory);
  });

  function emit(source: FakeEventSource, status: AssessmentStatus): void {
    source.onmessage!({ data: JSON.stringify({ status }) } as MessageEvent);
  }

  it('updates the narration text when a status frame arrives', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'queued' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sources.length).toBe(1);
    emit(sources[0], 'crawling');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Reading your pages');
  });

  it('navigates to the report page after the stream closes and getAssessment resolves ready', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'queued' }));
    const fixture = TestBed.createComponent(Progress);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(sources.length).toBe(1);
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'ready' }));
    sources[0].onerror!(new Event('error'));
    tick();
    fixture.detectChanges();

    expect(location.path()).not.toBe('/assessments/A1/report');
    tick(1500);
    fixture.detectChanges();

    expect(location.path()).toBe('/assessments/A1/report');
  }));

  it('reopens a stream after the retry delay when the re-fetched status is not terminal', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'queued' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(sources.length).toBe(1);
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'analyzing' }));
    sources[0].onerror!(new Event('error'));
    tick();
    fixture.detectChanges();

    expect(sources.length).toBe(1);
    tick(2000);
    fixture.detectChanges();

    expect(sources.length).toBe(2);
  }));

  it('renders the JS-only explanation and no report link for a failed js_only_site assessment', async () => {
    api.getAssessmentResult = Promise.resolve(
      makeAssessment({
        status: 'failed',
        errorCode: 'js_only_site',
        errorMessage: 'This site only works with JavaScript turned on, so we could not read it.',
      }),
    );
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('This site only works with JavaScript turned on, so we could not read it.');
    expect(compiled.textContent).toContain('Your monthly check was not used.');
    expect(compiled.querySelector('a[href$="/report"]')).toBeNull();
    expect(sources.length).toBe(0);
  });
});
