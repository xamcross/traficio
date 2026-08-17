import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto } from '../../core/api/types';
import { UserStore } from '../../core/auth/user-store';
import { SiteContext } from '../../core/site-context';
import { ErrorNote } from '../../shared/error-note';
import { toApiError } from '../../shared/to-api-error';
import { ResultView } from '../result/result-view';

@Component({
  selector: 'app-report',
  imports: [RouterLink, ErrorNote, ResultView],
  template: `
    <div class="page surface">
      @if (error(); as e) {
        <app-error-note [error]="e" />
        <p><a routerLink="/dashboard">Back to my sites</a></p>
      } @else if (assessment(); as a) {
        <app-result-view [assessment]="a" [plan]="plan()" [tier]="store.user()?.tier ?? 'free'" [siteId]="a.siteId" />
      } @else {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
})
export class Report implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private siteContext = inject(SiteContext);
  private destroyRef = inject(DestroyRef);
  protected readonly store = inject(UserStore);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly assessment = signal<AssessmentDto | null>(null);
  protected readonly plan = signal<PlanDto | null>(null);
  protected readonly error = signal<ApiError | null>(null);

  /** Set once, in cleanup(), when the component is torn down. Guards every async continuation
   *  below so a promise that outlives the component (SiteContext is a root singleton the header
   *  reads from, so a late write here would leak a stale domain onto whatever page is now shown)
   *  can never touch a signal, SiteContext, or navigate after the fact. */
  private destroyed = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.cleanup());
    void this.init();
  }

  private async init(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch (e) {
      if (this.destroyed) return;
      this.error.set(toApiError(e));
      return;
    }
    if (this.destroyed) return;
    if (assessment.status !== 'ready') {
      void this.router.navigateByUrl(`/assessments/${this.id}/progress`);
      return;
    }
    this.assessment.set(assessment);
    try {
      const sites = await this.api.listSites();
      if (this.destroyed) return;
      this.siteContext.set(sites.find((s) => s.id === assessment.siteId)?.domain ?? null);
    } catch { /* the header just shows no domain */ }
    try {
      const plan = await this.api.getPlanForAssessment(this.id);
      if (this.destroyed) return;
      this.plan.set(plan);
    } catch { /* a missing plan hides the teaser; the result still shows */ }
  }

  private cleanup(): void {
    this.destroyed = true;
    this.siteContext.clear();
  }
}
