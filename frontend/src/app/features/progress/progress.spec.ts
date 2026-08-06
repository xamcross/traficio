import { Component } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Progress } from './progress';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, AssessmentStatus, UserDto } from '../../core/api/types';
import { EventSourceLike, eventSourceFactory, setEventSourceFactory } from '../../core/sse/assessment-stream';
import { UserStore } from '../../core/auth/user-store';

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
        provideRouter([
          { path: 'assessments/:id/report', component: BlankPage },
          { path: 'login', component: BlankPage },
        ]),
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

  it('caps consecutive refetch failures and shows a terminal error panel instead of retrying forever', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'queued' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(sources.length).toBe(1);

    api.getAssessmentResult = Promise.reject(new ApiError('network_error', 'offline', 0));

    // 4 consecutive failures - one short of the cap - each still reopens a stream.
    for (let i = 0; i < 4; i++) {
      sources[sources.length - 1].onerror!(new Event('error'));
      tick();
      fixture.detectChanges();
      tick(2000);
      fixture.detectChanges();
    }
    expect(sources.length).toBe(5);

    // The 5th consecutive failure exhausts the retry budget.
    sources[sources.length - 1].onerror!(new Event('error'));
    tick();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role=alert]')).toBeTruthy();
    expect(Array.from(compiled.querySelectorAll('a')).some((a) => a.textContent?.includes('Back to my sites'))).toBe(true);

    // No further retry is scheduled once exhausted - no new stream, ever.
    tick(10000);
    fixture.detectChanges();
    expect(sources.length).toBe(5);
  }));

  it('resets the failure counter after a successful refetch, so an isolated blip does not count toward exhaustion', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'queued' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(sources.length).toBe(1);

    api.getAssessmentResult = Promise.reject(new ApiError('network_error', 'offline', 0));
    for (let i = 0; i < 4; i++) {
      sources[sources.length - 1].onerror!(new Event('error'));
      tick();
      fixture.detectChanges();
      tick(2000);
      fixture.detectChanges();
    }
    expect(sources.length).toBe(5);

    // A successful refetch in between resets the counter to zero.
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'analyzing' }));
    sources[sources.length - 1].onerror!(new Event('error'));
    tick();
    fixture.detectChanges();
    tick(2000);
    fixture.detectChanges();
    expect(sources.length).toBe(6);

    // 4 more consecutive failures - still below the cap only because the counter reset.
    api.getAssessmentResult = Promise.reject(new ApiError('network_error', 'offline', 0));
    for (let i = 0; i < 4; i++) {
      sources[sources.length - 1].onerror!(new Event('error'));
      tick();
      fixture.detectChanges();
      tick(2000);
      fixture.detectChanges();
    }

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role=alert]')).toBeNull();
  }));

  it('stops retrying and sends the user to /login on an unauthenticated refetch failure, clearing the user store', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'queued' }));
    const fixture = TestBed.createComponent(Progress);
    const location = TestBed.inject(Location);
    const store = TestBed.inject(UserStore);
    const user: UserDto = { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' };
    store.loaded.set(true);
    store.user.set(user);

    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(sources.length).toBe(1);

    api.getAssessmentResult = Promise.reject(new ApiError('unauthenticated', 'not signed in', 401));
    sources[0].onerror!(new Event('error'));
    tick();
    fixture.detectChanges();

    expect(location.path()).toBe('/login');
    expect(store.user()).toBeNull();

    // No further retry stream is opened once the user is redirected away.
    tick(10000);
    fixture.detectChanges();
    expect(sources.length).toBe(1);
  }));

  it('does not navigate or reopen a stream if the component is destroyed while a refetch is in flight', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'queued' }));
    const fixture = TestBed.createComponent(Progress);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(sources.length).toBe(1);

    let resolveRefetch!: (assessment: AssessmentDto) => void;
    api.getAssessmentResult = new Promise<AssessmentDto>((resolve) => {
      resolveRefetch = resolve;
    });

    sources[0].onerror!(new Event('error')); // starts refetchAfterClose, awaiting getAssessment

    fixture.destroy();

    resolveRefetch(makeAssessment({ status: 'ready' }));
    tick(2000); // past the retry-delay window
    tick(1500); // past the done-beat window
    fixture.detectChanges();

    expect(location.path()).not.toBe('/assessments/A1/report');
    expect(sources.length).toBe(1);
  }));
});
