import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, AssessmentStatus } from '../../core/api/types';
import { openAssessmentStream } from '../../core/sse/assessment-stream';
import { UserStore } from '../../core/auth/user-store';
import { ErrorNote } from '../../shared/error-note';
import { toApiError } from '../../shared/to-api-error';

export const STEP_LABELS: Record<'queued' | 'crawling' | 'analyzing' | 'planning', { active: string; done: string }> = {
  queued: { active: 'Finding your site', done: 'Found your site' },
  crawling: { active: 'Reading your pages', done: 'Read your pages' },
  analyzing: { active: 'Checking how findable you are', done: 'Checked how findable you are' },
  planning: { active: 'Writing your plan', done: 'Wrote your plan' },
};

/** Simple 4-step rail; ready/failed are terminal outcomes shown separately, not rail steps. */
const STEPS: Array<keyof typeof STEP_LABELS> = ['queued', 'crawling', 'analyzing', 'planning'];

export const FAILURE_HEADLINES: Record<string, string> = {
  robots_blocked: 'Your site would not let us read it.',
  js_only_site: 'Your site needs JavaScript to show its content.',
  site_unreachable: 'We could not reach your site.',
  invalid_url: 'We could not reach your site.',
  assessment_failed: 'Something went wrong on our side.',
};
export function failureHeadline(code: string | null): string {
  return (code && FAILURE_HEADLINES[code]) || 'We could not finish the check.';
}

const RETRY_DELAY_MS = 2000;
const DONE_BEAT_MS = 1500;
/** After this many consecutive failed refetches, stop retrying and show a terminal error. */
const MAX_REFETCH_FAILURES = 5;

function isTerminal(status: AssessmentStatus): boolean {
  return status === 'ready' || status === 'failed';
}

