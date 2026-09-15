import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Account } from './account';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { PortalLinkDto, SiteDto, SubscriptionDto, UsageDto, UserDto } from '../../core/api/types';
import { UserStore } from '../../core/auth/user-store';

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

function makeSubscription(overrides: Partial<SubscriptionDto> = {}): SubscriptionDto {
  return { tier: 'pro', status: 'active', planId: 'plan-pro', currentPeriodEnd: '2027-01-01T00:00:00Z', ...overrides };
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  usageResult: Promise<UsageDto> = Promise.resolve(makeUsage());
  listSitesResult: Promise<SiteDto[]> = Promise.resolve([]);
  resendVerificationResult: Promise<unknown> = Promise.resolve(undefined);
  logoutResult: Promise<unknown> = Promise.resolve(undefined);
  // Matches the default makeUser(), so a test that pre-sets store.user to plain
  // makeUser() sees no change once load() refreshes the store from this.
  meResult: Promise<UserDto> = Promise.resolve(makeUser());
  subscriptionResult: Promise<SubscriptionDto> = Promise.resolve(makeSubscription());
  cancelSubscriptionResult: Promise<SubscriptionDto> = Promise.resolve(makeSubscription({ status: 'cancelled' }));
  portalLinkResult: Promise<PortalLinkDto> = Promise.resolve({ url: 'https://users.freemius.com/login/magic-token' });

  resendVerificationCalls = 0;
  logoutCalls = 0;
  meCalls = 0;
  cancelSubscriptionCalls = 0;
  portalLinkCalls = 0;

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
    this.meCalls++;
    return this.meResult;
  }
  getSubscription(): Promise<SubscriptionDto> {
    return this.subscriptionResult;
  }
  cancelSubscription(): Promise<SubscriptionDto> {
    this.cancelSubscriptionCalls++;
    return this.cancelSubscriptionResult;
  }
  getPortalLink(): Promise<PortalLinkDto> {
    this.portalLinkCalls++;
    return this.portalLinkResult;
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
    api.meResult = Promise.resolve(makeUser({ email: 'dana@rivertonbakery.com', tier: 'free' }));
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

  it('pro: subscription section with renewal date, no upgrade card', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.meResult = Promise.resolve(makeUser({ tier: 'pro' }));
    api.usageResult = Promise.resolve({ assessmentsUsed: 3, assessmentsLimit: 10, sitesUsed: 2, sitesLimit: 5, nextCheckAt: null });
    api.subscriptionResult = Promise.resolve(makeSubscription({ status: 'active', currentPeriodEnd: '2027-01-01T00:00:00Z' }));
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.textContent ?? '';
    expect(text).toContain('YOU ARE ON PRO');
    expect(text).toContain('Renews 1 January 2027.');
    expect(text).toContain('Update payment method');
    expect(text).toContain('Cancel subscription');
    expect(text).not.toContain('Unlock my plan');
    expect(text).toContain('3 of 10');
  });

  it('pro, cancelled: shows the end date and hides the cancel button', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.meResult = Promise.resolve(makeUser({ tier: 'pro' }));
    api.subscriptionResult = Promise.resolve(makeSubscription({ status: 'cancelled', currentPeriodEnd: '2027-01-01T00:00:00Z' }));
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.textContent ?? '';
    expect(text).toContain('Your Pro plan ends 1 January 2027.');
    expect(text).not.toContain('Cancel subscription');
    expect(text).toContain('Update payment method');
  });

  it('cancels the subscription after a confirm step, then shows the end date and hides the button', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.meResult = Promise.resolve(makeUser({ tier: 'pro' }));
    api.subscriptionResult = Promise.resolve(makeSubscription({ status: 'active', currentPeriodEnd: '2027-01-01T00:00:00Z' }));
    api.cancelSubscriptionResult = Promise.resolve(makeSubscription({ status: 'cancelled', currentPeriodEnd: '2027-01-01T00:00:00Z' }));
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Cancel subscription')!.click();
    fixture.detectChanges();
    expect(compiled.textContent).toContain('Keep my plan');
    expect(api.cancelSubscriptionCalls).toBe(0); // the confirm step has not been answered yet

    findButtonByText(compiled, 'Yes, cancel')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.cancelSubscriptionCalls).toBe(1);
    expect(compiled.textContent).toContain('Your Pro plan ends 1 January 2027.');
    expect(findButtonByText(compiled, 'Cancel subscription')).toBeNull();
  });

  it('backing out of the confirm step with "Keep my plan" does not call cancel', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.meResult = Promise.resolve(makeUser({ tier: 'pro' }));
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Cancel subscription')!.click();
    fixture.detectChanges();
    findButtonByText(compiled, 'Keep my plan')!.click();
    fixture.detectChanges();

    expect(api.cancelSubscriptionCalls).toBe(0);
    expect(compiled.textContent).toContain('Cancel subscription');
  });

  it('shows an error note when cancelling fails, and keeps the confirm step open', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.meResult = Promise.resolve(makeUser({ tier: 'pro' }));
    api.cancelSubscriptionResult = Promise.reject(new ApiError('cancel_failed', 'We could not reach Freemius to cancel the subscription. Please try again.', 502));
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Cancel subscription')!.click();
    fixture.detectChanges();
    findButtonByText(compiled, 'Yes, cancel')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.textContent).toContain('We could not reach Freemius to cancel the subscription.');
    expect(compiled.textContent).toContain('Keep my plan'); // still on the confirm step
  });

  it('opens a blank tab synchronously on click, then navigates it once the portal link resolves', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.meResult = Promise.resolve(makeUser({ tier: 'pro' }));
    api.portalLinkResult = Promise.resolve({ url: 'https://users.freemius.com/login/magic-token' });
    const fakeTab = { location: { href: '' }, close: jasmine.createSpy('close') } as unknown as Window;
    const openSpy = spyOn(window, 'open').and.returnValue(fakeTab);
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Update payment method')!.click();
    // The tab opens synchronously, in the same tick as the click, before the network call
    // that supplies the URL resolves — this is what keeps a popup blocker from dropping it.
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(fakeTab.location.href).toBe('');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.portalLinkCalls).toBe(1);
    expect(fakeTab.location.href).toBe('https://users.freemius.com/login/magic-token');
  });

  it('shows an error and never calls the API when the browser blocks the pop-up', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    api.meResult = Promise.resolve(makeUser({ tier: 'pro' }));
    spyOn(window, 'open').and.returnValue(null);
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Update payment method')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.portalLinkCalls).toBe(0);
    expect(compiled.textContent).toContain('Your browser blocked the pop-up.');
  });

  it('refreshes the tier from /v1/me on load, so a stale Pro display does not linger after a downgrade', async () => {
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' })); // stale: the store still says Pro from before the page loaded
    api.meResult = Promise.resolve(makeUser({ tier: 'free' })); // the server now says Free
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(api.meCalls).toBe(1);
    expect(text).toContain('Unlock my plan');
    expect(text).not.toContain('Cancel subscription');
  });

  it('shows a "Confirm your email" note with a resend button when emailVerified is false', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ emailVerified: false }));
    api.meResult = Promise.resolve(makeUser({ emailVerified: false }));
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
    api.meResult = Promise.resolve(makeUser({ emailVerified: false }));
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
    api.meResult = Promise.resolve(makeUser({ emailVerified: false }));
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

  it('shows an error note when the initial usage load fails, but the rest of the page still shows', async () => {
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
    expect(findButtonByText(compiled, 'Log out')).toBeTruthy();
  });

  it('shows an error note when listSites fails, but the usage meters still show', async () => {
    api.listSitesResult = Promise.reject(new ApiError('network_error', 'We could not reach the server. Check your connection and try again.', 0));
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser());
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.error-note')?.textContent).toContain('We could not reach the server.');
    expect(compiled.textContent).toContain('Checks used');
  });
});
