import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { AssessmentDto, PlanDto, SiteDto } from '../../core/api/types';
import { UserStore } from '../../core/auth/user-store';
import { SiteContext } from '../../core/site-context';
import { ErrorNote } from '../../shared/error-note';
import { assessmentErrorCopy } from '../../shared/assessment-error-copy';
import { formatDate } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { isUpgradeRequired, pricingUrlFor } from '../../shared/upgrade-redirect';
import { failureHeadline } from '../progress/progress';
import { ResultView } from '../result/result-view';
import { NextTaskView } from './next-task-view';

type State =
  | { kind: 'loading' }
  | { kind: 'first' }
  | { kind: 'failed'; failed: AssessmentDto }
  | { kind: 'ready'; assessment: AssessmentDto; plan: PlanDto | null; failedNote: AssessmentDto | null; previousOverall: number | null }
  | { kind: 'error'; error: ApiError };

@Component({
  selector: 'app-site-home',
  imports: [RouterLink, ErrorNote, ResultView, NextTaskView],
  template: `
    <div class="page surface home" [class.flush]="state().kind === 'ready' && isPro()">
      @switch (state().kind) {
        @case ('loading') {<p class="muted">Loading…</p>}
        @case ('error') {<app-error-note [error]="errorOf()" /><p><a routerLink="/dashboard">Back to my sites</a></p>}
        @case ('first') {
          <section class="card stack first">
            <span class="eyebrow">YOUR SITE</span>
            <h1>{{ site()?.domain }}</h1>
            <p class="lead">Run your first check. It takes about two minutes. We read your pages and score how findable you are.</p>
            @if (!emailVerified()) {
              <div class="note-box stack tight"><span>Confirm your email first. Click the link in the email we sent you.</span><button type="button" class="btn btn-outline" (click)="resend()" [disabled]="resendBusy()">Send it again</button>@if (resent()) {<span class="muted">Sent. Check your inbox.</span>}</div>
            }
            <div class="row"><button type="button" class="btn btn-primary" (click)="check()" [disabled]="!emailVerified() || checkBusy()">Check my site</button></div>
            @if (checkError(); as e) {<p class="error-note" role="alert">{{ assessmentErrorCopy(e) }}</p>}
          </section>
        }
        @case ('failed') {
          <section class="stack failure">
            <span class="eyebrow tone-low">WE COULD NOT FINISH</span>
            <h1>{{ headline(failedOf()) }}</h1>
            @if (failedOf().errorMessage; as m) {<p class="lead">{{ m }}</p>}
            <div class="note-box stack tight"><span class="eyebrow">GOOD NEWS</span><span>{{ isPro() ? 'This check did not count against your monthly checks.' : 'Your free check this month was not used.' }}</span></div>
            <div class="row"><button type="button" class="btn btn-primary" (click)="check()" [disabled]="checkBusy()">Try again</button></div>
            @if (checkError(); as e) {<p class="error-note" role="alert">{{ assessmentErrorCopy(e) }}</p>}
          </section>
        }
        @case ('ready') {
          @if (readyOf().failedNote; as f) {
            <div class="note-box row failed-note"><span>Your last check on {{ date(f) }} did not finish. {{ f.errorMessage }}</span><span class="spacer"></span><button type="button" class="btn btn-outline" (click)="check()" [disabled]="checkBusy()">Try again</button></div>
          }
          @if (isPro() && readyOf().plan; as p) {
            <app-next-task-view [site]="site()!" [assessment]="readyOf().assessment" [plan]="p" [previousOverall]="readyOf().previousOverall" [doneBusy]="doneBusy()" [checkBusy]="checkBusy()" (done)="markDone($event)" (checkAgain)="check()" />
          } @else {
            <app-result-view [assessment]="readyOf().assessment" [plan]="readyOf().plan" [tier]="isPro() ? 'pro' : 'free'" [siteId]="siteId" />
          }
          @if (checkError(); as e) {<p class="error-note" role="alert">{{ assessmentErrorCopy(e) }}</p>}
          @if (doneError(); as e) {<app-error-note [error]="e" />}
        }
      }
    </div>
  `,
  styles: `
    .home { padding-top: 52px; padding-bottom: 60px; }
    .home.flush { padding: 0; }
    .first { max-width: 620px; padding: 38px 44px; }
    h1 { font-size: 29px; }
    .lead { font-size: 16px; line-height: 1.6; color: var(--body-long); max-width: 44ch; }
    .failure { max-width: 620px; gap: 30px; }
    .failed-note { margin-bottom: 24px; }
    .tight { gap: 8px; }
  `,
})
export class SiteHome implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private siteContext = inject(SiteContext);
  private destroyRef = inject(DestroyRef);
  protected readonly store = inject(UserStore);

  protected readonly siteId = this.route.snapshot.paramMap.get('siteId')!;
  protected readonly site = signal<SiteDto | null>(null);
  protected readonly state = signal<State>({ kind: 'loading' });
  protected readonly checkBusy = signal(false);
  protected readonly checkError = signal<ApiError | null>(null);
  protected readonly doneBusy = signal(false);
  protected readonly doneError = signal<ApiError | null>(null);
  protected readonly resendBusy = signal(false);
  protected readonly resent = signal(false);
  protected readonly assessmentErrorCopy = assessmentErrorCopy;
  protected readonly isPro = computed(() => this.store.user()?.tier === 'pro');
  protected readonly emailVerified = computed(() => this.store.user()?.emailVerified === true);

  /** Set once, in cleanup(), when the component is torn down. Guards every async continuation
   *  below so a promise that outlives the component (SiteContext is a root singleton the header
   *  reads from, so a late write here would leak a stale domain onto whatever page is now shown)
   *  can never touch a signal, SiteContext, or navigate after the fact. */
  private destroyed = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.cleanup());
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const sites = await this.api.listSites();
      if (this.destroyed) return;
      const site = sites.find((s) => s.id === this.siteId);
      if (!site) { this.state.set({ kind: 'error', error: new ApiError('not_found', "We couldn't find that site.", 404) }); return; }
      this.site.set(site);
      this.siteContext.set(site.domain);
      const latest = site.latestAssessment;
      if (!latest) { this.state.set({ kind: 'first' }); return; }
      if (latest.status !== 'ready' && latest.status !== 'failed') { void this.router.navigateByUrl(`/assessments/${latest.id}/progress`); return; }
      if (latest.status === 'failed' && !site.latestReadyAssessmentId) {
        const failed = await this.api.getAssessment(latest.id);
        if (this.destroyed) return;
        this.state.set({ kind: 'failed', failed });
        return;
      }
      const readyId = latest.status === 'ready' ? latest.id : site.latestReadyAssessmentId!;
      const [assessment, failedNote] = await Promise.all([
        this.api.getAssessment(readyId),
        latest.status === 'failed' ? this.api.getAssessment(latest.id) : Promise.resolve(null),
      ]);
      if (this.destroyed) return;
      const plan = await this.api.getPlanForAssessment(readyId).catch(() => null);
      if (this.destroyed) return;
      let previousOverall: number | null = null;
      if (this.isPro()) {
        try {
          const history = await this.api.listAssessments(this.siteId);
          if (this.destroyed) return;
          const ready = history.filter((a) => a.status === 'ready' && a.scores);
          const idx = ready.findIndex((a) => a.id === readyId);
          const prev = idx >= 0 ? ready[idx + 1] : null;
          previousOverall = prev?.scores?.overall ?? null;
        } catch { /* no delta line */ }
      }
      if (this.destroyed) return;
      this.state.set({ kind: 'ready', assessment, plan, failedNote, previousOverall });
    } catch (e) {
      if (this.destroyed) return;
      if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
      this.state.set({ kind: 'error', error: toApiError(e) });
    }
  }

  protected errorOf(): ApiError { const s = this.state(); return s.kind === 'error' ? s.error : new ApiError('unknown', '', 0); }
  protected failedOf(): AssessmentDto { const s = this.state(); return s.kind === 'failed' ? s.failed : (null as unknown as AssessmentDto); }
  protected readyOf() { const s = this.state(); return s.kind === 'ready' ? s : (null as unknown as Extract<State, { kind: 'ready' }>); }
  protected headline(a: AssessmentDto): string { return failureHeadline(a.errorCode); }
  protected date(a: AssessmentDto): string { return formatDate(a.completedAt ?? a.createdAt); }

  protected check(): void {
    if (this.checkBusy()) return;
    this.checkBusy.set(true);
    this.checkError.set(null);
    this.api.submitAssessment(this.siteId)
      .then((a) => {
        if (this.destroyed) return;
        void this.router.navigateByUrl(`/assessments/${a.id}/progress`);
      }, (e: unknown) => {
        if (this.destroyed) return;
        if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
        this.checkError.set(toApiError(e));
      })
      .finally(() => {
        if (this.destroyed) return;
        this.checkBusy.set(false);
      });
  }

  protected markDone(taskId: string): void {
    const s = this.state();
    if (s.kind !== 'ready' || !s.plan || this.doneBusy()) return;
    this.doneBusy.set(true);
    this.doneError.set(null);
    this.api.setTaskStatus(s.plan.id, taskId, 'done')
      .then((plan) => {
        if (this.destroyed) return;
        this.state.set({ ...s, plan });
      }, (e: unknown) => {
        if (this.destroyed) return;
        if (isUpgradeRequired(e)) { void this.router.navigateByUrl(pricingUrlFor(this.siteId)); return; }
        this.doneError.set(toApiError(e));
      })
      .finally(() => {
        if (this.destroyed) return;
        this.doneBusy.set(false);
      });
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.api.resendVerification()
      .then(() => {
        if (this.destroyed) return;
        this.resent.set(true);
      }, (e: unknown) => {
        if (this.destroyed) return;
        this.checkError.set(toApiError(e));
      })
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
