import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { Landing } from './landing';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PENDING_URL_KEY, PRO_PRICE_LABEL } from '../../core/config';
import { PreviewDto, UserDto } from '../../core/api/types';

@Component({ selector: 'landing-spec-blank', template: '' })
class BlankPage {}

class FakeApiClient {
  constructor(private previewImpl: (url: string) => Promise<PreviewDto> = () => Promise.reject(new Error('not used'))) {}
  me(): Promise<UserDto> { return Promise.reject(new Error('not used')); }
  preview(url: string): Promise<PreviewDto> { return this.previewImpl(url); }
}

const PREVIEW: PreviewDto = {
  domain: 'rivertonbakery.com',
  pagesChecked: 4,
  checks: [
    { id: 'https', severity: 'good', description: 'Your site uses HTTPS.' },
    { id: 'ai-readable', severity: 'critical', description: 'An AI assistant cannot read your pages.' },
    { id: 'meta-desc', severity: 'medium', description: 'Some pages are missing a meta description.' },
  ],
};

function setUrl(fixture: ReturnType<typeof TestBed.createComponent>, value: string): void {
  const el = fixture.nativeElement as HTMLElement;
  const input = el.querySelector<HTMLInputElement>('input[type=text]')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function submitForm(fixture: ReturnType<typeof TestBed.createComponent>): void {
  const el = fixture.nativeElement as HTMLElement;
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
}

function configure(previewImpl?: (url: string) => Promise<PreviewDto>) {
  return TestBed.configureTestingModule({
    imports: [Landing],
    providers: [
      { provide: ApiClient, useValue: new FakeApiClient(previewImpl) },
      provideRouter([{ path: 'signup', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
    ],
  }).compileComponents();
}

describe('Landing', () => {
  beforeEach(() => sessionStorage.removeItem(PENDING_URL_KEY));
  afterEach(() => sessionStorage.removeItem(PENDING_URL_KEY));

  it('shows the hero, the three steps, the free promise and the price', async () => {
    await configure();
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

  it('goes to the dashboard when signed in, without running a preview', async () => {
    await configure();
    TestBed.inject(UserStore).user.set({ id: 'u1', email: 'a@example.com', emailVerified: true, tier: 'free' });
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    setUrl(fixture, 'x.com');
    fixture.detectChanges();
    submitForm(fixture);
    await fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('/dashboard');
  });

  it('stores the url and runs the preview in place, worst finding first, with no invented score', async () => {
    await configure(() => Promise.resolve(PREVIEW));
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    setUrl(fixture, 'rivertonbakery.com');
    fixture.detectChanges();
    submitForm(fixture);
    fixture.detectChanges();

    // The address is stored right away, and the visitor stays on the landing page — no
    // immediate trip to signup, since the preview runs in place first.
    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBe('rivertonbakery.com');
    expect(TestBed.inject(Location).path()).not.toBe('/signup');
    let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Reading your pages…');

    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    text = el.textContent ?? '';
    expect(text).toContain('rivertonbakery.com');
    expect(text).toContain('An AI assistant cannot read your pages.');
    expect(text).toContain('Some pages are missing a meta description.');
    expect(text).toContain('Your site uses HTTPS.');
    // No score, grade or percentage is ever shown for a preview.
    expect(text).not.toMatch(/\d+\s*\/\s*100/);
    expect(text).not.toMatch(/\d+%/);

    const rows = Array.from(el.querySelectorAll('.check')).map((row) => row.textContent ?? '');
    const criticalIndex = rows.findIndex((r) => r.includes('An AI assistant cannot read your pages.'));
    const mediumIndex = rows.findIndex((r) => r.includes('Some pages are missing a meta description.'));
    const goodIndex = rows.findIndex((r) => r.includes('Your site uses HTTPS.'));
    expect(criticalIndex).toBeLessThan(mediumIndex);
    expect(mediumIndex).toBeLessThan(goodIndex);

    // The call to action carries the same URL through to signup, unchanged.
    const cta = el.querySelector<HTMLAnchorElement>('a[href="/signup"]')!;
    expect(cta.textContent).toContain('Create my free account');
    cta.click();
    await fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('/signup');
    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBe('rivertonbakery.com');
  });

  it('shows the limit message on a 429, and never claims a network error', async () => {
    await configure(() => Promise.reject(new ApiError('rate_limited', 'Too many previews.', 429)));
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    setUrl(fixture, 'rivertonbakery.com');
    fixture.detectChanges();
    submitForm(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('You have used your three free previews for this hour.');
    expect(text).not.toContain('We could not reach the server');
    const button = el.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(button.disabled).toBe(false);
  });

  it('shows the address message on a 400, and leaves the form editable', async () => {
    await configure(() => Promise.reject(new ApiError('invalid_url', 'Bad url.', 400)));
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    setUrl(fixture, 'not a url');
    fixture.detectChanges();
    submitForm(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('That address does not look right.');
    const input = el.querySelector<HTMLInputElement>('input[type=text]')!;
    expect(input.disabled).toBe(false);
  });

  it('never leaves the page stuck loading when the preview fails for another reason', async () => {
    await configure(() => Promise.reject(new Error('boom')));
    const fixture = TestBed.createComponent(Landing);
    fixture.detectChanges();
    setUrl(fixture, 'rivertonbakery.com');
    fixture.detectChanges();
    submitForm(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).not.toContain('Reading your pages…');
    expect(text).toContain('Something went wrong on our side. Try again.');
    const button = el.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(button.disabled).toBe(false);
  });
});
