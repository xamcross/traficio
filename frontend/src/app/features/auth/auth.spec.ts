import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Register } from './register';
import { Login } from './login';
import { VerifyEmail } from './verify-email';
import { AuthComplete } from './auth-complete';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { UserDto } from '../../core/api/types';

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function submitForm(compiled: HTMLElement): void {
  compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
}

function fillLoginForm(compiled: HTMLElement, email: string, password: string): void {
  setValue(compiled.querySelector<HTMLInputElement>('input[type=email]')!, email);
  setValue(compiled.querySelector<HTMLInputElement>('input[type=password]')!, password);
}

/** A default-rejected promise, pre-handled so it does not log as an unhandled rejection until used. */
function silentlyRejected<T>(error: unknown): Promise<T> {
  const p = Promise.reject(error) as Promise<T>;
  p.catch(() => {});
  return p;
}

/** Hand-rolled fake with controllable, per-call-configurable promises. No jasmine.createSpy. */
class FakeApiClient {
  registerResult: Promise<unknown> = Promise.resolve(undefined);
  loginResult: Promise<UserDto> = silentlyRejected(new ApiError('not_configured', 'not configured', 0));
  verifyEmailResult: Promise<unknown> = Promise.resolve(undefined);
  meResult: Promise<UserDto> = silentlyRejected(new ApiError('unauthenticated', 'not signed in', 401));

  registerCalls: Array<{ email: string; password: string }> = [];
  loginCalls: Array<{ email: string; password: string }> = [];
  verifyEmailCalls: string[] = [];

  register(email: string, password: string): Promise<unknown> {
    this.registerCalls.push({ email, password });
    return this.registerResult;
  }
  login(email: string, password: string): Promise<UserDto> {
    this.loginCalls.push({ email, password });
    return this.loginResult;
  }
  verifyEmail(token: string): Promise<unknown> {
    this.verifyEmailCalls.push(token);
    return this.verifyEmailResult;
  }
  me(): Promise<UserDto> {
    return this.meResult;
  }
}

class FakeRouter {
  navigations: string[] = [];
  navigateByUrl(url: string): Promise<boolean> {
    this.navigations.push(url);
    return Promise.resolve(true);
  }
}

function activatedRouteWithToken(token: string | null): ActivatedRoute {
  return {
    snapshot: { queryParamMap: convertToParamMap(token === null ? {} : { token }) },
  } as ActivatedRoute;
}

describe('Register', () => {
  let api: FakeApiClient;

  beforeEach(async () => {
    api = new FakeApiClient();
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [{ provide: ApiClient, useValue: api }],
    }).compileComponents();
  });

  it('calls register and shows the check-your-email panel on success', async () => {
    api.registerResult = Promise.resolve(undefined);
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    fillLoginForm(compiled, 'a@b.com', 'secret123');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.registerCalls).toEqual([{ email: 'a@b.com', password: 'secret123' }]);
    expect(compiled.textContent).toContain('Check your email');
  });

  it('shows an "already have an account" message for email_taken', async () => {
    api.registerResult = Promise.reject(new ApiError('email_taken', 'That email is taken.', 409));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    fillLoginForm(compiled, 'a@b.com', 'secret123');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.textContent).toContain('already have an account');
  });
});

describe('Login', () => {
  let api: FakeApiClient;
  let router: FakeRouter;

  beforeEach(async () => {
    api = new FakeApiClient();
    router = new FakeRouter();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  it('logs in, sets the store user, and navigates to /dashboard', async () => {
    const user: UserDto = { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' };
    api.loginResult = Promise.resolve(user);
    api.meResult = Promise.resolve(user);

    const fixture = TestBed.createComponent(Login);
    const store = TestBed.inject(UserStore);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    fillLoginForm(compiled, 'a@b.com', 'secret123');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.user()).toEqual(user);
    expect(router.navigations).toEqual(['/dashboard']);
  });

  it('renders the error note for invalid_credentials', async () => {
    api.loginResult = Promise.reject(new ApiError('invalid_credentials', 'Wrong email or password.', 401));

    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    fillLoginForm(compiled, 'a@b.com', 'secret123');
    submitForm(compiled);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.error-note')?.textContent).toContain('Wrong email or password.');
    expect(router.navigations).toEqual([]);
  });
});

describe('VerifyEmail', () => {
  let api: FakeApiClient;

  beforeEach(() => {
    api = new FakeApiClient();
  });

  it('reads the token query param, calls verifyEmail, and shows success text', async () => {
    api.verifyEmailResult = Promise.resolve(undefined);
    await TestBed.configureTestingModule({
      imports: [VerifyEmail],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ActivatedRoute, useValue: activatedRouteWithToken('abc') },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifyEmail);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.verifyEmailCalls).toEqual(['abc']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Your email is confirmed');
  });

  it('shows a "link does not work" message and a log-in link for invalid_token', async () => {
    api.verifyEmailResult = Promise.reject(new ApiError('invalid_token', 'That link is not valid.', 400));
    await TestBed.configureTestingModule({
      imports: [VerifyEmail],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ActivatedRoute, useValue: activatedRouteWithToken('abc') },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifyEmail);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('link does not work');
    expect(compiled.querySelector('a[href="/login"]')).toBeTruthy();
  });

  it('shows an error state without calling the API when the token is missing', async () => {
    await TestBed.configureTestingModule({
      imports: [VerifyEmail],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ActivatedRoute, useValue: activatedRouteWithToken(null) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifyEmail);
    fixture.detectChanges();

    expect(api.verifyEmailCalls).toEqual([]);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).not.toContain('Your email is confirmed');
    expect(compiled.querySelector('[role=alert]')).toBeTruthy();
  });
});

describe('AuthComplete', () => {
  it('refreshes the store and redirects to /dashboard when a session exists', async () => {
    const api = new FakeApiClient();
    const router = new FakeRouter();
    const user: UserDto = { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' };
    api.meResult = Promise.resolve(user);

    await TestBed.configureTestingModule({
      imports: [AuthComplete],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthComplete);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(router.navigations).toEqual(['/dashboard']);
  });

  it('redirects to /login when no session exists', async () => {
    const api = new FakeApiClient();
    const router = new FakeRouter();
    api.meResult = Promise.reject(new ApiError('unauthenticated', 'not signed in', 401));

    await TestBed.configureTestingModule({
      imports: [AuthComplete],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthComplete);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(router.navigations).toEqual(['/login']);
  });
});