@Component({
  selector: 'app-progress',
  imports: [RouterLink, ErrorNote],
  template: `
    <div class="page surface progress">
      @if (failed(); as f) {
        <div class="stack failure">
          <span class="eyebrow tone-low">WE COULD NOT FINISH</span>
          <h1 role="alert">{{ headline(f) }}</h1>
          @if (f.errorMessage) {<p class="lead">{{ f.errorMessage }}</p>}
          <div class="note-box stack tight">
            <span class="eyebrow">GOOD NEWS</span>
            <span>{{ isPro() ? 'This check did not count against your monthly checks.' : 'Your free check this month was not used.' }}</span>
          </div>
          <div class="row">
            <button type="button" class="btn btn-primary" (click)="tryAgain(f)" [disabled]="retryBusy()">Try again</button>
            <a class="btn btn-text" [routerLink]="['/sites', f.siteId]">Back to my site</a>
          </div>
          @if (retryError(); as e) {<app-error-note [error]="e" />}
        </div>
      } @else if (retriesExhausted()) {
        <div class="stack">
          <app-error-note [error]="retryError()" />
          <p><a routerLink="/dashboard">Back to my sites</a></p>
        </div>
      } @else {
        <div class="stack">
          <h1>{{ headlineActive() }}</h1>
          <p class="lead muted">You can close this tab. We will email you when your result is ready.</p>
        </div>
        <ol class="rail">
          @for (step of steps; track step) {
            <li [class.done]="isDone(step)" [class.active]="isActive(step)">
              <span class="dot" aria-hidden="true">{{ isDone(step) ? '✓' : '' }}</span>
              <span class="label">{{ isDone(step) ? labels[step].done : labels[step].active }}</span>
            </li>
          }
        </ol>
        <span class="mono faint small">QUEUED → CRAWLING → ANALYZING → PLANNING</span>
      }
    </div>
  `,
  styles: `
    .progress { max-width: 620px; padding-top: 56px; display: flex; flex-direction: column; gap: 38px; }
    h1 { font-size: 29px; letter-spacing: -0.025em; }
    .lead { font-size: 16px; line-height: 1.6; max-width: 44ch; }
    .rail { list-style: none; margin: 0; padding: 0; }
    .rail li { display: flex; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); color: var(--faint-2); }
    .rail li:last-child { border-bottom: none; }
    .rail li.active { color: var(--ink); font-weight: 600; }
    .rail li.done { color: var(--ink); }
    .dot { width: 22px; height: 22px; border-radius: 999px; border: 2px solid #e6d6be; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
    .active .dot { border-color: var(--accent); }
    .done .dot { background: var(--accent); border-color: var(--accent); color: #fff; }
    .tight { gap: 6px; }
    .small { font-size: 13px; }
  `,
})
export class Progress implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private userStore = inject(UserStore);

  private readonly id = this.route.snapshot.paramMap.get('id')!;

  protected readonly steps = STEPS;
  protected readonly labels = STEP_LABELS;
  protected readonly status = signal<AssessmentStatus | null>(null);
  protected readonly failed = signal<AssessmentDto | null>(null);
  protected readonly retriesExhausted = signal(false);
  protected readonly retryError = signal<ApiError | null>(null);
  protected readonly retryBusy = signal(false);
  protected readonly isPro = computed(() => this.userStore.user()?.tier === 'pro');
  protected readonly headlineActive = computed(() => {
    const s = this.status();
    if (!s || s === 'ready' || s === 'failed') return 'Loading…';
    return `${STEP_LABELS[s].active}…`;
  });

  private closeStream: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private doneTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive refetch failures since the last success; reset on any successful fetch. */
  private refetchFailures = 0;
  /** True after cleanup() runs, when the component is torn down.
   *  Every async step and timer below checks this flag first.
   *  This stops a stale promise or timer from navigating, retrying, or opening a stream. */
  private destroyed = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.cleanup());
    void this.init();
  }

  private async init(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch {
      if (this.destroyed) return;
      // Could not load the assessment up front; open the stream anyway. If the id is bad the
      // stream's own error/re-fetch cycle will surface it via the retry loop.
      this.openStream();
      return;
    }
    if (this.destroyed) return;
    this.applyAssessment(assessment);
    if (!isTerminal(assessment.status)) {
      this.openStream();
    }
  }

  private openStream(): void {
    if (this.destroyed) return;
    this.closeStream = openAssessmentStream(
      this.id,
      (status) => this.status.set(status),
      () => this.handleClose(),
    );
  }

  private handleClose(): void {
    if (this.destroyed) return;
    this.closeStream = null;
    void this.refetchAfterClose();
  }

  private async refetchAfterClose(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch (e: unknown) {
      if (this.destroyed) return;

      if (e instanceof ApiError && e.code === 'unauthenticated') {
        this.userStore.clear();
        void this.router.navigateByUrl('/login');
        return;
      }

      this.refetchFailures++;
      if (this.refetchFailures >= MAX_REFETCH_FAILURES) {
        this.retryError.set(
          e instanceof ApiError
            ? e
            : new ApiError('unknown', 'We could not load your progress. Please try again.', 0),
        );
        this.retriesExhausted.set(true);
        return;
      }
      this.scheduleRetry();
      return;
    }
    if (this.destroyed) return;
    this.refetchFailures = 0;
    this.applyAssessment(assessment);
    if (!isTerminal(assessment.status)) {
      this.scheduleRetry();
    }
  }

  private applyAssessment(assessment: AssessmentDto): void {
    if (this.destroyed) return;
    this.status.set(assessment.status);
    if (assessment.status === 'ready') {
      this.doneTimer = setTimeout(() => {
        if (this.destroyed) return;
        void this.router.navigateByUrl(`/sites/${assessment.siteId}`);
      }, DONE_BEAT_MS);
    } else if (assessment.status === 'failed') {
      this.failed.set(assessment);
    }
  }

  private scheduleRetry(): void {
    if (this.destroyed) return;
    this.retryTimer = setTimeout(() => this.openStream(), RETRY_DELAY_MS);
  }

  protected headline(a: AssessmentDto): string { return failureHeadline(a.errorCode); }

  protected isDone(step: keyof typeof STEP_LABELS): boolean {
    const current = this.status();
    if (!current || current === 'failed') return false;
    if (current === 'ready') return true;
    return STEPS.indexOf(step) < STEPS.indexOf(current);
  }
  protected isActive(step: keyof typeof STEP_LABELS): boolean { return this.status() === step; }

  protected tryAgain(a: AssessmentDto): void {
    if (this.retryBusy()) return;
    this.retryBusy.set(true);
    this.retryError.set(null);
    this.api.submitAssessment(a.siteId)
      .then(
        (next) => {
          if (this.destroyed) return;
          void this.router.navigateByUrl(`/assessments/${next.id}/progress`);
        },
        (e: unknown) => {
          if (this.destroyed) return;
          this.retryError.set(toApiError(e));
        },
      )
      .finally(() => {
        if (this.destroyed) return;
        this.retryBusy.set(false);
      });
  }

  private cleanup(): void {
    this.destroyed = true;
    this.closeStream?.();
    this.closeStream = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.doneTimer) clearTimeout(this.doneTimer);
  }
}
