import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Pricing } from './pricing';
import { UpgradeFlow } from './upgrade-flow';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PlanDto, SiteDto, UserDto } from '../../core/api/types';
import { FREEMIUS_PORTAL_URL } from '../../core/config';

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
  failMessage = 'not_connected';
  upgraded = true;
  // When true, openCheckout stores the success callback instead of invoking it, so a test can
  // fire it later, after the component under test may already be destroyed.
  captureSuccess = false;
  capturedOnSuccess: (() => void) | null = null;
  async openCheckout(email: string, onSuccess: () => void): Promise<void> {
    this.openCheckoutCalls.push(email);
    if (!this.succeed) throw new Error(this.failMessage);
    if (this.captureSuccess) { this.capturedOnSuccess = onSuccess; return; }
    onSuccess();
  }
  async awaitUpgrade(): Promise<boolean> { return this.upgraded; }
}

const freeUser: UserDto = { id: 'u1', email: 'dana@rivertonbakery.com', emailVerified: true, tier: 'free' };

async function setup(query: Record<string, string>, user: UserDto | null, sites: SiteDto[] = [site()]) {
  const api = new FakeApiClient();
  api.sites = sites;
  const flow = new FakeUpgradeFlow();
  await TestBed.configureTestingModule({
    imports: [Pricing],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: UpgradeFlow, useValue: flow },
      // provideRouter() supplies its own ActivatedRoute. It must come before the override
      // below, so the override is the last provider for that token and wins.
      provideRouter([{ path: 'sites/:siteId', component: BlankPage }, { path: 'signup', component: BlankPage }, { path: 'dashboard', component: BlankPage }]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
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
    // Two sites, S0 first with no ready check: proves the gate reads the live ?site= query
    // param instead of always falling through to the first listed site.
    const sites = [site({ id: 'S0', latestReadyAssessmentId: null, latestAssessment: null }), site({ id: 'S1' })];
    const { el } = await setup({ site: 'S1' }, freeUser, sites);
    const text = el.textContent ?? '';
    expect(text).toContain('YOUR PLAN IS READY');
    expect(text).toContain('Eight things to fix, written for your site.');
    expect(text).toContain('WHAT IS WAITING FOR YOU');
    expect(text).toContain('Put your address and hours where machines can read them');
    expect(text).toContain('4 steps · 20 minutes · biggest single win');
    expect(text).toContain('and five more');
    expect(text).toContain('Back to my result');
    const backLink = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Back to my result')) as HTMLAnchorElement;
    expect(backLink.getAttribute('href')).toBe('/sites/S1');
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

  it('does not navigate when the success callback fires after the component was destroyed', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    flow.captureSuccess = true;
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const onSuccess = flow.capturedOnSuccess!;
    fixture.destroy();
    onSuccess();
    await new Promise((r) => setTimeout(r, 0));
    expect(TestBed.inject(Location).path()).not.toBe('/sites/S1');
  });

  it('shows the generic checkout-failed note and re-enables the button on an unrecognised error', async () => {
    const { el, flow, fixture } = await setup({ site: 'S1' }, freeUser);
    flow.succeed = false;
    flow.failMessage = 'boom';
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Checkout did not open. Please try again.');
    expect(button(el, 'Unlock my plan').disabled).toBeFalse();
  });

  it('shows the manage-subscription link for a Pro user and hides Unlock my plan', async () => {
    const proUser: UserDto = { id: 'u2', email: 'pro@rivertonbakery.com', emailVerified: true, tier: 'pro' };
    const { el } = await setup({}, proUser);
    const link = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Manage subscription')) as HTMLAnchorElement | undefined;
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe(FREEMIUS_PORTAL_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener');
    expect(el.textContent).toContain('You are on Pro.');
    expect(el.textContent).not.toContain('Unlock my plan');
  });

  it('sends a signed-out visitor to signup instead of opening checkout', async () => {
    const { el, flow, fixture } = await setup({}, null);
    button(el, 'Unlock my plan').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(Location).path()).toBe('/signup');
    expect(flow.openCheckoutCalls).toEqual([]);
  });
});
