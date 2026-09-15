import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../api/api-client';
import { UserDto } from '../api/types';
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

describe('UserStore', () => {
  let api: FakeApiClient;
  let store: UserStore;

  beforeEach(() => {
    api = new FakeApiClient();
    TestBed.configureTestingModule({
      providers: [{ provide: ApiClient, useValue: api }],
    });
    store = TestBed.inject(UserStore);
  });

  it('makes one ApiClient.me() call when a second refresh() starts before the first resolves', async () => {
    let resolveMe!: (user: UserDto) => void;
    api.meResult = new Promise<UserDto>((resolve) => {
      resolveMe = resolve;
    });

    const first = store.refresh();
    const second = store.refresh();

    resolveMe({ id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' });
    await first;
    await second;

    expect(api.meCalls).toBe(1);
    expect(store.user()?.id).toBe('u1');
    expect(store.loaded()).toBeTrue();
  });

  describe('when a refresh fails', () => {
    function makeUser(overrides: Partial<UserDto> = {}): UserDto {
      return { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free', ...overrides };
    }

    beforeEach(() => {
      spyOn(console, 'warn'); // a network or server error logs a warning by design
    });

    it('keeps the current user on a network error (status 0)', async () => {
      store.user.set(makeUser());
      api.meResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));

      await store.refresh();

      expect(store.user()?.id).toBe('u1');
    });

    it('keeps the current user on a server error (status 502)', async () => {
      store.user.set(makeUser());
      api.meResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 502));

      await store.refresh();

      expect(store.user()?.id).toBe('u1');
    });

    it('clears the user on a real 401', async () => {
      store.user.set(makeUser());
      api.meResult = Promise.reject(new ApiError('unauthenticated', 'Please log in.', 401));

      await store.refresh();

      expect(store.user()).toBeNull();
    });

    it('keeps the current user on a 403 (a valid session, forbidden from something else)', async () => {
      store.user.set(makeUser());
      api.meResult = Promise.reject(new ApiError('forbidden', 'Not allowed.', 403));

      await store.refresh();

      expect(store.user()?.id).toBe('u1');
    });

    it('leaves loaded false on a network error during the first load, so the next guard retries', async () => {
      expect(store.loaded()).toBeFalse();
      api.meResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));

      await store.refresh();

      expect(store.loaded()).toBeFalse();
    });

    it('leaves loaded true on a network error after a load has already happened', async () => {
      store.loaded.set(true);
      api.meResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));

      await store.refresh();

      expect(store.loaded()).toBeTrue();
    });
  });

  describe('when the tab becomes visible again', () => {
    afterEach(() => {
      Reflect.deleteProperty(document, 'visibilityState');
    });

    function makeVisible(): void {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('calls /v1/me one time', async () => {
      api.meResult = Promise.resolve({ id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' });

      makeVisible();
      await Promise.resolve();
      await Promise.resolve();

      expect(api.meCalls).toBe(1);
    });

    it('does not start a second request while the first is in flight', async () => {
      let resolveMe!: (user: UserDto) => void;
      api.meResult = new Promise<UserDto>((resolve) => {
        resolveMe = resolve;
      });

      makeVisible();
      makeVisible(); // fired again while the first request is still pending

      resolveMe({ id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' });
      await Promise.resolve();
      await Promise.resolve();

      expect(api.meCalls).toBe(1);
    });

    it('does nothing when the tab becomes hidden', async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();

      expect(api.meCalls).toBe(0);
    });

    it('keeps the current user when the refresh on becoming visible hits a network error', async () => {
      spyOn(console, 'warn'); // the network error logs a warning by design
      store.user.set({ id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' });
      api.meResult = Promise.reject(new ApiError('network_error', 'We could not reach the server.', 0));

      makeVisible();
      await Promise.resolve();
      await Promise.resolve();

      expect(store.user()?.id).toBe('u1');
    });
  });
});

describe('UserStore on the server', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('does not register a visibility listener', async () => {
    const api = new FakeApiClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });
    TestBed.inject(UserStore); // constructs on the "server" platform

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(api.meCalls).toBe(0);
  });
});
