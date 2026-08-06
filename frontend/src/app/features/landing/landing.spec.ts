import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Landing } from './landing';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { UserDto } from '../../core/api/types';
import { PENDING_URL_KEY } from '../../core/config';

/** No-op routed targets so provideRouter() has something real to navigate to. */
@Component({ selector: 'landing-spec-blank', template: '' })
class BlankPage {}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function submitForm(compiled: HTMLElement): void {
  compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
}

function findButtonByText(compiled: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(compiled.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;
}

/** Landing never calls the API itself (the app shell owns the /v1/me refresh); a bare stub satisfies UserStore's DI. */
class FakeApiClient {
  me(): Promise<UserDto> {
    return Promise.reject(new Error('not used by Landing'));
  }
}

describe('Landing', () => {
  beforeEach(async () => {
    sessionStorage.removeItem(PENDING_URL_KEY);
    await TestBed.configureTestingModule({
      imports: [Landing],
      providers: [
        { provide: ApiClient, useValue: new FakeApiClient() },
        provideRouter([
          { path: 'signup', component: BlankPage },
          { path: 'dashboard', component: BlankPage },
        ]),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    sessionStorage.removeItem(PENDING_URL_KEY);
  });

  it('renders the URL input and a "Check my site" button', () => {
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('input')).toBeTruthy();
    expect(findButtonByText(compiled, 'Check my site')).toBeTruthy();
  });

  it('stores the URL in sessionStorage and navigates to /signup when logged out', async () => {
    const fixture = TestBed.createComponent(Landing);
    const location = TestBed.inject(Location);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    setValue(compiled.querySelector('input')!, 'example.com');
    submitForm(compiled);
    await fixture.whenStable();

    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBe('example.com');
    expect(location.path()).toBe('/signup');
  });

  it('stores the URL in sessionStorage and navigates to /dashboard when logged in', async () => {
    const fixture = TestBed.createComponent(Landing);
    const store = TestBed.inject(UserStore);
    const location = TestBed.inject(Location);
    const user: UserDto = { id: 'u1', email: 'a@b.com', emailVerified: true, tier: 'free' };
    store.user.set(user);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    setValue(compiled.querySelector('input')!, 'example.com');
    submitForm(compiled);
    await fixture.whenStable();

    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBe('example.com');
    expect(location.path()).toBe('/dashboard');
  });
});
