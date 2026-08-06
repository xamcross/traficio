import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import { AssessmentDto, AssessmentStatus } from '../../core/api/types';
import { openAssessmentStream } from '../../core/sse/assessment-stream';

const NARRATION: Record<AssessmentStatus, string> = {
  queued: 'You are in line. We start in a moment…',
  crawling: 'Reading your pages…',
  analyzing: 'Checking your site for search engines and AI answers…',
  planning: 'Writing your step-by-step plan…',
  ready: 'Done! Your plan is ready.',
  failed: 'We could not finish the check.',
};

/** Simple 4-step rail; ready/failed are terminal outcomes shown separately, not rail steps. */
const STEPS: AssessmentStatus[] = ['queued', 'crawling', 'analyzing', 'planning'];

/** errorCode values whose errorMessage is already beginner-written, backend-authoritative copy. */
const QUOTA_CONSUMING_ERROR_CODES = new Set(['js_only_site', 'robots_blocked', 'site_unreachable']);

const RETRY_DELAY_MS = 2000;
const DONE_BEAT_MS = 1500;

function isTerminal(status: AssessmentStatus): boolean {
  return status === 'ready' || status === 'failed';
}

@Component({
  selector: 'app-progress',
  imports: [RouterLink],
  template: `
    @if (failed(); as f) {
      <div class="failure-panel">
        <p role="alert">{{ failureMessage(f) }}</p>
        @if (quotaConsumed(f)) {
          <p>Your monthly check was not used.</p>
        }
        <p><a routerLink="/dashboard">Back to my sites</a></p>
      </div>
    } @else {
      <p class="narration">{{ narration() }}</p>
      <ol class="progress-rail">
        @for (step of steps; track step) {
          <li [class.active]="stepDone(step)">{{ step }}</li>
        }
      </ol>
    }
  `,
})
export class Progress implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  private readonly id = this.route.snapshot.paramMap.get('id')!;

  protected readonly steps = STEPS;
  protected readonly status = signal<AssessmentStatus | null>(null);
  protected readonly failed = signal<AssessmentDto | null>(null);
  protected readonly narration = computed(() => {
    const s = this.status();
    return s ? NARRATION[s] : 'Loading…';
  });

  private closeStream: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private doneTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.cleanup());
    void this.init();
  }

  private async init(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch {
      // Could not load the assessment up front; open the stream anyway. If the id is bad the
      // stream's own error/re-fetch cycle will surface it via the retry loop.
      this.openStream();
      return;
    }
    this.applyAssessment(assessment);
    if (!isTerminal(assessment.status)) {
      this.openStream();
    }
  }

  private openStream(): void {
    this.closeStream = openAssessmentStream(
      this.id,
      (status) => this.status.set(status),
      () => this.handleClose(),
    );
  }

  private handleClose(): void {
    this.closeStream = null;
    void this.refetchAfterClose();
  }

  private async refetchAfterClose(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.applyAssessment(assessment);
    if (!isTerminal(assessment.status)) {
      this.scheduleRetry();
    }
  }

  private applyAssessment(assessment: AssessmentDto): void {
    this.status.set(assessment.status);
    if (assessment.status === 'ready') {
      this.doneTimer = setTimeout(() => {
        void this.router.navigateByUrl(`/assessments/${this.id}/report`);
      }, DONE_BEAT_MS);
    } else if (assessment.status === 'failed') {
      this.failed.set(assessment);
    }
  }

  private scheduleRetry(): void {
    this.retryTimer = setTimeout(() => this.openStream(), RETRY_DELAY_MS);
  }

  protected stepDone(step: AssessmentStatus): boolean {
    const current = this.status();
    if (!current) return false;
    if (current === 'ready') return true;
    if (current === 'failed') return false;
    return STEPS.indexOf(step) <= STEPS.indexOf(current);
  }

  protected failureMessage(assessment: AssessmentDto): string {
    if (this.quotaConsumed(assessment)) {
      return assessment.errorMessage ?? 'We could not finish the check.';
    }
    return 'Something went wrong on our side. Please try again.';
  }

  protected quotaConsumed(assessment: AssessmentDto): boolean {
    return !!assessment.errorCode && QUOTA_CONSUMING_ERROR_CODES.has(assessment.errorCode);
  }

  private cleanup(): void {
    this.closeStream?.();
    this.closeStream = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.doneTimer) clearTimeout(this.doneTimer);
  }
}
