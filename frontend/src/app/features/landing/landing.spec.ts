import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Landing } from './landing';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PENDING_URL_KEY, PRO_PRICE_LABEL } from '../../core/config';
import { UserDto } from '../../core/api/types';

@Component({ selector: 'landing-spec-blank', template: '' })
class BlankPage {}

class FakeApiClient { me(): Promise<UserDto> { return Promise.reject(new Error('not used')); } }

describe('Landing', () => {
  beforeEach(async () => {
    sessionStorage.removeItem(PENDING_URL_KEY);
    await TestBed.configureTestingModule({
      imports: [Landing],
      providers: [
        { provide: ApiClient, useValue: new FakeApiClient() },
        provideRouter([{ path: 'signup', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
      ],
    }).compileComponents();
  });
  afterEach(() => sessionStorage.removeItem(PENDING_URL_KEY));

  it('shows the hero, the three steps, the free promise and the price', () => {
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Your customers ask AI. Does it know you exist?');
    expect(text).toContain('You give us your web address');
    expect(text).toContain('We read it the way machines do');
    expect(text).toContain('You fix one thing at a time');
    expect(text).toContain('Your score and every problem we find. No card, no trial clock.');
    expect(text).toContain(`${PRO_PRICE_LABEL} a month`);
    expect(text).toContain('EXAMPLE RESULT, FREE TIER');
  });

  it('stores the url and goes to signup when signed out', async () => {
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[type=text]')!;
    input.value = 'rivertonbakery.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBe('rivertonbakery.com');
    expect(TestBed.inject(Location).path()).toBe('/signup');
  });

  it('goes to the dashboard when signed in', async () => {
    TestBed.inject(UserStore).user.set({ id: 'u1', email: 'a@example.com', emailVerified: true, tier: 'free' });
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[type=text]')!;
    input.value = 'x.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('/dashboard');
  });
});
