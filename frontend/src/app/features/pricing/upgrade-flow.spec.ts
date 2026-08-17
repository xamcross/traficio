import { TestBed } from '@angular/core/testing';
import { UpgradeFlow } from './upgrade-flow';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { UserDto } from '../../core/api/types';

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
