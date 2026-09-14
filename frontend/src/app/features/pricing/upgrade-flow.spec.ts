import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { UpgradeFlow, loadFreemiusScript, resetFreemiusScriptCache } from './upgrade-flow';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { UserDto } from '../../core/api/types';

const FREEMIUS_SCRIPT_SELECTOR = 'script[src^="https://checkout.freemius.com"]';

function freemiusScriptEl(): HTMLScriptElement | null {
  return document.getElementById('freemius-checkout') as HTMLScriptElement | null;
}

class FakeApiClient {
  tiers: Array<'free' | 'pro'> = [];
  calls = 0;
  me(): Promise<UserDto> {
    const tier = this.tiers[Math.min(this.calls, this.tiers.length - 1)] ?? 'free';
    this.calls++;
    return Promise.resolve({ id: 'u1', email: 'a@example.com', emailVerified: true, tier });
  }
}

describe('UpgradeFlow', () => {
  let api: FakeApiClient;
  let flow: UpgradeFlow;

  beforeEach(() => {
    api = new FakeApiClient();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    flow = TestBed.inject(UpgradeFlow);
    flow.pollMs = 0;
  });

  it('rejects with not_connected while the product id is a placeholder', async () => {
    flow.productId = 'REPLACE_ME_FREEMIUS_PRODUCT_ID';
    await expectAsync(flow.openCheckout('a@example.com', () => {})).toBeRejectedWithError('not_connected');
  });

  it('opens the checkout with the account email locked read-only', async () => {
    let openedWith: Record<string, unknown> | undefined;
    flow.productId = 'prod_1';
    flow.loadScript = () => Promise.resolve();
    (window as unknown as { FS: unknown }).FS = {
      Checkout: class {
        open(o: object) {
          openedWith = o as Record<string, unknown>;
        }
      },
    };

    await flow.openCheckout('a@example.com', () => {});

    expect(openedWith?.['user_email']).toBe('a@example.com');
    expect(openedWith?.['readonly_user']).toBe(true);
    expect(openedWith?.['email']).toBeUndefined();

    delete (window as unknown as { FS?: unknown }).FS;
  });

  it('resolves true and updates the store once the tier turns pro', async () => {
    api.tiers = ['free', 'free', 'pro'];
    flow.maxPolls = 10;
    expect(await flow.awaitUpgrade()).toBeTrue();
    expect(api.calls).toBe(3);
    expect(TestBed.inject(UserStore).user()?.tier).toBe('pro');
  });

  it('resolves false after maxPolls without pro', async () => {
    api.tiers = ['free'];
    flow.maxPolls = 3;
    expect(await flow.awaitUpgrade()).toBeFalse();
    expect(api.calls).toBe(3);
  });
});

describe('loadFreemiusScript', () => {
  beforeEach(() => {
    resetFreemiusScriptCache();
    freemiusScriptEl()?.remove();
  });

  afterEach(() => {
    resetFreemiusScriptCache();
    freemiusScriptEl()?.remove();
    delete (window as unknown as { FS?: unknown }).FS;
  });

  it('leaves exactly one script element after a timeout, and a retry reuses it', fakeAsync(() => {
    const first = loadFreemiusScript();
    first.catch(() => {});
    tick(10_000); // past the load timeout: the first call rejects, the element stays

    expect(document.head.querySelectorAll(FREEMIUS_SCRIPT_SELECTOR).length).toBe(1);

    const second = loadFreemiusScript();
    second.catch(() => {});
    tick(10_000); // the retry also times out, but must not append a second element

    expect(document.head.querySelectorAll(FREEMIUS_SCRIPT_SELECTOR).length).toBe(1);
  }));

  it('resolves at once, and appends no element, when window.FS already exists', fakeAsync(() => {
    (window as unknown as { FS?: unknown }).FS = {};
    let resolved = false;
    loadFreemiusScript().then(() => { resolved = true; });
    tick();
    expect(resolved).toBeTrue();
    expect(freemiusScriptEl()).toBeNull();
  }));
});
