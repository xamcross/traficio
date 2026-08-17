import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Dashboard } from './dashboard';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto, SiteDto, UserDto } from '../../core/api/types';
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

function addSiteInput(compiled: HTMLElement): HTMLInputElement {
  return compiled.querySelector<HTMLInputElement>('input[type=text]')!;
}

/** A promise whose resolution is controlled from the test, to simulate an in-flight request. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function findButtonInByText(container: Element, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;
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
          { path: 'sites/:siteId/history', component: BlankPage },
          { path: 'pricing', component: BlankPage },
        ]),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    sessionStorage.removeItem(PENDING_URL_KEY);
  });

  it('renders one card per site, with domain, three scores, or "No check yet"', async () => {
    api.listSitesResult = Promise.resolve([
      makeSite({ id: 's1', domain: 'a.com', latestScores: { seo: 72, aeo: 55, geo: 40, overall: 56 } }),
      makeSite({ id: 's2', domain: 'b.com', latestScores: null }),
    ]);
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const cards = compiled.querySelectorAll('.site-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('a.com');
    expect(cards[0].textContent).toContain('72');
    expect(cards[0].textContent).toContain('55');
    expect(cards[0].textContent).toContain('40');
    expect(cards[1].textContent).toContain('b.com');
    expect(cards[1].textContent).toContain('No check yet');
  });

  it('shows a "Read only" badge and disables "Check my site" for a read-only site', async () => {
    api.listSitesResult = Promise.resolve([makeSite({ readOnly: true })]);
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Read only');
    expect(findButtonByText(compiled, 'Check my site')?.disabled).toBeTrue();
  });

  it('calls createSite and prepends the new site card on submit of the add-site form', async () => {
    api.listSitesResult = Promise.resolve([makeSite({ id: 's1', domain: 'existing.com' })]);
    api.createSiteResult = Promise.resolve(makeSite({ id: 's2', domain: 'new.com' }));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    setValue(addSiteInput(compiled), 'new.com');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.createSiteCalls).toEqual(['new.com']);
    const cards = compiled.querySelectorAll('.site-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('new.com');
  });

  it('renders the add-site error note with the server message and an upgrade link for site_limit_reached', async () => {
    api.createSiteResult = Promise.reject(new ApiError('site_limit_reached', 'You have reached your site limit.', 403));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    setValue(addSiteInput(compiled), 'new.com');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.error-note')?.textContent).toContain('You have reached your site limit.');
    const upgradeLink = Array.from(compiled.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/pricing');
    expect(upgradeLink).toBeTruthy();
  });

  it('calls submitAssessment and navigates to the progress page on "Check my site"', async () => {
    api.listSitesResult = Promise.resolve([makeSite({ id: 's1', domain: 'a.com' })]);
    api.submitAssessmentResult = Promise.resolve(makeAssessment({ id: 'A1' }));
    const fixture = TestBed.createComponent(Dashboard);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Check my site')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.submitAssessmentCalls).toEqual(['s1']);
    expect(location.path()).toBe('/assessments/A1/progress');
  });

  it('shows the email verification prompt for email_not_verified, with a resend button', async () => {
    api.listSitesResult = Promise.resolve([makeSite({ id: 's1', domain: 'a.com' })]);
    api.submitAssessmentResult = Promise.reject(new ApiError('email_not_verified', 'Please verify your email.', 403));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Check my site')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Confirm your email first.');
    const resendButton = findButtonByText(compiled, 'Send the email again');
    expect(resendButton).toBeTruthy();

    resendButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.resendVerificationCalls).toBe(1);
  });

  it('disables other cards\' action buttons while one site\'s check is in flight', async () => {
    api.listSitesResult = Promise.resolve([
      makeSite({ id: 's1', domain: 'a.com' }),
      makeSite({ id: 's2', domain: 'b.com', latestScores: { seo: 1, aeo: 2, geo: 3, overall: 2 } }),
    ]);
    const inFlight = deferred<AssessmentDto>();
    api.submitAssessmentResult = inFlight.promise;
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const cards = compiled.querySelectorAll('.site-card');

    findButtonInByText(cards[0], 'Check my site')!.click();
    fixture.detectChanges();

    expect(findButtonInByText(cards[1], 'Check my site')?.disabled).toBeTrue();
    expect(findButtonInByText(cards[1], 'See my plan')?.disabled).toBeTrue();

    inFlight.resolve(makeAssessment({ id: 'A1', siteId: 's1' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(findButtonInByText(cards[1], 'Check my site')?.disabled).toBeFalse();
  });

  it('shows an error note with the server message when resendVerification is rejected', async () => {
    api.listSitesResult = Promise.resolve([makeSite({ id: 's1', domain: 'a.com' })]);
    api.submitAssessmentResult = Promise.reject(new ApiError('email_not_verified', 'Please verify your email.', 403));
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Check my site')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    api.resendVerificationResult = Promise.reject(new ApiError('rate_limited', 'Too many requests. Try again later.', 429));
    findButtonByText(compiled, 'Send the email again')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.textContent).not.toContain('Sent. Check your inbox.');
    expect(compiled.querySelector('.error-note')?.textContent).toContain('Too many requests. Try again later.');
  });

  it('pre-fills the add-site input from sessionStorage pendingUrl on init and clears the key', async () => {
    sessionStorage.setItem(PENDING_URL_KEY, 'pending.com');
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(addSiteInput(compiled).value).toBe('pending.com');
    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBeNull();
  });
});
