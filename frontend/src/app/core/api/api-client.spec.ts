import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiClient, ApiError } from './api-client';
import { credentialsInterceptor } from './credentials.interceptor';
import { UserDto } from './types';

describe('ApiClient', () => {
  let api: ApiClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([credentialsInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ApiClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('login posts to /v1/auth/login with credentials and resolves with the user', async () => {
    const user: UserDto = { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' };
    const promise = api.login('a@b.com', 'secret');

    const req = httpMock.expectOne('/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBeTrue();
    req.flush(user);

    await expectAsync(promise).toBeResolvedTo(user);
  });

  it('rejects with an ApiError carrying code and status for an envelope error body', async () => {
    const promise = api.login('a@b.com', 'bad');

    const req = httpMock.expectOne('/v1/auth/login');
    req.flush({ code: 'quota_exceeded', message: 'x' }, { status: 403, statusText: 'Forbidden' });

    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('quota_exceeded');
    expect((error as ApiError).status).toBe(403);
  });

  it('rejects with a network_error ApiError for a non-envelope error body', async () => {
    const promise = api.login('a@b.com', 'bad');

    const req = httpMock.expectOne('/v1/auth/login');
    req.flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('network_error');
  });

  it('listSites unwraps {sites:[...]} to the array', async () => {
    const promise = api.listSites();

    const req = httpMock.expectOne('/v1/sites');
    expect(req.request.method).toBe('GET');
    req.flush({ sites: [{ id: 's1', domain: 'x.com', url: 'https://x.com', platform: null, latestScores: null, readOnly: false }] });

    const sites = await promise;
    expect(sites.length).toBe(1);
    expect(sites[0].id).toBe('s1');
  });
});
