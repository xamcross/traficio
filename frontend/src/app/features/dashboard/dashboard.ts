import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { SiteDto, UsageDto } from '../../core/api/types';
import { PENDING_URL_KEY } from '../../core/config';
import { ErrorNote } from '../../shared/error-note';
import { assessmentErrorCopy } from '../../shared/assessment-error-copy';
import { formatDate } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { pricingUrlFor } from '../../shared/upgrade-redirect';

@Component({
  selector: 'app-dashboard',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  templateUrl: './dashboard.html',
  styles: `
    .dash { padding-top: 48px; display: flex; flex-direction: column; gap: 34px; max-width: 760px; }
    .site-card { display: flex; flex-direction: column; gap: 10px; padding: 16px 20px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-small); }
    .site-link { display: flex; align-items: center; gap: 14px; color: inherit; }
    .site-card .domain { font-size: 16px; font-weight: 600; color: var(--ink); }
    .site-card .score { font-size: 20px; font-weight: 700; color: var(--ink); }
    .add { max-width: 480px; }
    .small { font-size: 13px; }
  `,
})
export class Dashboard implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected readonly store = inject(UserStore);

  protected readonly sites = signal<SiteDto[]>([]);
  protected readonly usage = signal<UsageDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly addBusy = signal(false);
  protected readonly addError = signal<ApiError | null>(null);
  protected readonly checkError = signal<ApiError | null>(null);
  protected readonly resent = signal(false);
  protected readonly resendBusy = signal(false);
  protected readonly assessmentErrorCopy = assessmentErrorCopy;
  protected readonly pricingUrl = pricingUrlFor;

  protected readonly addForm = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Set once on destroy. Every async continuation checks it first.
   *  A late navigation or signal write must not run after the route leaves. */
  private destroyed = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.destroyed = true; });
    void this.init();
  }

  private async init(): Promise<void> {
    const pendingUrl = sessionStorage.getItem(PENDING_URL_KEY);
    if (pendingUrl) {
      sessionStorage.removeItem(PENDING_URL_KEY);
      await this.createAndCheck(pendingUrl);
      if (this.destroyed) return;
      if (this.checkError() === null && this.addError() === null) return; // navigated away
    }
    await this.loadSites();
  }

  /** Landing hand-off: create the site, start the first check, open progress. Spec §5.1. */
  private async createAndCheck(url: string): Promise<void> {
    let site: SiteDto;
    try {
      site = await this.api.createSite(url);
      if (this.destroyed) return;
    } catch (e) {
      if (this.destroyed) return;
      this.addForm.patchValue({ url });
      this.addError.set(toApiError(e));
      return;
    }
    try {
      const a = await this.api.submitAssessment(site.id);
      if (this.destroyed) return;
      await this.router.navigateByUrl(`/assessments/${a.id}/progress`);
    } catch (e) {
      if (this.destroyed) return;
      this.checkError.set(toApiError(e));
    }
  }

  private async loadSites(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [sites, usage] = await Promise.all([this.api.listSites(), this.api.usage().catch(() => null)]);
      if (this.destroyed) return;
      const list = [...sites];
      this.sites.set(list);
      this.usage.set(usage);
      if (list.length === 1 && !this.checkError() && !this.addError()) {
        await this.router.navigateByUrl(`/sites/${list[0].id}`);
        return;
      }
    } catch (e) {
      if (this.destroyed) return;
      this.error.set(toApiError(e));
    } finally {
      if (this.destroyed) return;
      this.loading.set(false);
    }
  }

  protected canAdd(): boolean {
    const u = this.usage();
    return !u || u.sitesUsed < u.sitesLimit;
  }

  protected lastChecked(site: SiteDto): string {
    const at = site.latestAssessment?.completedAt ?? site.latestAssessment?.createdAt;
    const platform = site.platform ?? 'Website';
    return at ? `${platform} · last checked ${formatDate(at)}` : 'No check yet';
  }

  protected submitAdd(): void {
    if (this.addForm.invalid || this.addBusy()) return;
    this.addBusy.set(true);
    this.addError.set(null);
    const { url } = this.addForm.getRawValue();
    this.api.createSite(url)
      .then((created) => {
        if (this.destroyed) return;
        void this.router.navigateByUrl(`/sites/${created.id}`);
      }, (e: unknown) => {
        if (this.destroyed) return;
        this.addError.set(toApiError(e));
      })
      .finally(() => {
        if (this.destroyed) return;
        this.addBusy.set(false);
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
}
