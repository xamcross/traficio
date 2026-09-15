import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Terms } from './terms';
import { FREE_TIER_COPY, PRO_PRICE_LABEL, PRO_TIER_COPY } from '../../core/config';

describe('Terms', () => {
  let text: string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Terms],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(Terms);
    fixture.detectChanges();
    text = (fixture.nativeElement as HTMLElement).textContent ?? '';
  });

  it('shows the price and the plan limits from the config, so the page cannot drift from the checkout', () => {
    expect(text).toContain(`${PRO_PRICE_LABEL} a month`);
    expect(text).toContain(`${FREE_TIER_COPY.sites} site`);
    expect(text).toContain(`${PRO_TIER_COPY.sites} sites`);
    expect(text).toContain(`${PRO_TIER_COPY.checks} checks`);
  });

  it('names Freemius as the seller and points refunds at its money-back guarantee', () => {
    expect(text).toContain('Freemius');
    expect(text).toContain('seller');
    expect(text).toContain('money-back guarantee');
  });

  it('explains cancellation: any time, Pro runs to the end of the paid month, then Free', () => {
    expect(text).toContain('Cancel at any time');
    expect(text).toContain('end of the month you have paid for');
    expect(text).toContain('support@traficio.com');
  });

  it('carries a limitation of liability and a governing-law section', () => {
    expect(text).toContain('Our liability');
    expect(text).toContain('Governing law');
  });
});
