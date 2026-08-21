import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
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
        <section class="card stack share-control">
          <div class="stack" style="gap:4px">
            <strong>Share this result</strong>
            <span class="muted small">Anyone with the link can see your score and findings. Your plan stays private.</span>
          </div>
          <div class="row">
            <button
              type="button"
              class="btn"
              [class.btn-primary]="!shared()"
              [class.btn-outline]="shared()"
              [disabled]="shareBusy()"
              [attr.aria-pressed]="shared()"
              (click)="toggleShare()"
            >
              {{ shared() ? 'Stop sharing' : 'Share this result' }}
            </button>
            @if (shareBusy()) {<span class="muted small">Working…</span>}
          </div>
          @if (shared() && shareUrl(); as url) {
            <div class="row share-url-row">
              <input type="text" readonly [value]="url" class="share-url-input" aria-label="Shareable link" />
              <button type="button" class="btn btn-outline" (click)="copyShareUrl(url)">Copy link</button>
            </div>
            @if (copied()) {<span class="muted small" role="status">Copied to clipboard.</span>}
          }
          @if (shareError(); as e) {<app-error-note [error]="e" />}
        </section>
        <app-result-view [assessment]="a" [plan]="plan()" [tier]="store.user()?.tier ?? 'free'" [siteId]="a.siteId" />
      } @else {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
  styles: `
    .share-control { gap: 16px; margin-bottom: 32px; }
    .share-url-row { gap: 12px; }
    .share-url-input { flex: 1; padding: 12px 16px; background: var(--card-soft); border: 1.5px solid var(--line-input); border-radius: var(--r-btn); color: var(--ink); font-size: 14px; }
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

  /** True when the result is public. init() sets this from
   *  `assessment.publicSlug`, so a reload shows the true state. After that,
   *  the value changes only once the share or the unshare call confirms it. */
  protected readonly shared = signal(false);
  protected readonly shareUrl = signal<string | null>(null);
  protected readonly shareBusy = signal(false);
  protected readonly shareError = signal<ApiError | null>(null);
  protected readonly copied = signal(false);

  /** True after cleanup() runs, when the component is torn down.
   *  Every async step below checks this flag first.
   *  SiteContext is a root singleton. The header reads it.
   *  A late write here would show a stale domain on the current page. */
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
    if (assessment.publicSlug) {
      this.shared.set(true);
      this.shareUrl.set(`${environment.siteOrigin}/r/${assessment.publicSlug}`);
    }
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

  /** Turns sharing on or off. The `shared` flag changes only after the server
   *  confirms the call. A failed call leaves `shared` exactly as it was. The
   *  control never claims a state the server has not confirmed. */
  protected toggleShare(): void {
    if (this.shareBusy()) return;
    this.shareError.set(null);
    this.copied.set(false);
    this.shareBusy.set(true);
    const call = this.shared() ? this.turnSharingOff() : this.turnSharingOn();
    call.finally(() => {
      if (this.destroyed) return;
      this.shareBusy.set(false);
    });
  }

  private async turnSharingOn(): Promise<void> {
    try {
      const { slug } = await this.api.shareAssessment(this.id);
      if (this.destroyed) return;
      this.shareUrl.set(`${environment.siteOrigin}/r/${slug}`);
      this.shared.set(true);
    } catch (e) {
      if (this.destroyed) return;
      this.shareError.set(toApiError(e));
    }
  }

  private async turnSharingOff(): Promise<void> {
    try {
      await this.api.unshareAssessment(this.id);
      if (this.destroyed) return;
      this.shared.set(false);
      this.shareUrl.set(null);
    } catch (e) {
      if (this.destroyed) return;
      this.shareError.set(toApiError(e));
    }
  }

  /** Copies the share URL with the async clipboard API.
   *  The check below guards a browser with no clipboard API. It also guards a
   *  denied permission. Either way, the URL stays visible in the read-only
   *  field, so the reader can still copy it by hand. */
  protected async copyShareUrl(url: string): Promise<void> {
    this.copied.set(false);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) return;
    try {
      await clipboard.writeText(url);
      if (this.destroyed) return;
      this.copied.set(true);
    } catch {
      // The clipboard write failed, for example on a denied permission. The
      // URL stays visible and selectable. This is not an error for the reader.
    }
  }
}
