import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ResetRequest } from './reset-request';
import { ResetConfirm } from './reset-confirm';
import { ApiClient, ApiError } from '../../core/api/api-client';

/** A no-op routed target so provideRouter() has something real to navigate to. */
@Component({ selector: 'reset-spec-blank', template: '' })
class BlankPage {}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function submitForm(compiled: HTMLElement): void {
  compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
}

function findLinkByText(compiled: HTMLElement, text: string): HTMLAnchorElement | null {
  return Array.from(compiled.querySelectorAll('a')).find((a) => a.textContent?.includes(text)) ?? null;
}

function activatedRouteWithToken(token: string | null): ActivatedRoute {
  return {
    snapshot: { queryParamMap: convertToParamMap(token === null ? {} : { token }) },
  } as ActivatedRoute;
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  requestPasswordResetResult: Promise<unknown> = Promise.resolve(undefined);
  confirmPasswordResetResult: Promise<unknown> = Promise.resolve(undefined);

  requestPasswordResetCalls: string[] = [];
  confirmPasswordResetCalls: Array<{ token: string; newPassword: string }> = [];

  requestPasswordReset(email: string): Promise<unknown> {
    this.requestPasswordResetCalls.push(email);
    return this.requestPasswordResetResult;
  }
  confirmPasswordReset(token: string, newPassword: string): Promise<unknown> {
    this.confirmPasswordResetCalls.push({ token, newPassword });
    return this.confirmPasswordResetResult;
  }
}

describe('ResetRequest', () => {
  let api: FakeApiClient;

  beforeEach(async () => {
    api = new FakeApiClient();
    await TestBed.configureTestingModule({
      imports: [ResetRequest],
      providers: [{ provide: ApiClient, useValue: api }, provideRouter([{ path: 'login', component: BlankPage }])],
    }).compileComponents();
  });

  it('calls requestPasswordReset and always shows the check-your-email panel on resolve', async () => {
    api.requestPasswordResetResult = Promise.resolve(undefined);
    const fixture = TestBed.createComponent(ResetRequest);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    setValue(compiled.querySelector<HTMLInputElement>('input[type=email]')!, 'a@b.com');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.requestPasswordResetCalls).toEqual(['a@b.com']);
    expect(compiled.textContent).toContain('Check your email');
  });
});

describe('ResetConfirm', () => {
  let api: FakeApiClient;

  beforeEach(() => {
    api = new FakeApiClient();
  });

  it('reads the token query param, calls confirmPasswordReset, and shows success text with a login link', async () => {
    api.confirmPasswordResetResult = Promise.resolve(undefined);
    await TestBed.configureTestingModule({
      imports: [ResetConfirm],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: ActivatedRoute, useValue: activatedRouteWithToken('t') },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ResetConfirm);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    setValue(compiled.querySelector<HTMLInputElement>('input[type=password]')!, 'newSecret123');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.confirmPasswordResetCalls).toEqual([{ token: 't', newPassword: 'newSecret123' }]);
    expect(compiled.textContent).toContain('Your password is changed. Log in with the new password.');
    expect(findLinkByText(compiled, 'Log in')).toBeTruthy();
  });

  it('renders the server message for a weak_password rejection', async () => {
    api.confirmPasswordResetResult = Promise.reject(new ApiError('weak_password', 'That password is too weak.', 400));
    await TestBed.configureTestingModule({
      imports: [ResetConfirm],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: ActivatedRoute, useValue: activatedRouteWithToken('t') },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ResetConfirm);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    setValue(compiled.querySelector<HTMLInputElement>('input[type=password]')!, 'weak');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.error-note')?.textContent).toContain('That password is too weak.');
  });

  it('shows an error state without calling the API when the token is missing', async () => {
    await TestBed.configureTestingModule({
      imports: [ResetConfirm],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: ActivatedRoute, useValue: activatedRouteWithToken(null) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ResetConfirm);
    fixture.detectChanges();

    expect(api.confirmPasswordResetCalls).toEqual([]);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).not.toContain('Your password is changed');
    expect(compiled.querySelector('[role=alert]')).toBeTruthy();
  });
});
