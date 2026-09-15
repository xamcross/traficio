import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { ApiClient } from '../api/api-client';
import { UserDto } from '../api/types';
import { rootGuard } from './guards';

/** A default-rejected promise, pre-handled so it does not log as an unhandled rejection until used. */
function silentlyRejected<T>(error: unknown): Promise<T> {
  const p = Promise.reject(error) as Promise<T>;
  p.catch(() => {});
  return p;
}

/** Hand-rolled fake with a controllable, per-call promise. No jasmine.createSpy. */
class FakeApiClient {
  meResult: Promise<UserDto> = silentlyRejected(new Error('unauthenticated'));
  meCalls = 0;

  me(): Promise<UserDto> {
    this.meCalls++;
    return this.meResult;
  }
}

function configure(api: FakeApiClient, platform: 'server' | 'browser'): void {
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
    configure(api, 'server');

    const result = await TestBed.runInInjectionContext(() => rootGuard({} as never, {} as never));

    expect(result).toBe(true);
    expect(api.meCalls).toBe(0);
  });

  it('sends a signed-in browser visitor to the dashboard', async () => {
    const api = new FakeApiClient();
    api.meResult = Promise.resolve({ id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' });
    configure(api, 'browser');

    const result = await TestBed.runInInjectionContext(() => rootGuard({} as never, {} as never));

    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('lets a guest through in the browser', async () => {
    const api = new FakeApiClient();
    configure(api, 'browser');

    const result = await TestBed.runInInjectionContext(() => rootGuard({} as never, {} as never));

    expect(result).toBe(true);
  });
});
