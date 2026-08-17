import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { PlanDto, SiteDto } from '../../core/api/types';
import { FREEMIUS_PORTAL_URL, PRO_PRICE_LABEL } from '../../core/config';
import { numberWord } from '../../shared/copy';
import { ImpactBadge } from '../../shared/impact-badge';
import { PlanCards } from './plan-cards';
import { UpgradeFlow } from './upgrade-flow';

type Phase = 'idle' | 'opening' | 'unlocking' | 'timeout';

@Component({
  selector: 'app-pricing',
  imports: [RouterLink, PlanCards, ImpactBadge],
  template: `
    <div class="page surface pricing">
      @if (gate(); as g) {
        <a class="back muted" [routerLink]="['/sites', g.site.id]">← Back to my result</a>
        <div class="intro stack">
          <span class="eyebrow">YOUR PLAN IS READY</span>
          <h1>{{ capWord(g.plan.tasks.length) }} things to fix, written for your site.</h1>
          <p class="lead">Your score and your findings stay free, always. The step-by-step plan, the check that confirms each fix worked, and your score history are part of Pro.</p>
        </div>
      } @else {
        <div class="intro stack">
          <span class="eyebrow">PRICING</span>
          <h1>Your score is free. The plan is {{ price }} a month.</h1>
        </div>
      }

      <app-plan-cards
        [taskCount]="gate()?.plan?.tasks?.length ?? null"
        [context]="gate() ? 'gate' : 'public'"
        [isPro]="store.user()?.tier === 'pro'"
        [busy]="phase() !== 'idle'"
        [portalUrl]="portalUrl"
        [freeButton]="gate() ? 'Stay on Free' : 'Check my site free'"
        (unlock)="unlock()"
        (stayFree)="stayFree()" />

      @if (note(); as n) {<p class="error-note" role="status">{{ n }}</p>}
      @if (phase() === 'unlocking') {<p class="muted" role="status">Unlocking your plan…</p>}
      @if (phase() === 'timeout') {
        <div class="note-box stack" role="status">
          <span>Your payment went through. Your plan unlocks in a minute. Refresh this page.</span>
          <button type="button" class="btn btn-outline" (click)="refreshOnce()">Refresh</button>
        </div>
      }

      @if (gate(); as g) {
        <section class="waiting stack divider">
          <span class="eyebrow">WHAT IS WAITING FOR YOU</span>
          <div class="card-soft list">
            @for (task of g.plan.tasks.slice(0, 3); track task.taskId; let i = $index) {
              <div class="row item">
                <span class="mono faint idx">0{{ i + 1 }}</span>
                <div class="stack tight">
                  <span class="title">{{ task.title }}</span>
                  <span class="faint small">{{ task.stepCount }} steps · {{ task.effortMinutes }} minutes{{ i === 0 ? ' · biggest single win' : '' }}</span>
                </div>
                <span class="spacer"></span>
                <app-impact-badge [impact]="task.impact" />
                <span class="mono faint small">LOCKED</span>
              </div>
            }
            @if (g.plan.tasks.length > 3) {
              <div class="row item faint"><span class="mono idx">04</span><span>and {{ word(g.plan.tasks.length - 3) }} more</span><span class="spacer"></span><span class="mono small">LOCKED</span></div>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .pricing { display: flex; flex-direction: column; align-items: center; gap: 40px; padding-top: 56px; padding-bottom: 64px; }
    .back { align-self: flex-start; font-size: 14px; }
    .intro { align-items: center; text-align: center; max-width: 54ch; }
    .intro h1 { font-size: 36px; letter-spacing: -0.03em; }
    .lead { font-size: 17px; line-height: 1.6; color: var(--body-long); }
    .waiting { width: 100%; max-width: 860px; padding-top: 26px; }
    .list { display: flex; flex-direction: column; }
    .item { padding: 16px 20px; border-bottom: 1px solid var(--line); }
    .item:last-child { border-bottom: none; }
    .idx { width: 18px; font-size: 12px; color: var(--faint-3); }
    .tight { gap: 4px; }
    .title { font-size: 15px; font-weight: 600; color: var(--ink); }
    .small { font-size: 12px; }
  `,
})
export class Pricing implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private flow = inject(UpgradeFlow);
  protected readonly store = inject(UserStore);

  protected readonly price = PRO_PRICE_LABEL;
  protected readonly portalUrl = FREEMIUS_PORTAL_URL;
  protected readonly word = numberWord;
  protected readonly gate = signal<{ site: SiteDto; plan: PlanDto } | null>(null);
  protected readonly phase = signal<Phase>('idle');
  protected readonly note = signal<string | null>(null);
  private siteId: string | null = null;
  // The Freemius success callback can fire minutes later, after the visitor left the page.
  // Guard every post-payment step so a stale callback cannot navigate a destroyed component.
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; });
  }

  ngOnInit(): void { void this.init(); }

  private async init(): Promise<void> {
    this.siteId = this.route.snapshot.queryParamMap.get('site');
    const user = this.store.user();
    if (!user || user.tier === 'pro') return;
    try {
      const sites = await this.api.listSites();
      const site = (this.siteId ? sites.find((s) => s.id === this.siteId) : sites.find((s) => s.latestReadyAssessmentId)) ?? null;
      if (!site || !site.latestReadyAssessmentId) return;
      const plan = await this.api.getPlanForSite(site.id);
      if (plan.locked) this.gate.set({ site, plan });
    } catch {
      // No gate: the public cards still show.
    }
  }

  protected capWord(n: number): string { const w = numberWord(n); return w.charAt(0).toUpperCase() + w.slice(1); }

  protected stayFree(): void {
    const g = this.gate();
    void this.router.navigateByUrl(g ? `/sites/${g.site.id}` : this.store.user() ? '/dashboard' : '/');
  }

  protected async unlock(): Promise<void> {
    const user = this.store.user();
    if (!user) { void this.router.navigateByUrl('/signup'); return; }
    if (this.phase() !== 'idle') return;
    this.note.set(null);
    this.phase.set('opening');
    try {
      await this.flow.openCheckout(user.email, () => void this.afterPayment());
      // The overlay is open. Return to idle so a closed overlay leaves the button usable.
      if (this.phase() === 'opening') this.phase.set('idle');
    } catch (e) {
      this.phase.set('idle');
      this.note.set(e instanceof Error && e.message === 'not_connected' ? 'Checkout is not connected yet.' : 'Checkout did not open. Please try again.');
    }
  }

  private async afterPayment(): Promise<void> {
    if (this.destroyed) return;
    this.phase.set('unlocking');
    const ok = await this.flow.awaitUpgrade();
    if (this.destroyed) return;
    if (!ok) { this.phase.set('timeout'); return; }
    this.goToSite();
  }

  protected async refreshOnce(): Promise<void> {
    if (this.destroyed) return;
    try {
      const me = await this.api.me();
      if (me.tier === 'pro') { this.store.user.set(me); this.goToSite(); }
    } catch {
      // Stay on the timeout copy.
    }
  }

  private goToSite(): void {
    if (this.destroyed) return;
    const target = this.gate()?.site.id ?? this.siteId;
    void this.router.navigateByUrl(target ? `/sites/${target}` : '/dashboard');
  }
}
