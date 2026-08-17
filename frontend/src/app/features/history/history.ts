import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto } from '../../core/api/types';
import { ErrorNote } from '../../shared/error-note';
import { assessmentErrorCopy } from '../../shared/assessment-error-copy';
import { toApiError } from '../../shared/to-api-error';

type PlottedSeries = 'seo' | 'aeo' | 'geo';

const SERIES: { key: PlottedSeries; label: string; color: string }[] = [
  { key: 'seo', label: 'SEO', color: '#2563eb' },
  { key: 'aeo', label: 'AEO', color: '#7c3aed' },
  { key: 'geo', label: 'GEO', color: '#0d9488' },
];

function pointsFor(ready: AssessmentDto[], key: PlottedSeries): string {
  const n = ready.length;
  if (n < 2) return '';
  return ready
    .map((a, i) => {
      const x = (400 / (n - 1)) * i;
      const y = 150 - a.scores![key] * 1.4;
      return `${x},${y}`;
    })
    .join(' ');
}

@Component({
  selector: 'app-history',
  imports: [RouterLink, ErrorNote],
  template: `
    @if (listError(); as e) {
      @if (e.code === 'upgrade_required') {
        <section class="upsell">
          <p>Score history needs the Pro plan.</p>
          <a routerLink="/pricing">Upgrade</a>
        </section>
      } @else {
        <app-error-note [error]="e" />
      }
    } @else if (loading()) {
      <p>Loading…</p>
    } @else {
      <h1>Score history</h1>

      <div class="check-again">
        <button type="button" (click)="checkAgain()" [disabled]="busy()">Check again</button>

        @if (checkError(); as ce) {
          @if (ce.code === 'email_not_verified') {
            <div class="error-note" role="alert">
              <p>{{ assessmentErrorCopy(ce) }}</p>
              <button type="button" (click)="resend()" [disabled]="resendBusy()">Send the email again</button>
              @if (resent()) {
                <p>Sent. Check your inbox.</p>
              }
            </div>
          } @else if (ce.code === 'quota_exceeded' || ce.code === 'upgrade_required') {
            <p class="error-note" role="alert">{{ assessmentErrorCopy(ce) }} <a routerLink="/pricing">Upgrade</a></p>
          } @else if (ce.code === 'site_read_only') {
            <p class="error-note" role="alert">{{ assessmentErrorCopy(ce) }} <a routerLink="/pricing">Upgrade to check it again.</a></p>
          } @else {
            <app-error-note [error]="ce" />
          }
        }
      </div>

      @if (hasTrend()) {
        <svg viewBox="0 0 400 160" width="400" height="160" role="img" aria-label="Score trend over time">
          @for (s of series; track s.key) {
            <polyline [attr.points]="pointsBySeries()[s.key]" fill="none" [attr.stroke]="s.color" stroke-width="2" />
          }
        </svg>
        <ul class="legend">
          @for (s of series; track s.key) {
            <li><span class="swatch" [style.background]="s.color"></span> {{ s.label }}</li>
          }
        </ul>
      } @else {
        <p>Run more checks to see your progress line.</p>
      }

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>SEO</th>
            <th>AEO</th>
            <th>GEO</th>
          </tr>
        </thead>
        <tbody>
          @for (a of assessments(); track a.id) {
            <tr>
              <td>{{ dateLabel(a) }}</td>
              @if (a.scores; as s) {
                <td>{{ s.seo }}</td>
                <td>{{ s.aeo }}</td>
                <td>{{ s.geo }}</td>
              } @else {
                <td colspan="3">Failed</td>
              }
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export class History implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

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

  private readonly readyAssessments = computed(() =>
    [...this.assessments()].filter((a) => a.scores != null).reverse(),
  );

  protected readonly hasTrend = computed(() => this.readyAssessments().length >= 2);

  protected readonly pointsBySeries = computed(() => {
    const ready = this.readyAssessments();
    return {
      seo: pointsFor(ready, 'seo'),
      aeo: pointsFor(ready, 'aeo'),
      geo: pointsFor(ready, 'geo'),
    };
  });

  ngOnInit(): void {
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    this.loading.set(true);
    this.listError.set(null);
    try {
      this.assessments.set(await this.api.listAssessments(this.siteId));
    } catch (e) {
      this.listError.set(toApiError(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected dateLabel(a: AssessmentDto): string {
    return new Date(a.createdAt).toLocaleDateString();
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
          try {
            await this.router.navigateByUrl(`/assessments/${assessment.id}/progress`);
          } catch {
            this.checkError.set(
              new ApiError('navigation_failed', 'The check started, but we could not open the progress page. Please try again.', 0),
            );
          }
        },
        (e: unknown) => this.checkError.set(toApiError(e)),
      )
      .finally(() => this.busy.set(false));
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.api
      .resendVerification()
      .then(
        () => this.resent.set(true),
        (e: unknown) => this.checkError.set(toApiError(e)),
      )
      .finally(() => this.resendBusy.set(false));
  }
}
