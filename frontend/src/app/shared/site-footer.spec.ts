import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SiteFooter } from './site-footer';

describe('SiteFooter', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteFooter],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('carries the brand mark beside the wordmark, hidden from a screen reader', () => {
    const fixture = TestBed.createComponent(SiteFooter);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const mark = el.querySelector('.brand-faint svg');
    expect(mark).withContext('the footer wordmark carries the mark').not.toBeNull();
    expect(mark!.getAttribute('aria-hidden')).toBe('true');
    expect(el.textContent).toContain('TRAFICIO');
  });
});
