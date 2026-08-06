import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FREEMIUS_PRODUCT_ID, FREEMIUS_PUBLIC_KEY } from '../../core/config';
import { UserStore } from '../../core/auth/user-store';

type FreemiusCheckout = { open: (o: object) => void };
type FreemiusGlobal = { FS?: { Checkout: new (o: object) => FreemiusCheckout } };

/** Module-level cache so the checkout script is only ever appended to the page once, however many times "Go Pro" is clicked. */
let freemiusScriptPromise: Promise<void> | null = null;

function loadFreemiusScript(): Promise<void> {
  if (!freemiusScriptPromise) {
    freemiusScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.freemius.com/js/v1/';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the checkout script.'));
      document.head.appendChild(script);
    });
  }
  return freemiusScriptPromise;
}

@Component({
  selector: 'app-pricing',
  imports: [RouterLink],
  template: `
    <h1>Pricing</h1>

    <div class="plans">
      <section>
        <h2>Free</h2>
        <ul>
          <li>1 site</li>
          <li>1 check each month</li>
          <li>The full plan and task tracking</li>
        </ul>
      </section>

      <section>
        <h2>Pro</h2>
        <ul>
          <li>5 sites</li>
          <li>10 checks each month</li>
          <li>Re-checks with auto-verification</li>
          <li>Score history</li>
        </ul>

        <button type="button" (click)="goPro()" [disabled]="busy()">Go Pro</button>

        @if (note(); as n) {
          <p class="error-note" role="alert">{{ n }}</p>
        }
      </section>
    </div>

    <footer>
      <a routerLink="/">Home</a>
    </footer>
  `,
})
export class Pricing {
  private store = inject(UserStore);

  protected readonly busy = signal(false);
  protected readonly note = signal<string | null>(null);

  protected async goPro(): Promise<void> {
    if (FREEMIUS_PRODUCT_ID.startsWith('REPLACE_ME')) {
      this.note.set('Checkout is not connected yet.');
      return;
    }

    this.busy.set(true);
    this.note.set(null);
    try {
      await loadFreemiusScript();
      const fs = (window as unknown as FreemiusGlobal).FS;
      const handler = new fs!.Checkout({ product_id: FREEMIUS_PRODUCT_ID, public_key: FREEMIUS_PUBLIC_KEY });
      handler.open({ email: this.store.user()?.email ?? '', success: () => location.assign('/account') });
    } catch {
      this.note.set('Checkout did not open. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
