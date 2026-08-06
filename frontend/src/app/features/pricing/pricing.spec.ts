import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Pricing } from './pricing';
import { ApiClient } from '../../core/api/api-client';
import { UserDto } from '../../core/api/types';

const CHECKOUT_SCRIPT_SRC = 'https://checkout.freemius.com/js/v1/';

/** Pricing never calls the API itself; a bare stub satisfies UserStore's DI. */
class FakeApiClient {
  me(): Promise<UserDto> {
    return Promise.reject(new Error('not used by Pricing'));
  }
}

function findButtonByText(compiled: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(compiled.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;
}

describe('Pricing', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Pricing],
      providers: [{ provide: ApiClient, useValue: new FakeApiClient() }, provideRouter([])],
    }).compileComponents();
  });

  it('shows the not-connected note and appends no checkout script while the product id is a placeholder', async () => {
    const fixture = TestBed.createComponent(Pricing);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    findButtonByText(compiled, 'Go Pro')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Checkout is not connected yet.');
    expect(document.querySelector(`script[src="${CHECKOUT_SCRIPT_SRC}"]`)).toBeNull();
  });

  it('shows the checkout-failed note and resets busy when the checkout handler throws', async () => {
    const fixture = TestBed.createComponent(Pricing);
    // Test seams (see pricing.ts): bypass the placeholder guard and the real script loader so
    // this never touches the DOM/network, then make FS.Checkout itself throw.
    (fixture.componentInstance as unknown as { productId: string }).productId = 'not-a-placeholder-id';
    (fixture.componentInstance as unknown as { loadScript: () => Promise<void> }).loadScript = () =>
      Promise.resolve();
    (window as unknown as { FS?: unknown }).FS = {
      Checkout: class {
        constructor() {
          throw new Error('boom');
        }
      },
    };

    try {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      findButtonByText(compiled, 'Go Pro')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(compiled.textContent).toContain('Checkout did not open. Please try again.');
      expect((fixture.componentInstance as unknown as { busy: () => boolean }).busy()).toBe(false);
    } finally {
      delete (window as unknown as { FS?: unknown }).FS;
    }
  });
});
