import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { SiteDto } from '../../core/api/types';
import { PENDING_URL_KEY } from '../../core/config';
import { ErrorNote } from '../../shared/error-note';

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0);
}

@Component({
  selector: 'app-dashboard',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  templateUrl: './dashboard.html',
})
export class Dashboard implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  protected readonly store = inject(UserStore);

  protected readonly sites = signal<SiteDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);

  protected readonly addBusy = signal(false);
  protected readonly addError = signal<ApiError | null>(null);

  protected readonly checkError = signal<ApiError | null>(null);
  protected readonly busySiteId = signal<string | null>(null);
  protected readonly resent = signal(false);
  protected readonly resendBusy = signal(false);

  protected readonly addForm = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  ngOnInit(): void {
    const pendingUrl = sessionStorage.getItem(PENDING_URL_KEY);
    if (pendingUrl) {
      this.addForm.patchValue({ url: pendingUrl });
      sessionStorage.removeItem(PENDING_URL_KEY);
    }
    void this.loadSites();
  }

  private async loadSites(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.sites.set(await this.api.listSites());
    } catch (e) {
      this.error.set(toApiError(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected submitAdd(): void {
    if (this.addForm.invalid || this.addBusy()) return;
    this.addBusy.set(true);
    this.addError.set(null);
    const { url } = this.addForm.getRawValue();
    this.api
      .createSite(url)
      .then(
        (created) => {
          this.sites.update((current) => [created, ...current]);
          this.addForm.reset();
        },
        (e: unknown) => this.addError.set(toApiError(e)),
      )
      .finally(() => this.addBusy.set(false));
  }

  protected checkSite(site: SiteDto): void {
    if (site.readOnly || this.busySiteId()) return;
    this.busySiteId.set(site.id);
    this.checkError.set(null);
    this.resent.set(false);
    this.api
      .submitAssessment(site.id)
      .then(
        async (assessment) => {
          try {
            await this.router.navigateByUrl(`/assessments/${assessment.id}/progress`);
          } catch {
            this.checkError.set(
              new ApiError('navigation_failed', 'The check started, but we could not open the progress page. Please try again.', 0),
            );
          }
        },
        (e: unknown) => this.checkError.set(toApiError(e)),
      )
      .finally(() => this.busySiteId.set(null));
  }

  protected seePlan(site: SiteDto): void {
    if (this.busySiteId()) return;
    this.busySiteId.set(site.id);
    this.checkError.set(null);
    this.resent.set(false);
    this.api
      .getPlanForSite(site.id)
      .then(
        async (plan) => {
          try {
            await this.router.navigateByUrl(`/assessments/${plan.assessmentId}/plan`);
          } catch {
            this.checkError.set(new ApiError('navigation_failed', 'We could not open the plan. Please try again.', 0));
          }
        },
        (e: unknown) => this.checkError.set(toApiError(e)),
      )
      .finally(() => this.busySiteId.set(null));
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.api
      .resendVerification()
      .then(
        () => this.resent.set(true),
        (e: unknown) => this.checkError.set(toApiError(e)),
      )
      .finally(() => this.resendBusy.set(false));
  }
}
