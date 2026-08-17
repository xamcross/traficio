import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { PlanDto, PlanTaskDto } from '../../core/api/types';
import { ErrorNote } from '../../shared/error-note';
import { ImpactBadge } from '../../shared/impact-badge';
import { areaName, effortText } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { isUpgradeRequired, pricingUrlFor } from '../../shared/upgrade-redirect';
import { openMinutes } from '../result/result-view';

@Component({
  selector: 'app-plan',
  imports: [RouterLink, ErrorNote, ImpactBadge],
  templateUrl: './plan.html',
  styles: `
    .plan { padding-top: 48px; display: flex; flex-direction: column; gap: 26px; }
    .task { border-bottom: 1px solid var(--line); padding: 14px 0; }
    .task-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .expand { background: none; border: none; padding: 0; text-align: left; font: inherit; color: var(--ink); font-weight: 600; cursor: pointer; flex: 1; }
    .details { padding: 12px 0 0 32px; display: flex; flex-direction: column; gap: 12px; }
    .steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; color: var(--ink); }
    .small { font-size: 13px; }
  `,
})
export class Plan implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly plan = signal<PlanDto | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly patchError = signal<ApiError | null>(null);
  protected readonly expanded = signal<string | null>(null);
  protected readonly busyTaskId = signal<string | null>(null);
  protected readonly areaName = areaName;

  protected readonly progressPercent = computed(() => {
    const p = this.plan()?.progress;
    if (!p || p.total === 0) return 0;
    return (100 * (p.done + p.verified)) / p.total;
  });
  protected readonly progressLabel = computed(() => {
    const plan = this.plan();
    if (!plan) return '';
    const p = plan.progress;
    return `${p.done + p.verified} of ${p.total} done · ${effortText(openMinutes(plan))} left`;
  });

  /** Set once on destroy. Every async step checks this flag first, as in site-home.ts. */
  private destroyed = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.destroyed = true; });
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const plan = await this.api.getPlanForAssessment(this.id);
      if (this.destroyed) return;
      if (plan.locked) { void this.router.navigateByUrl(pricingUrlFor(plan.siteId)); return; }
      this.plan.set(plan);
    } catch (e) {
      if (this.destroyed) return;
      if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(null)); return; }
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
        (updated) => {
          if (this.destroyed) return;
          this.plan.set(updated);
        },
        (e: unknown) => {
          if (this.destroyed) return;
          this.patchError.set(toApiError(e));
          // The native checkbox already flipped from the user's click before this handler ran.
          // Angular's [checked] binding only rewrites the DOM when the bound value changes, and
          // it did not change here (the PATCH failed), so reset the element imperatively.
          checkboxEl.checked = this.isChecked(task);
        },
      )
      .finally(() => {
        if (this.destroyed) return;
        this.busyTaskId.set(null);
      });
  }
}
