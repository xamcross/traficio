import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Privacy } from './privacy';

describe('Privacy', () => {
  let text: string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Privacy],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(Privacy);
    fixture.detectChanges();
    text = (fixture.nativeElement as HTMLElement).textContent ?? '';
  });

  it('names each processor the service sends data to', () => {
    for (const name of ['Fly.io', 'MongoDB Atlas', 'Cloudflare', 'Resend', 'Anthropic', 'Freemius', 'Google']) {
      expect(text).withContext(name).toContain(name);
    }
  });

  it('describes Google sign-in and what Traficio gets from it', () => {
    expect(text).toContain('Sign in with Google');
    expect(text).toContain('your email address');
    expect(text).toContain('Google account id');
  });

  it('states the real retention: no backup copy, 7-day server logs, 30-day sessions', () => {
    expect(text).toContain('We keep no backup copy');
    expect(text).toContain('7 days');
    expect(text).toContain('30 days');
    expect(text).not.toContain('Our backups hold a copy');
  });

  it('tells a visitor of the free preview that the IP address is kept for one hour', () => {
    expect(text).toContain('IP address');
    expect(text).toContain('one hour');
  });

  it('gives the support address for a copy or a deletion of the data', () => {
    expect(text).toContain('support@traficio.com');
    expect(text).toContain('delete');
  });
});
