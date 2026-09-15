import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiClient } from '../api/api-client';
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
