import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Account } from './account';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UsageDto, UserDto } from '../../core/api/types';
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
  resendVerificationResult: Promise<unknown> = Promise.resolve(undefined);
  logoutResult: Promise<unknown> = Promise.resolve(undefined);

  resendVerificationCalls = 0;
  logoutCalls = 0;

  usage(): Promise<UsageDto> {
    return this.usageResult;
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

  it('renders email, tier chip, and the two usage meters', async () => {
    api.usageResult = Promise.resolve(makeUsage({ assessmentsUsed: 1, assessmentsLimit: 10, sitesUsed: 2, sitesLimit: 5 }));
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ email: 'ada@example.com', tier: 'free' }));
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('ada@example.com');
    expect(compiled.textContent).toContain('Free plan');
    expect(compiled.textContent).toContain('Checks this month: 1 of 10');
    expect(compiled.textContent).toContain('Sites: 2 of 5');
  });

  it('shows Pro plan for a pro user', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Pro plan');
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
    const resendButton = findButtonByText(compiled, 'Send the email again');
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
    findButtonByText(compiled, 'Send the email again')!.click();
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
    const resendButton = findButtonByText(compiled, 'Send the email again')!;
    resendButton.click();
    fixture.detectChanges();
    expect(resendButton.disabled).toBeTrue();

    resendButton.click(); // no-op while busy
    resolveResend();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.resendVerificationCalls).toBe(1);
  });

  it('renders "Manage subscription" as an external link to the Freemius portal for pro users', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'pro' }));
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const link = Array.from(compiled.querySelectorAll('a')).find((a) => a.textContent?.includes('Manage subscription'));
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe(FREEMIUS_PORTAL_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener');
  });

  it('renders an "Upgrade" link to /pricing for free users', async () => {
    const fixture = TestBed.createComponent(Account);
    const store = TestBed.inject(UserStore);
    store.user.set(makeUser({ tier: 'free' }));
    store.loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const link = Array.from(compiled.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/pricing');
    expect(link).toBeTruthy();
    expect(link!.textContent).toContain('Upgrade');
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
