import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FREE_TIER_COPY, PRO_PRICE_LABEL, PRO_TIER_COPY } from '../../core/config';
import { capitalize, numberWord } from '../../shared/copy';

@Component({
  selector: 'app-plan-cards',
  imports: [RouterLink],
  template: `
    <div class="cards">
      <section class="plan-card card-soft">
        <div class="stack head">
          <div class="row"><strong class="name">Free</strong>@if (context() === 'gate') {<span class="badge badge-low">YOUR PLAN NOW</span>}</div>
          <span class="price">$0</span>
        </div>
        <ul class="features">
          <li class="ok">{{ freeSites }}, {{ freeChecks }} each month</li>
          <li class="ok">Your visibility score and the three sub-scores</li>
          <li class="ok">Every problem we found, in plain language</li>
          <li class="no">No step-by-step plan</li>
          <li class="no">No way to confirm a fix worked</li>
        </ul>
        <span class="spacer"></span>
        <button type="button" class="btn" [class.btn-primary]="freeIsPrimary()" [class.btn-outline]="!freeIsPrimary()" (click)="stayFree.emit()">{{ freeButton() }}</button>
      </section>

      <section class="plan-card pro">
        <div class="stack head">
          <div class="row"><strong class="name">Pro</strong><span class="badge badge-high">{{ context() === 'gate' ? 'UNLOCKS YOUR PLAN' : 'THE PLAN' }}</span></div>
          <span class="price">{{ price }} <span class="per">a month</span></span>
        </div>
        <ul class="features pro-features">
          <li class="ok">@if (taskCount(); as n) {<strong>{{ taskLine(n) }}</strong>, in the order that helps most first} @else {<strong>Every task with its steps</strong>, in the order that helps most first}</li>
          <li class="ok">A way to check each fix actually worked</li>
          <li class="ok">We re-check your site and confirm your fixes for you</li>
          <li class="ok">{{ proSites }} sites, {{ proChecks }} checks each month</li>
          <li class="ok">Score history, so you can see it working</li>
        </ul>
        <span class="spacer"></span>
        @if (isPro()) {
          <a class="btn btn-outline" routerLink="/account">Manage subscription</a>
          <span class="faint small center">You are on Pro.</span>
        } @else {
          <button type="button" class="btn" [class.btn-primary]="!freeIsPrimary()" [class.btn-outline]="freeIsPrimary()" (click)="unlock.emit()" [disabled]="busy()">{{ proButton() }}</button>
          <span class="faint small center">{{ proNote() }}</span>
        }
      </section>
    </div>
  `,
  styles: `
    .cards { display: flex; gap: 20px; align-items: stretch; width: 100%; max-width: 860px; }
    .plan-card { flex: 1; padding: 30px 30px 34px; display: flex; flex-direction: column; gap: 22px; border-radius: var(--r-card); }
    .plan-card.pro { flex: 1.15; background: var(--card); border: 2px solid var(--accent); }
    .name { font-size: 17px; color: var(--ink); }
    .price { font-size: 34px; font-weight: 700; color: var(--ink); letter-spacing: -0.03em; }
    .per { font-size: 15px; font-weight: 400; color: var(--muted); }
    .features { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .features li { padding-left: 24px; position: relative; font-size: 15px; line-height: 1.5; color: var(--body); }
    .features li::before { position: absolute; left: 0; }
    .features li.ok::before { content: '✓'; color: var(--olive); }
    .pro-features li.ok::before { color: var(--accent); }
    .pro-features li { color: var(--ink); }
    .features li.no { color: var(--faint); } .features li.no::before { content: '—'; color: var(--faint-3); }
    .small { font-size: 13px; } .center { text-align: center; }
    @media (max-width: 760px) { .cards { flex-direction: column; } }
  `,
})
export class PlanCards {
  taskCount = input<number | null>(null);
  context = input<'gate' | 'public'>('public');
  isPro = input(false);
  /** False for a visitor with no account. That visitor has no plan to unlock yet. */
  signedIn = input(false);
  busy = input(false);
  /** True while the signed-in account opens the Freemius sandbox instead of a live sale. */
  sandboxNote = input(false);
  freeButton = input('Stay on Free');
  unlock = output<void>();
  stayFree = output<void>();

  /**
   * A visitor with no account cannot unlock a plan, because nobody has written
   * one for them. The free check is their real first step, so the free card
   * takes the primary button and the Pro card steps back to the outline.
   */
  protected readonly freeIsPrimary = computed(() => this.context() === 'public' && !this.isPro() && !this.signedIn());
  protected readonly proButton = computed(() => (this.freeIsPrimary() ? 'Start free, then unlock' : 'Unlock my plan'));
  protected readonly proNote = computed(() => {
    if (this.sandboxNote()) return 'Sandbox checkout. No card is charged.';
    if (this.context() === 'gate') return 'Your plan is already written and waiting.';
    if (this.freeIsPrimary()) return 'You see your score and every finding before you pay.';
    return 'Cancel any time. Your score stays free.';
  });

  protected readonly price = PRO_PRICE_LABEL;
  protected readonly freeSites = FREE_TIER_COPY.sites === 1 ? 'One site' : `${capitalize(numberWord(FREE_TIER_COPY.sites))} sites`;
  protected readonly freeChecks = FREE_TIER_COPY.checks === 1 ? 'one check' : `${numberWord(FREE_TIER_COPY.checks)} checks`;
  protected readonly proSites = capitalize(numberWord(PRO_TIER_COPY.sites));
  protected readonly proChecks = numberWord(PRO_TIER_COPY.checks);
  protected readonly word = numberWord;

  /** The Pro card's task line. It shows a special sentence when there is one task. */
  protected taskLine(n: number): string {
    return n === 1 ? 'Your one task with its steps' : `All ${this.word(n)} tasks with their steps`;
  }
}
