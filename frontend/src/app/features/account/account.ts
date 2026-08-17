import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { SiteDto, UsageDto } from '../../core/api/types';
import { FREEMIUS_PORTAL_URL, PRO_PRICE_LABEL, PRO_TIER_COPY } from '../../core/config';
import { ErrorNote } from '../../shared/error-note';
import { formatDate, formatDateShort, numberWord } from '../../shared/copy';
import { toApiError } from '../../shared/to-api-error';
import { pricingUrlFor } from '../../shared/upgrade-redirect';

@Component({
  selector: 'app-account',
  imports: [RouterLink, ErrorNote],
  templateUrl: './account.html',
  styles: `
    .account { padding-top: 48px; }
    .col { flex: 1; gap: 34px; }
    .side { width: 348px; flex-shrink: 0; border: 2px solid var(--accent); padding: 30px 30px 34px; gap: 20px; }
    .side.pro { border-color: var(--line-strong); }
    .meter { gap: 11px; }
    .price { font-size: 32px; font-weight: 700; color: var(--ink); letter-spacing: -0.03em; }
    .site-card { display: flex; align-items: center; gap: 14px; padding: 16px 20px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-small); color: inherit; }
    .small { font-size: 13px; }
    @media (max-width: 760px) { .side { width: 100%; } }
  `,
})
export class Account implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected readonly store = inject(UserStore);

  protected readonly portalUrl = FREEMIUS_PORTAL_URL;

  protected readonly usage = signal<UsageDto | null>(null);
  protected readonly sites = signal<SiteDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);

  protected readonly resent = signal(false);
  protected readonly resendBusy = signal(false);
  protected readonly resendError = signal<ApiError | null>(null);

  protected readonly proSitesLeft = computed(() => Math.max(0, PRO_TIER_COPY.sites - this.sites().length));
  protected readonly hasReadyCheck = computed(() => this.sites().some((s) => s.latestReadyAssessmentId));
  protected readonly word = numberWord;
  protected readonly price = PRO_PRICE_LABEL;
  protected readonly proSites = numberWord(PRO_TIER_COPY.sites).replace(/^./, (c) => c.toUpperCase());
  protected readonly proChecks = numberWord(PRO_TIER_COPY.checks);

  /** Set once on destroy. Every async continuation checks it first.
   *  A late navigation or signal write must not run after the route leaves. */
  private destroyed = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.destroyed = true; });
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [usage, sites] = await Promise.all([this.api.usage(), this.api.listSites().catch(() => [] as SiteDto[])]);
      if (this.destroyed) return;
      this.usage.set(usage);
      this.sites.set(sites);
    } catch (e) {
      if (this.destroyed) return;
      this.error.set(toApiError(e));
    } finally {
      if (this.destroyed) return;
      this.loading.set(false);
    }
  }

  protected lastChecked(site: SiteDto): string {
    const at = site.latestAssessment?.completedAt ?? site.latestAssessment?.createdAt;
    return at ? `${site.platform ?? 'Website'} · last checked ${formatDate(at)}` : 'No check yet';
  }

  protected nextCheck(u: UsageDto): string {
    if (!u.nextCheckAt) return '';
    const when = formatDateShort(u.nextCheckAt);
    return this.store.user()?.tier === 'pro' ? `Your next check is available on ${when}.` : `Your next free check is available on ${when}.`;
  }

  protected pct(used: number, limit: number): number {
    return limit > 0 ? Math.min(100, (100 * used) / limit) : 0;
  }

  protected unlock(): void {
    void this.router.navigateByUrl(pricingUrlFor(this.sites().find((s) => s.latestReadyAssessmentId)?.id ?? null));
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.resendError.set(null);
    this.api
      .resendVerification()
      .then(
        () => { if (this.destroyed) return; this.resent.set(true); },
        (e: unknown) => { if (this.destroyed) return; this.resendError.set(toApiError(e)); },
      )
      .finally(() => { if (this.destroyed) return; this.resendBusy.set(false); });
  }

  protected async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // The server call failed (network error, 5xx, etc.) — the server session
      // either got revoked already or will expire on its own; swallow the
      // failure so it doesn't surface as an unhandled rejection.
    } finally {
      if (this.destroyed) return;
      // The client must always drop its local state, even if the call failed.
      this.store.clear();
      await this.router.navigateByUrl('/');
    }
  }
}
