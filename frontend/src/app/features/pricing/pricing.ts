import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FREEMIUS_PRODUCT_ID, FREEMIUS_PUBLIC_KEY } from '../../core/config';
import { UserStore } from '../../core/auth/user-store';

type FreemiusCheckout = { open: (o: object) => void };
type FreemiusGlobal = { FS?: { Checkout: new (o: object) => FreemiusCheckout } };

const FREEMIUS_SCRIPT_TIMEOUT_MS = 10_000;

/** Module-level cache so the checkout script is only ever appended to the page once, however many times "Go Pro" is clicked. */
let freemiusScriptPromise: Promise<void> | null = null;

function loadFreemiusScript(): Promise<void> {
  if (!freemiusScriptPromise) {
    const scriptLoad = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.freemius.com/js/v1/';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the checkout script.'));
      document.head.appendChild(script);
    });

    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Timed out loading the checkout script.')), FREEMIUS_SCRIPT_TIMEOUT_MS);
    });

    // If neither onload nor onerror ever fires, the timeout still settles the race so `busy`
    // always gets reset. Either way, a rejection must not poison the cache: null it out so the
    // next click can retry the load instead of forever awaiting a promise that already lost.
    freemiusScriptPromise = Promise.race([scriptLoad, timeout]).catch((e: unknown) => {
      freemiusScriptPromise = null;
      throw e;
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

  // Test seams: constructor-visible fields, overridable from a spec, instead of mutating the
  // module consts or the module-level script loader directly.
  protected productId = FREEMIUS_PRODUCT_ID;
  protected loadScript: () => Promise<void> = loadFreemiusScript;

  protected readonly busy = signal(false);
  protected readonly note = signal<string | null>(null);

  protected async goPro(): Promise<void> {
    if (this.productId.startsWith('REPLACE_ME')) {
      this.note.set('Checkout is not connected yet.');
      return;
    }

    this.busy.set(true);
    this.note.set(null);
    try {
      await this.loadScript();
      const fs = (window as unknown as FreemiusGlobal).FS;
      const handler = new fs!.Checkout({ product_id: this.productId, public_key: FREEMIUS_PUBLIC_KEY });
      handler.open({ email: this.store.user()?.email ?? '', success: () => location.assign('/account') });
    } catch {
      this.note.set('Checkout did not open. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
