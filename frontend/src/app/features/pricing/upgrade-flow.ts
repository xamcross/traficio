import { inject, Injectable } from '@angular/core';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { FREEMIUS_PRODUCT_ID, FREEMIUS_PUBLIC_KEY } from '../../core/config';

type FreemiusCheckout = { open: (o: object) => void };
type FreemiusGlobal = { FS?: { Checkout: new (o: object) => FreemiusCheckout } };

const FREEMIUS_SCRIPT_TIMEOUT_MS = 10_000;

/** Module-level cache so the checkout script is appended once, however many times checkout opens. */
let freemiusScriptPromise: Promise<void> | null = null;

export function loadFreemiusScript(): Promise<void> {
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
    // A rejected load clears the cache. This lets the next click retry.
    freemiusScriptPromise = Promise.race([scriptLoad, timeout]).catch((e: unknown) => {
      freemiusScriptPromise = null;
      throw e;
    });
  }
  return freemiusScriptPromise;
}

/** Opens the Freemius overlay and waits for the webhook to flip the tier. Spec §5.5. */
@Injectable({ providedIn: 'root' })
export class UpgradeFlow {
  private api = inject(ApiClient);
  private store = inject(UserStore);

  // Test seams.
  productId = FREEMIUS_PRODUCT_ID;
  publicKey = FREEMIUS_PUBLIC_KEY;
  loadScript: () => Promise<void> = loadFreemiusScript;
  pollMs = 2000;
  maxPolls = 30;

  async openCheckout(email: string, onSuccess: () => void): Promise<void> {
    if (this.productId.startsWith('REPLACE_ME')) throw new Error('not_connected');
    await this.loadScript();
    const fs = (window as unknown as FreemiusGlobal).FS;
    const handler = new fs!.Checkout({ product_id: this.productId, public_key: this.publicKey });
    handler.open({ email, success: onSuccess });
  }

  async awaitUpgrade(): Promise<boolean> {
    for (let i = 0; i < this.maxPolls; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, this.pollMs));
      try {
        const me = await this.api.me();
        if (me.tier === 'pro') {
          this.store.user.set(me);
          return true;
        }
      } catch {
        // A failed poll does not stop the check. The loop continues.
      }
    }
    return false;
  }
}
