import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
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
export class Report implements OnInit, OnDestroy {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private siteContext = inject(SiteContext);
  protected readonly store = inject(UserStore);

  protected readonly id = this.route.snapshot.paramMap.get('id')!;
  protected readonly assessment = signal<AssessmentDto | null>(null);
  protected readonly plan = signal<PlanDto | null>(null);
  protected readonly error = signal<ApiError | null>(null);

  ngOnInit(): void { void this.init(); }
  ngOnDestroy(): void { this.siteContext.clear(); }

  private async init(): Promise<void> {
    let assessment: AssessmentDto;
    try {
      assessment = await this.api.getAssessment(this.id);
    } catch (e) {
      this.error.set(toApiError(e));
      return;
    }
    if (assessment.status !== 'ready') {
      void this.router.navigateByUrl(`/assessments/${this.id}/progress`);
      return;
    }
    this.assessment.set(assessment);
    try {
      const sites = await this.api.listSites();
      this.siteContext.set(sites.find((s) => s.id === assessment.siteId)?.domain ?? null);
    } catch { /* the header just shows no domain */ }
    try {
      this.plan.set(await this.api.getPlanForAssessment(this.id));
    } catch { /* a missing plan hides the teaser; the result still shows */ }
  }
}
