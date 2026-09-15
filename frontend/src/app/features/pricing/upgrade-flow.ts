import { inject, Injectable } from '@angular/core';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { FREEMIUS_PRODUCT_ID, FREEMIUS_PUBLIC_KEY } from '../../core/config';

type FreemiusCheckout = { open: (o: object) => void };
type FreemiusGlobal = { FS?: { Checkout: new (o: object) => FreemiusCheckout } };

const FREEMIUS_SCRIPT_ID = 'freemius-checkout';
const FREEMIUS_SCRIPT_SRC = 'https://checkout.freemius.com/js/v1/';
const FREEMIUS_SCRIPT_TIMEOUT_MS = 10_000;

/** Module-level cache so the checkout script is appended once, however many times checkout opens. */
let freemiusScriptPromise: Promise<void> | null = null;

/** Clears the cached promise. A test calls this so the next call to loadFreemiusScript starts fresh. */
export function resetFreemiusScriptCache(): void {
  freemiusScriptPromise = null;
}

/**
 * Loads the Freemius checkout script once. It caches the promise for later calls.
 *
 * A prior call can time out. Its script element still loads in the background after that.
 * This function then finds that same element by id. It waits on that element. It does not
 * add a second element with the same src.
 *
 * This function resolves at once, with no new element, when window.FS already exists from
 * an earlier successful load.
 */
export function loadFreemiusScript(): Promise<void> {
  if ((window as unknown as FreemiusGlobal).FS) return Promise.resolve();
  if (!freemiusScriptPromise) {
    freemiusScriptPromise = new Promise<void>((resolve, reject) => {
      // The code declares timeoutHandle first. Then settle() always clears a real handle,
      // no matter how soon the call happens.
      const timeoutHandle = setTimeout(() => {
        freemiusScriptPromise = null;
        reject(new Error('Timed out loading the checkout script.'));
      }, FREEMIUS_SCRIPT_TIMEOUT_MS);
      const settle = (run: () => void) => {
        clearTimeout(timeoutHandle);
        run();
      };

      let script = document.getElementById(FREEMIUS_SCRIPT_ID) as HTMLScriptElement | null;
      // A failed element can never load. Remove it so a fresh element can retry.
      if (script?.dataset['state'] === 'failed') {
        script.remove();
        script = null;
      }
      if (!script) {
        script = document.createElement('script');
        script.id = FREEMIUS_SCRIPT_ID;
        script.src = FREEMIUS_SCRIPT_SRC;
        document.head.appendChild(script);
      }

      if (script.dataset['state'] === 'loaded') {
        // A caller reaches this line only after resetFreemiusScriptCache runs. This happens
        // while a loaded element from an earlier, successful load is still in the page.
        settle(resolve);
      } else if (!script.dataset['state']) {
        // The element has no state yet. It may be new. An earlier call may still track it,
        // after that call's own timeout. This call also waits for the load or the failure.
        const el = script;
        el.onload = () => {
          el.dataset['state'] = 'loaded';
          settle(resolve);
        };
        el.onerror = () => {
          el.dataset['state'] = 'failed';
          freemiusScriptPromise = null;
          settle(() => reject(new Error('Failed to load the checkout script.')));
        };
      }
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
    handler.open({ user_email: email, readonly_user: true, success: onSuccess });
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
