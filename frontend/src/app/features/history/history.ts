import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, Scores } from '../../core/api/types';
import { SiteContext } from '../../core/site-context';
import { ErrorNote } from '../../shared/error-note';
import { assessmentErrorCopy } from '../../shared/assessment-error-copy';
import { changesText, chartPoints, headlineFor } from './history-copy';
import { formatDate, monthName } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { isUpgradeRequired, pricingUrlFor } from '../../shared/upgrade-redirect';

const SERIES: { key: 'seo' | 'aeo' | 'geo'; label: string; color: string }[] = [
  { key: 'seo', label: 'Google search', color: 'var(--olive)' },
  { key: 'aeo', label: 'Answer boxes', color: 'var(--accent)' },
  { key: 'geo', label: 'AI assistants', color: 'var(--amber)' },
];
const W = 1000, H = 240;
// The viewBox is wider and taller than the plot so the end labels and month labels have room.
const VB_W = 1060, VB_H = 260;

@Component({
  selector: 'app-history',
  imports: [ErrorNote],
  template: `
    <div class="page surface history">
      @if (listError(); as e) {
        <app-error-note [error]="e" />
      } @else if (loading()) {
        <p class="muted">Loading…</p>
      } @else {
        <div class="row head">
          <div class="stack"><h1>{{ headline().title }}</h1><p class="lead">{{ headline().text }}</p></div>
          <span class="spacer"></span>
          <button type="button" class="btn btn-primary" (click)="checkAgain()" [disabled]="busy()">Check again</button>
        </div>
        @if (checkError(); as ce) {
          @if (ce.code === 'email_not_verified') {
            <div class="note-box stack" role="alert"><p>{{ assessmentErrorCopy(ce) }}</p><button type="button" class="btn btn-outline" (click)="resend()" [disabled]="resendBusy()">Send the email again</button>@if (resent()) {<p>Sent. Check your inbox.</p>}</div>
          } @else {<p class="error-note" role="alert">{{ assessmentErrorCopy(ce) }}</p>}
        }

        <section class="card chart stack">
          <div class="row legend">
            @for (s of series; track s.key) {<span class="row small"><span class="swatch" [style.background]="s.color"></span>{{ s.label }}</span>}
            <span class="spacer"></span><span class="mono faint small">{{ range() }}</span>
          </div>
          @if (hasTrend()) {
            <svg [attr.viewBox]="'0 0 ' + VB_W + ' ' + VB_H" role="img" [attr.aria-label]="chartLabel()">
              @for (g of [0, 25, 50, 75]; track g) {<line x1="0" [attr.y1]="H - g * H / 100" [attr.x2]="W" [attr.y2]="H - g * H / 100" stroke="var(--line)" stroke-width="1" />}
              @for (s of series; track s.key) {<polyline [attr.points]="points()[s.key]" fill="none" [attr.stroke]="s.color" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />}
              @for (el of endLabels(); track el.key) {<text [attr.x]="el.x" [attr.y]="el.y" font-size="14" font-weight="700" fill="var(--ink)">{{ el.value }}</text>}
              @for (xl of xLabels(); track xl.x) {<text [attr.x]="xl.x" y="256" text-anchor="middle" font-size="11" fill="var(--faint-2)">{{ xl.text }}</text>}
            </svg>
          } @else {<p class="muted">Run more checks to see your progress line.</p>}
        </section>

        <div class="table-scroll">
          <table class="data">
            <thead><tr><th>DATE</th><th class="num">OVERALL</th><th class="num">GOOGLE</th><th class="num">ANSWERS</th><th class="num">AI</th><th>WHAT CHANGED</th></tr></thead>
            <tbody>
              @for (a of assessments(); track a.id; let i = $index) {
                <tr [class.failed]="!a.scores">
                  <td>{{ dateLabel(a) }}</td>
                  @if (a.scores; as s) {<td class="num strong">{{ s.overall }}</td><td class="num">{{ s.seo }}</td><td class="num">{{ s.aeo }}</td><td class="num">{{ s.geo }}</td>}
                  @else {<td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>}
                  <td class="muted">{{ changeText(a) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: `
    .history { padding-top: 48px; display: flex; flex-direction: column; gap: 40px; }
    .head { align-items: flex-end; }
    h1 { font-size: 32px; }
    .lead { font-size: 17px; max-width: 46ch; color: var(--body-long); }
    .chart { padding: 30px 34px 26px; }
    .legend { gap: 26px; }
    .swatch { width: 18px; height: 3px; border-radius: 999px; display: inline-block; margin-right: 8px; }
    svg { width: 100%; height: auto; display: block; }
    td.strong { font-weight: 700; color: var(--ink); }
    tr.failed td { color: var(--faint); }
    .small { font-size: 14px; }
  `,
})
export class History implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private siteContext = inject(SiteContext);
  private destroyRef = inject(DestroyRef);

  protected readonly W = W;
  protected readonly H = H;
  protected readonly VB_W = VB_W;
  protected readonly VB_H = VB_H;
  protected readonly series = SERIES;
  protected readonly assessmentErrorCopy = assessmentErrorCopy;

  protected readonly siteId = this.route.snapshot.paramMap.get('siteId')!;

  protected readonly assessments = signal<AssessmentDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly listError = signal<ApiError | null>(null);

  protected readonly busy = signal(false);
  protected readonly checkError = signal<ApiError | null>(null);
  protected readonly resent = signal(false);
  protected readonly resendBusy = signal(false);

  private readonly readyAssessments = computed(() => [...this.assessments()].filter((a) => a.status === 'ready' && a.scores != null).reverse());

  protected readonly hasTrend = computed(() => this.readyAssessments().length >= 2);
  protected readonly headline = computed(() => headlineFor(this.readyAssessments()));
  protected readonly points = computed(() => ({ seo: chartPoints(this.readyAssessments(), 'seo', W, H), aeo: chartPoints(this.readyAssessments(), 'aeo', W, H), geo: chartPoints(this.readyAssessments(), 'geo', W, H) }));
  protected readonly range = computed(() => {
    const r = this.readyAssessments();
    if (r.length === 0) return '';
    const m = (a: AssessmentDto) => monthName(a.completedAt ?? a.createdAt).slice(0, 3).toUpperCase();
    const last = r[r.length - 1];
    return `${m(r[0])} – ${m(last)} ${new Date(last.completedAt ?? last.createdAt).getUTCFullYear()}`;
  });
  protected readonly chartLabel = computed(() => {
    const r = this.readyAssessments();
    const l = r[r.length - 1]?.scores;
    return l ? `Score trend. Latest: Google search ${l.seo}, Answer boxes ${l.aeo}, AI assistants ${l.geo}.` : 'Score trend';
  });
  /** One end-of-line label per series, placed just past the last plotted point. */
  protected readonly endLabels = computed((): { key: string; x: number; y: number; value: number }[] => {
    const r = this.readyAssessments();
    if (r.length < 2) return [];
    const last = r[r.length - 1].scores as Scores;
    return this.series.map((s) => ({ key: s.key, x: W + 12, y: H - last[s.key] * (H / 100) + 4, value: last[s.key] }));
  });
  /** One month label per ready assessment, along the bottom of the chart.
   *  A label repeats its neighbour's month, so the later one also shows the day. */
  protected readonly xLabels = computed((): { x: number; text: string }[] => {
    const r = this.readyAssessments();
    const n = r.length;
    if (n < 2) return [];
    return r.map((a, i) => {
      const iso = a.completedAt ?? a.createdAt;
      const mon = monthName(iso).slice(0, 3).toUpperCase();
      const prevMon = i > 0 ? monthName(r[i - 1].completedAt ?? r[i - 1].createdAt).slice(0, 3).toUpperCase() : null;
      const d = new Date(iso).getUTCDate();
      const text = mon === prevMon ? `${mon} ${d}` : mon;
      return { x: (W / (n - 1)) * i, text };
    });
  });

  /** Set once on destroy. Every async continuation checks it first.
   *  SiteContext is a root singleton and the header reads it.
   *  A late write would show a stale domain on another page. */
  private destroyed = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.cleanup());
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    this.loading.set(true);
    this.listError.set(null);
    try {
      const list = await this.api.listAssessments(this.siteId);
      if (this.destroyed) return;
      this.assessments.set(list);
    } catch (e) {
      if (this.destroyed) return;
      if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
      this.listError.set(toApiError(e));
      return;
    } finally {
      if (this.destroyed) return;
      this.loading.set(false);
    }
    try {
      const sites = await this.api.listSites();
      if (this.destroyed) return;
      this.siteContext.set(sites.find((s) => s.id === this.siteId)?.domain ?? null);
    } catch { /* the header just shows no domain */ }
  }

  protected dateLabel(a: AssessmentDto): string {
    return formatDate(a.completedAt ?? a.createdAt);
  }

  protected changeText(a: AssessmentDto): string {
    const firstReadyId = this.readyAssessments()[0]?.id;
    return changesText(a, a.id === firstReadyId);
  }

  protected checkAgain(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.checkError.set(null);
    this.resent.set(false);
    this.api
      .submitAssessment(this.siteId)
      .then(
        async (assessment) => {
          if (this.destroyed) return;
          try {
            await this.router.navigateByUrl(`/assessments/${assessment.id}/progress`);
          } catch {
            if (this.destroyed) return;
            this.checkError.set(
              new ApiError('navigation_failed', 'The check started, but we could not open the progress page. Please try again.', 0),
            );
          }
        },
        (e: unknown) => {
          if (this.destroyed) return;
          if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
          this.checkError.set(toApiError(e));
        },
      )
      .finally(() => {
        if (this.destroyed) return;
        this.busy.set(false);
      });
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.api
      .resendVerification()
      .then(
        () => {
          if (this.destroyed) return;
          this.resent.set(true);
        },
        (e: unknown) => {
          if (this.destroyed) return;
          this.checkError.set(toApiError(e));
        },
      )
      .finally(() => {
        if (this.destroyed) return;
        this.resendBusy.set(false);
      });
  }

  private cleanup(): void {
    this.destroyed = true;
    this.siteContext.clear();
  }
}
