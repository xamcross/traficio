import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Account } from './account';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { SiteDto, UsageDto, UserDto } from '../../core/api/types';
import { UserStore } from '../../core/auth/user-store';
import { FREEMIUS_PORTAL_URL } from '../../core/config';

/** No-op routed targets so provideRouter() has something real to navigate to. */
@Component({ selector: 'account-spec-blank', template: '' })
class BlankPage {}

function findButtonByText(compiled: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(compiled.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;
}

function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return { id: 'u1', email: 'ada@example.com', emailVerified: true, tier: 'free', ...overrides };
}

function makeUsage(overrides: Partial<UsageDto> = {}): UsageDto {
  return { assessmentsUsed: 1, assessmentsLimit: 10, sitesUsed: 2, sitesLimit: 5, nextCheckAt: null, ...overrides };
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  usageResult: Promise<UsageDto> = Promise.resolve(makeUsage());
  listSitesResult: Promise<SiteDto[]> = Promise.resolve([]);
  resendVerificationResult: Promise<unknown> = Promise.resolve(undefined);
  logoutResult: Promise<unknown> = Promise.resolve(undefined);

  resendVerificationCalls = 0;
  logoutCalls = 0;

  usage(): Promise<UsageDto> {
    return this.usageResult;
  }
  listSites(): Promise<SiteDto[]> {
    return this.listSitesResult;
  }
  resendVerification(): Promise<unknown> {
    this.resendVerificationCalls++;
    return this.resendVerificationResult;
  }
  logout(): Promise<unknown> {
    this.logoutCalls++;
    return this.logoutResult;
  }
  me(): Promise<UserDto> {
    return Promise.reject(new Error('not used by Account'));
  }
}

describe('Account', () => {
  let api: FakeApiClient;

  beforeEach(async () => {
    api = new FakeApiClient();
    await TestBed.configureTestingModule({
      imports: [Account],
      providers: [
        { provide: ApiClient, useValue: api },
        provideRouter([
          { path: '', component: BlankPage },
          { path: 'pricing', component: BlankPage },
        ]),
      ],
    }).compileComponents();
  });

  it('free at the limit: meters, next check date, site card, upgrade card', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ email: 'dana@rivertonbakery.com', tier: 'free' }));
    api.usageResult = Promise.resolve({ assessmentsUsed: 1, assessmentsLimit: 1, sitesUsed: 1, sitesLimit: 1, nextCheckAt: '2026-09-01T10:00:00Z' });
    api.listSitesResult = Promise.resolve([{ id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress', latestScores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, readOnly: false, latestAssessment: { id: 'A1', status: 'ready', createdAt: '2026-07-28T09:00:00Z', completedAt: '2026-07-28T10:00:00Z' }, latestReadyAssessmentId: 'A1' }]);
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Your account');
    expect(text).toContain('dana@rivertonbakery.com');
    expect(text).toContain('Checks used');
    expect(text).toContain('1 of 1');
    expect(text).toContain('Your next free check is available on 1 September.');
    expect(text).toContain('YOUR SITE');
    expect(text).toContain('wordpress · last checked 28 July 2026');
    expect(text).toContain('Pro lets you add four more sites.');
    expect(text).toContain('YOUR PLAN IS WAITING');
    expect(text).toContain('Unlock my plan');
    expect(text).toContain('Log out');
    expect(text).not.toContain('Delete my account');
  });

  it('pro: manage subscription card, no upgrade card', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.usageResult = Promise.resolve({ assessmentsUsed: 3, assessmentsLimit: 10, sitesUsed: 2, sitesLimit: 5, nextCheckAt: null });
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.textContent ?? '';
    expect(text).toContain('YOU ARE ON PRO');
    expect(text).toContain('Manage subscription');
    expect(text).not.toContain('Unlock my plan');
    expect(text).toContain('3 of 10');

    const link = Array.from(compiled.querySelectorAll('a')).find((a) => a.textContent?.includes('Manage subscription'));
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe(FREEMIUS_PORTAL_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener');
  });

  it('shows a "Confirm your email" note with a resend button when emailVerified is false', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ emailVerified: false }));
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Confirm your email');
    const resendButton = findButtonByText(compiled, 'Send it again');
    expect(resendButton).toBeTruthy();

    resendButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.resendVerificationCalls).toBe(1);
    expect(compiled.textContent).toContain('Sent. Check your inbox.');
  });

  it('shows an error note when resend is rejected', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ emailVerified: false }));
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    api.resendVerificationResult = Promise.reject(new ApiError('rate_limited', 'Too many requests. Try again later.', 429));
    findButtonByText(compiled, 'Send it again')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.textContent).not.toContain('Sent. Check your inbox.');
    expect(compiled.querySelector('.error-note')?.textContent).toContain('Too many requests. Try again later.');
  });

  it('does not disable a second resend click while the first is in flight, but only issues one call at a time', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ emailVerified: false }));
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    let resolveResend!: () => void;
    api.resendVerificationResult = new Promise((res) => (resolveResend = () => res(undefined)));
    const resendButton = findButtonByText(compiled, 'Send it again')!;
    resendButton.click();
    fixture.detectChanges();
    expect(resendButton.disabled).toBeTrue();

    resendButton.click(); // no-op while busy
    resolveResend();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.resendVerificationCalls).toBe(1);
  });

  it('logs out: calls api.logout, clears the store, and navigates to /', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    const location = TestBed.inject(Location);
    store.user.set(makeUser());
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Log out')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.logoutCalls).toBe(1);
    expect(store.user()).toBeNull();
    expect(location.path()).toBe('');
  });

  it('clears local state and navigates even when the logout call fails', async () => {
    api.logoutResult = Promise.reject(new Error('network down'));
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    const location = TestBed.inject(Location);
    store.user.set(makeUser());
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Log out')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.user()).toBeNull();
    expect(location.path()).toBe('');
  });

  it('always clears the session, even when the component is destroyed before logout resolves', async () => {
    let resolveLogout!: () => void;
    api.logoutResult = new Promise((res) => (resolveLogout = () => res(undefined)));
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser());
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Log out')!.click();
    fixture.destroy(); // route left before the server call returns

    expect(store.user()).not.toBeNull(); // api.logout() has not resolved yet

    resolveLogout();
    await fixture.whenStable();

    expect(store.user()).toBeNull(); // the global session is dropped regardless
  });

  it('shows an error note when the initial usage load fails', async () => {
    api.usageResult = Promise.reject(new ApiError('network_error', 'We could not reach the server. Check your connection and try again.', 0));
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser());
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.error-note')?.textContent).toContain('We could not reach the server.');
  });
});
