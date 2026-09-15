import { Component } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Location } from '@angular/common';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { unauthenticatedInterceptor } from './unauthenticated.interceptor';
import { UserStore } from '../auth/user-store';
import { UserDto } from './types';

/** No-op routed target so provideRouter() has something real to navigate to. */
@Component({ selector: 'unauthenticated-interceptor-spec-blank', template: '' })
class BlankPage {}

describe('unauthenticatedInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let store: UserStore;
  let location: Location;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([unauthenticatedInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'login', component: BlankPage },
          { path: 'dashboard', component: BlankPage },
        ]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(UserStore);
    location = TestBed.inject(Location);
  });

  afterEach(() => httpMock.verify());

  it('clears UserStore and opens /login on a 401 with a signed-in user', fakeAsync(() => {
    const user: UserDto = { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' };
    store.user.set(user);
    store.loaded.set(true);

    let error: unknown;
    http.get('/v1/me').subscribe({ error: (e) => (error = e) });
    const req = httpMock.expectOne('/v1/me');
    req.flush({ code: 'unauthenticated', message: 'not signed in' }, { status: 401, statusText: 'Unauthorized' });
    tick();

    expect(error).toBeTruthy();
    expect(store.user()).toBeNull();
    expect(location.path()).toBe('/login');
  }));

  it('keeps the current URL on a 401 with no signed-in user', fakeAsync(() => {
    const before = location.path();

    let error: unknown;
    http.get('/v1/me').subscribe({ error: (e) => (error = e) });
    const req = httpMock.expectOne('/v1/me');
    req.flush({ code: 'unauthenticated', message: 'not signed in' }, { status: 401, statusText: 'Unauthorized' });
    tick();

    expect(error).toBeTruthy();
    expect(store.user()).toBeNull();
    expect(location.path()).toBe(before);
  }));
});
