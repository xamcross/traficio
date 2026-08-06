import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { UserStore } from './core/auth/user-store';
import { UserDto } from './core/api/types';

describe('App', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // The shell fires a fire-and-forget /v1/me refresh in its constructor; drain it.
    for (const req of httpMock.match('/v1/me')) {
      req.flush(null, { status: 401, statusText: 'Unauthorized' });
    }
    httpMock.verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('shows Log in when logged out', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(UserStore);
    store.loaded.set(true);
    store.user.set(null);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Log in');
    expect(compiled.textContent).not.toContain('Log out');
  });

  it('shows Log out when a user is set', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(UserStore);
    const user: UserDto = { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' };
    store.loaded.set(true);
    store.user.set(user);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Log out');
  });
});
