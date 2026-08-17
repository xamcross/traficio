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
    siteId: 'S1',
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
  submitAssessmentResult: Promise<AssessmentDto> = Promise.resolve(makeAssessment({ id: 'A2', status: 'queued' }));
  submitAssessmentCalls: string[] = [];

  getAssessment(id: string): Promise<AssessmentDto> {
    this.getAssessmentCalls.push(id);
    return this.getAssessmentResult;
  }

  submitAssessment(siteId: string): Promise<AssessmentDto> {
    this.submitAssessmentCalls.push(siteId);
    return this.submitAssessmentResult;
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
          { path: 'assessments/:id/progress', component: BlankPage },
          { path: 'sites/:siteId', component: BlankPage },
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

    expect(location.path()).not.toBe('/sites/S1');
    expect(sources.length).toBe(1);
  }));

  it('names the rail steps in plain words and marks done steps with the done label', async () => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'analyzing' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Checking how findable you are…');   // headline = active label + …
    expect(text).toContain('Found your site');                  // done form
    expect(text).toContain('Read your pages');                  // done form
    expect(text).toContain('Writing your plan');                // later step keeps the active form
    expect(text).toContain('You can close this tab. We will email you when your result is ready.');
    expect(text).toContain('QUEUED → CRAWLING → ANALYZING → PLANNING');
  });

  it('shows the failure state with the headline for the code, the message verbatim and the free quota note', async () => {
    TestBed.inject(UserStore).user.set({ id: 'u1', email: 'a@example.com', emailVerified: true, tier: 'free' } as UserDto);
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'failed', errorCode: 'robots_blocked', errorMessage: 'Your robots.txt file tells crawlers to stay away.' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('WE COULD NOT FINISH');
    expect(text).toContain('Your site would not let us read it.');
    expect(text).toContain('Your robots.txt file tells crawlers to stay away.');
    expect(text).toContain('Your free check this month was not used.');
    expect(text).toContain('Try again');
    expect(text).toContain('Back to my site');
  });

  it('navigates to the site home after the done beat when ready', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'ready', siteId: 'S1' }));
    const fixture = TestBed.createComponent(Progress);
    fixture.detectChanges();
    tick();
    tick(1500);
    expect(TestBed.inject(Location).path()).toBe('/sites/S1');
  }));

  it('navigates to the new progress page once a try-again submit resolves', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'failed', siteId: 'S1' }));
    const fixture = TestBed.createComponent(Progress);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    let resolveSubmit!: (assessment: AssessmentDto) => void;
    api.submitAssessmentResult = new Promise<AssessmentDto>((resolve) => {
      resolveSubmit = resolve;
    });

    const compiled = fixture.nativeElement as HTMLElement;
    const tryAgainButton = Array.from(compiled.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Try again')) as HTMLButtonElement;
    tryAgainButton.click();

    resolveSubmit(makeAssessment({ id: 'A9', siteId: 'S1', status: 'queued' }));
    tick();

    expect(location.path()).toBe('/assessments/A9/progress');
    expect(api.submitAssessmentCalls).toEqual(['S1']);
  }));

  it('does not navigate if the component is destroyed while a try-again submit is in flight', fakeAsync(() => {
    api.getAssessmentResult = Promise.resolve(makeAssessment({ status: 'failed', siteId: 'S1' }));
    const fixture = TestBed.createComponent(Progress);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    let resolveSubmit!: (assessment: AssessmentDto) => void;
    api.submitAssessmentResult = new Promise<AssessmentDto>((resolve) => {
      resolveSubmit = resolve;
    });

    const compiled = fixture.nativeElement as HTMLElement;
    const tryAgainButton = Array.from(compiled.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Try again')) as HTMLButtonElement;
    tryAgainButton.click();

    fixture.destroy();

    resolveSubmit(makeAssessment({ id: 'A9', siteId: 'S1', status: 'queued' }));
    tick();

    expect(location.path()).not.toBe('/assessments/A9/progress');
  }));
});
