import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssessmentDto, Finding, PlanDto, Tier } from '../../core/api/types';
import { PRO_PRICE_LABEL } from '../../core/config';
import { areaCode, areaName, bandFor, effortText, formatDate, numberWord, pagesCaption, severityOrder } from '../../shared/copy';
import { ScoreBar } from '../../shared/score-bar';
import { SeverityBadge } from '../../shared/severity-badge';
import { LockedPlanList } from './locked-plan-list';

export function sortedFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
}
export function distinctAreas(findings: Finding[]): number {
  return new Set(findings.map((f) => f.category)).size;
}
export function openMinutes(plan: PlanDto): number {
  return plan.tasks.filter((t) => t.status === 'todo').reduce((sum, t) => sum + t.effortMinutes, 0);
}

const AREAS: Array<{ key: 'seo' | 'aeo' | 'geo' }> = [{ key: 'seo' }, { key: 'aeo' }, { key: 'geo' }];

@Component({
  selector: 'app-result-view',
  imports: [RouterLink, ScoreBar, SeverityBadge, LockedPlanList],
  template: `
    <section class="two-col top">
      <div class="stack overall">
        <span class="mono faint small">CHECKED {{ checked() }}</span>
        <div class="row big">
          <span class="number">{{ scores().overall }}</span>
          <div class="stack tight">
            <span class="band" [class]="'band tone-' + band().tone">{{ band().label }}</span>
            <span class="muted">Visibility out of 100</span>
          </div>
        </div>
        <app-score-bar [value]="scores().overall" />
        @if (assessment().summary; as s) {<p class="summary">{{ s }}</p>}
      </div>
      <div class="areas">
        @for (a of areas; track a.key) {
          <div class="row area">
            <div class="stack tight name"><span class="area-name">{{ areaName(a.key) }}</span><span class="mono faint small">{{ areaCode(a.key) }}</span></div>
            <app-score-bar [value]="scores()[a.key]" [width]="130" />
            <span class="area-score">{{ scores()[a.key] }}</span>
            @if (assessment().scoreNotes; as n) {<p class="muted note">{{ n[a.key] }}</p>}
          </div>
        }
      </div>
    </section>

    <section class="stack findings">
      <div class="row baseline"><h2>What we found</h2><span class="muted">{{ findings().length }} things, across {{ areaCount() }} areas</span></div>
      @if (findings().length === 0) {
        <p class="muted">{{ tier() === 'pro' ? 'We found nothing to fix. Check again after your next change.' : 'We found nothing to fix.' }}</p>
      } @else {
        <div class="divider">
          @for (f of findings(); track f.id) {
            <div class="row finding" [class.good]="f.severity === 'good'">
              <app-severity-badge [severity]="f.severity" />
              <div class="stack tight">
                <p class="evidence">{{ f.evidence }}</p>
                <span class="mono muted small">{{ areaName(f.category).toUpperCase() }} · {{ pages(f) }}</span>
              </div>
            </div>
          }
        </div>
      }
    </section>

    @if (plan(); as p) {
      @if (tier() !== 'pro') {
        <section class="card teaser two-col">
          <div class="stack">
            <span class="eyebrow">NEXT</span>
            <h2 class="teaser-h">We wrote you {{ word(p.tasks.length) }} things to fix, in order.</h2>
            <p class="lead">Each one is a short set of steps you can follow yourself, with a way to check it worked. {{ effortSentence(p) }} The first one alone should move your score the most.</p>
            <div class="row"><a class="btn btn-primary" [routerLink]="['/pricing']" [queryParams]="{ site: siteId() }">Read my plan</a><span class="muted">Included with Pro, from {{ price }} a month</span></div>
          </div>
          <app-locked-plan-list [plan]="p" />
        </section>
      } @else {
        <div class="row pro-links">
          <a [routerLink]="['/sites', siteId()]">Do this next →</a>
          <a [routerLink]="['/assessments', assessment().id, 'plan']">See all {{ p.tasks.length }} tasks</a>
        </div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 46px; }
    .overall { width: 400px; flex-shrink: 0; gap: 16px; }
    .big { align-items: flex-end; gap: 16px; }
    .number { font-size: 92px; font-weight: 700; color: var(--ink); letter-spacing: -0.045em; line-height: 0.85; }
    .band { font-size: 20px; font-weight: 600; }
    .summary { font-size: 17px; line-height: 1.6; color: var(--body); }
    .areas { flex: 1; border-top: 1px solid var(--line); }
    .area { gap: 22px; padding: 19px 0; border-bottom: 1px solid var(--line); }
    .name { width: 150px; } .area-name { font-size: 16px; font-weight: 600; color: var(--ink); }
    .area-score { font-size: 24px; font-weight: 700; color: var(--ink); width: 40px; }
    .note { flex: 1; font-size: 14px; }
    .baseline { align-items: baseline; }
    h2 { font-size: 22px; }
    .finding { gap: 22px; padding: 20px 0; border-bottom: 1px solid var(--line); align-items: flex-start; }
    .evidence { font-size: 17px; line-height: 1.55; color: var(--ink); }
    .good .evidence { color: var(--muted); }
    .teaser { padding: 36px 40px; align-items: center; }
    .teaser-h { font-size: 27px; max-width: 26ch; }
    .lead { font-size: 16px; line-height: 1.6; color: var(--body-long); max-width: 46ch; }
    .tight { gap: 4px; } .small { font-size: 12px; }
    .pro-links { gap: 24px; }
    @media (max-width: 760px) { .overall { width: 100%; } .number { font-size: 64px; } .area { flex-wrap: wrap; } }
  `,
})
export class ResultView {
  assessment = input.required<AssessmentDto>();
  plan = input<PlanDto | null>(null);
  tier = input<Tier>('free');
  siteId = input.required<string>();

  protected readonly areas = AREAS;
  protected readonly price = PRO_PRICE_LABEL;
  protected readonly areaName = areaName;
  protected readonly areaCode = areaCode;
  protected readonly word = numberWord;
  protected readonly scores = computed(() => this.assessment().scores ?? { seo: 0, aeo: 0, geo: 0, overall: 0 });
  protected readonly band = computed(() => bandFor(this.scores().overall));
  protected readonly checked = computed(() => formatDate(this.assessment().completedAt ?? this.assessment().createdAt).toUpperCase());
  protected readonly findings = computed(() => sortedFindings(this.assessment().findings));
  protected readonly areaCount = computed(() => distinctAreas(this.assessment().findings));

  protected pages(f: Finding): string { return pagesCaption(f.affectedPages.length, this.assessment().pageCount); }
  protected effortSentence(p: PlanDto): string {
    const e = effortText(openMinutes(p));
    return `${e.charAt(0).toUpperCase()}${e.slice(1)} of work in total.`;
  }
}
