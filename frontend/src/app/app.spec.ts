import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { UserStore } from './core/auth/user-store';
import { UserDto } from './core/api/types';
import { SiteContext } from './core/site-context';

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

  it('shows the tier pill, the site domain and Account when logged in', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(UserStore);
    store.loaded.set(true);
    store.user.set({ id: 'u1', email: 'a@example.com', emailVerified: true, tier: 'pro' } as UserDto);
    TestBed.inject(SiteContext).set('rivertonbakery.com');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('rivertonbakery.com');
    expect(text).toContain('Pro');
    expect(text).toContain('Account');
    expect(text).not.toContain('Log in');
  });

  it('shows Pricing, Log in and Check my site when logged out', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(UserStore);
    store.loaded.set(true);
    store.user.set(null);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Pricing');
    expect(text).toContain('Log in');
    expect(text).toContain('Check my site');
  });
});
