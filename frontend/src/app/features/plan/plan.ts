import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { PlanDto, PlanTaskDto } from '../../core/api/types';
import { ErrorNote } from '../../shared/error-note';

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0);
}

@Component({
  selector: 'app-plan',
  imports: [RouterLink, ErrorNote],
  templateUrl: './plan.html',
  styles: `
    .task-header { cursor: pointer; }
    .chip { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.85rem; margin-right: 0.4rem; }
    .impact-high { background: #fdecea; color: #b3261e; }
    .impact-medium { background: #fff4e0; color: #8a5a00; }
    .impact-low { background: #e6f4ea; color: #1e7d34; }
    .progress-bar { background: #eee; border-radius: 999px; height: 10px; overflow: hidden; }
    .progress-bar-fill { background: #2f6feb; height: 100%; }
  `,
})
export class Plan implements OnInit {
  private api = inject(ApiClient);
  private route = inject(ActivatedRoute);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly plan = signal<PlanDto | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly patchError = signal<ApiError | null>(null);
  protected readonly expanded = signal<string | null>(null);
  protected readonly busyTaskId = signal<string | null>(null);

  protected readonly progressPercent = computed(() => {
    const p = this.plan()?.progress;
    if (!p || p.total === 0) return 0;
    return (100 * (p.done + p.verified)) / p.total;
  });

  protected readonly progressLabel = computed(() => {
    const p = this.plan()?.progress;
    if (!p) return '';
    return `You finished ${p.done + p.verified} of ${p.total} tasks.`;
  });

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      this.plan.set(await this.api.getPlanForAssessment(this.id));
    } catch (e) {
      this.error.set(toApiError(e));
    }
  }

  protected toggleExpand(taskId: string): void {
    this.expanded.set(this.expanded() === taskId ? null : taskId);
  }

  protected isChecked(task: PlanTaskDto): boolean {
    return task.status === 'done' || task.status === 'verified';
  }

  protected toggleStatus(task: PlanTaskDto, event: Event): void {
    const checkboxEl = event.target as HTMLInputElement;
    if (task.status === 'verified' || this.busyTaskId() !== null) {
      // The browser already flipped the checkbox from the click/tap before this handler ran
      // (e.g. a race where a click on task B lands right as task A's PATCH is still resolving,
      // slipping past the [disabled] binding). We are not acting on it, so reset it immediately.
      checkboxEl.checked = this.isChecked(task);
      return;
    }
    const plan = this.plan();
    if (!plan) return;
    const nextStatus: 'todo' | 'done' = task.status === 'done' ? 'todo' : 'done';
    this.busyTaskId.set(task.taskId);
    this.patchError.set(null);
    this.api
      .setTaskStatus(plan.id, task.taskId, nextStatus)
      .then(
        (updated) => this.plan.set(updated),
        (e: unknown) => {
          this.patchError.set(toApiError(e));
          // The native checkbox already flipped from the user's click before this handler ran.
          // Angular's [checked] binding only rewrites the DOM when the bound value changes, and
          // it did not change here (the PATCH failed), so reset the element imperatively.
          checkboxEl.checked = this.isChecked(task);
        },
      )
      .finally(() => this.busyTaskId.set(null));
  }
}
