import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { ApiClient } from '../api/api-client';
import { UserDto } from '../api/types';
import { authGuard, guestGuard, rootGuard } from './guards';
import { UserStore } from './user-store';

/** Hand-rolled fake with a controllable, per-call promise. No jasmine.createSpy. */
class FakeApiClient {
  meResult: Promise<UserDto> = Promise.resolve({ id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' });
  meCalls = 0;

  me(): Promise<UserDto> {
    this.meCalls++;
    return this.meResult;
  }
}

function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return { id: 'u1', email: 'ada@example.com', emailVerified: true, tier: 'free', ...overrides };
}

/** The two arguments every CanActivateFn takes. None of these guards read them. */
const route = {} as ActivatedRouteSnapshot;
const state = {} as RouterStateSnapshot;

describe('authGuard', () => {
  let api: FakeApiClient;
  let store: UserStore;

  beforeEach(() => {
    api = new FakeApiClient();
    TestBed.configureTestingModule({
      providers: [{ provide: ApiClient, useValue: api }, provideRouter([])],
    });
    store = TestBed.inject(UserStore);
  });

  it('when the store is already loaded, starts a background refresh but resolves without waiting for /v1/me', async () => {
    store.user.set(makeUser());
    store.loaded.set(true);
    api.meResult = new Promise<UserDto>(() => {}); // never resolves — a wait on it would hang the test

    const result = await TestBed.runInInjectionContext(() => authGuard(route, state));

    expect(result).toBe(true);
    expect(api.meCalls).toBe(1); // the refresh was started
  });

  it('when the store is not loaded, awaits the refresh before deciding', async () => {
    api.meResult = Promise.resolve(makeUser());

    const result = await TestBed.runInInjectionContext(() => authGuard(route, state));

    expect(result).toBe(true);
    expect(store.user()?.id).toBe('u1');
  });

  it('sends a guest to /login', async () => {
    api.meResult = Promise.reject(new Error('no session'));

    const result = await TestBed.runInInjectionContext(() => authGuard(route, state));

    const router = TestBed.inject(Router);
    expect(result).toEqual(router.createUrlTree(['/login']));
  });
});

describe('guestGuard', () => {
  let api: FakeApiClient;
  let store: UserStore;

  beforeEach(() => {
    api = new FakeApiClient();
    TestBed.configureTestingModule({
      providers: [{ provide: ApiClient, useValue: api }, provideRouter([])],
    });
    store = TestBed.inject(UserStore);
  });

  it('when the store is already loaded, starts a background refresh but resolves without waiting for /v1/me', async () => {
    store.user.set(null);
    store.loaded.set(true);
    api.meResult = new Promise<UserDto>(() => {}); // never resolves — a wait on it would hang the test

    const result = await TestBed.runInInjectionContext(() => guestGuard(route, state));

    expect(result).toBe(true);
    expect(api.meCalls).toBe(1); // the refresh was started
  });

  it('sends a signed-in visitor to /dashboard', async () => {
    api.meResult = Promise.resolve(makeUser());

    const result = await TestBed.runInInjectionContext(() => guestGuard(route, state));

    const router = TestBed.inject(Router);
    expect(result).toEqual(router.createUrlTree(['/dashboard']));
  });
});

/** rootGuard also takes a platform, since the root route pre-renders on the server. */
function configureRoot(api: FakeApiClient, platform: 'server' | 'browser'): void {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: PLATFORM_ID, useValue: platform },
      provideRouter([]),
    ],
  });
}

describe('rootGuard', () => {
  it('returns true on the server, without loading the user', async () => {
    const api = new FakeApiClient();
    configureRoot(api, 'server');

    const result = await TestBed.runInInjectionContext(() => rootGuard(route, state));

    expect(result).toBe(true);
    expect(api.meCalls).toBe(0);
  });

  it('sends a signed-in browser visitor to the dashboard', async () => {
    const api = new FakeApiClient();
    api.meResult = Promise.resolve(makeUser());
    configureRoot(api, 'browser');

    const result = await TestBed.runInInjectionContext(() => rootGuard(route, state));

    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('lets a guest through in the browser', async () => {
    const api = new FakeApiClient();
    api.meResult = Promise.reject(new Error('unauthenticated'));
    configureRoot(api, 'browser');

    const result = await TestBed.runInInjectionContext(() => rootGuard(route, state));

    expect(result).toBe(true);
  });
});
