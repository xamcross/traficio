import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Pricing } from './pricing';
import { UpgradeFlow } from './upgrade-flow';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PlanDto, SiteDto, UserDto } from '../../core/api/types';

@Component({ selector: 'pricing-spec-blank', template: '' })
class BlankPage {}

function site(overrides: Partial<SiteDto> = {}): SiteDto {
  return {
    id: 'S1', domain: 'rivertonbakery.com', url: 'https://rivertonbakery.com', platform: 'wordpress',
    latestScores: { seo: 62, aeo: 34, geo: 28, overall: 41 }, readOnly: false,
    latestAssessment: { id: 'A1', status: 'ready', createdAt: '2026-07-28T10:00:00Z', completedAt: '2026-07-28T10:03:00Z' },
    latestReadyAssessmentId: 'A1', ...overrides,
  };
}
function lockedPlan(): PlanDto {
  const t = (i: number, title: string, impact: 'high' | 'medium' | 'low', minutes: number, steps: number) => ({
    taskId: `T${i}`, title, category: 'geo', impact, effortMinutes: minutes, stepCount: steps,
    whyItMatters: null, steps: null, doneCheck: null, status: 'todo' as const,
  });
  return {
    id: 'P1', assessmentId: 'A1', siteId: 'S1', locked: true, progress: { done: 0, verified: 0, total: 8 },
    tasks: [
      t(1, 'Put your address and hours where machines can read them', 'high', 20, 4),
      t(2, 'Write the one page that answers what people ask', 'high', 45, 6),
      t(3, 'Add prices to your shop pages', 'medium', 30, 3),
      t(4, 'A', 'low', 5, 1), t(5, 'B', 'low', 5, 1), t(6, 'C', 'low', 5, 1), t(7, 'D', 'low', 5, 1), t(8, 'E', 'low', 5, 1),
    ],
  };
}

class FakeApiClient {
  sites: SiteDto[] = [site()];
  plan: PlanDto = lockedPlan();
  listSites() { return Promise.resolve(this.sites); }
  getPlanForSite(_id: string) { return Promise.resolve(this.plan); }
  me(): Promise<UserDto> { return Promise.reject(new Error('not used')); }
}

class FakeUpgradeFlow {
  openCheckoutCalls: string[] = [];
  succeed = true;
  upgraded = true;
  async openCheckout(email: string, onSuccess: () => void): Promise<void> {
    this.openCheckoutCalls.push(email);
    if (!this.succeed) throw new Error('not_connected');
    onSuccess();
  }
  async awaitUpgrade(): Promise<boolean> { return this.upgraded; }
}

const freeUser: UserDto = { id: 'u1', email: 'dana@rivertonbakery.com', emailVerified: true, tier: 'free' };

async function setup(query: Record<string, string>, user: UserDto | null) {
  const api = new FakeApiClient();
  const flow = new FakeUpgradeFlow();
  await TestBed.configureTestingModule({
    imports: [Pricing],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: UpgradeFlow, useValue: flow },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      provideRouter([{ path: 'sites/:siteId', component: BlankPage }, { path: 'signup', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
    ],
  }).compileComponents();
  const store = TestBed.inject(UserStore);
  store.loaded.set(true);
  store.user.set(user);
  const fixture = TestBed.createComponent(Pricing);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, api, flow, el: fixture.nativeElement as HTMLElement };
}

function button(el: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text))!;
}

describe('Pricing', () => {
  it('shows the plan gate for a signed-in free user with a locked plan', async () => {
    const { el } = await setup({ site: 'S1' }, freeUser);
    const text = el.textContent ?? '';
    expect(text).toContain('YOUR PLAN IS READY');
    expect(text).toContain('Eight things to fix, written for your site.');
    expect(text).toContain('WHAT IS WAITING FOR YOU');
    expect(text).toContain('Put your address and hours where machines can read them');
    expect(text).toContain('4 steps · 20 minutes · biggest single win');
    expect(text).toContain('and five more');
    expect(text).toContain('Back to my result');
  });

  it('shows the public pricing when signed out', async () => {
    const { el } = await setup({}, null);
    const text = el.textContent ?? '';
    expect(text).toContain('Your score is free. The plan is $9 a month.');
    expect(text).not.toContain('WHAT IS WAITING FOR YOU');
    expect(text).toContain('Check my site free');
  });

  it('opens checkout with the email, then polls and navigates to the site home', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(flow.openCheckoutCalls).toEqual(['dana@rivertonbakery.com']);
    expect(TestBed.inject(Location).path()).toBe('/sites/S1');
  });

  it('shows the not-connected note when checkout is not configured', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    flow.succeed = false;
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Checkout is not connected yet.');
  });

  it('shows the timeout copy when the tier does not flip', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    flow.upgraded = false;
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Your payment went through. Your plan unlocks in a minute. Refresh this page.');
  });
});
