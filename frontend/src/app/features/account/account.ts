import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { UserStore } from '../../core/auth/user-store';
import { UsageDto } from '../../core/api/types';
import { FREEMIUS_PORTAL_URL } from '../../core/config';
import { ErrorNote } from '../../shared/error-note';

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0);
}

@Component({
  selector: 'app-account',
  imports: [RouterLink, ErrorNote],
  templateUrl: './account.html',
})
export class Account implements OnInit {
  private api = inject(ApiClient);
  private router = inject(Router);
  protected readonly store = inject(UserStore);

  protected readonly portalUrl = FREEMIUS_PORTAL_URL;

  protected readonly usage = signal<UsageDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);

  protected readonly resent = signal(false);
  protected readonly resendBusy = signal(false);
  protected readonly resendError = signal<ApiError | null>(null);

  ngOnInit(): void {
    void this.loadUsage();
  }

  private async loadUsage(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.usage.set(await this.api.usage());
    } catch (e) {
      this.error.set(toApiError(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected resend(): void {
    if (this.resendBusy()) return;
    this.resendBusy.set(true);
    this.resendError.set(null);
    this.api
      .resendVerification()
      .then(
        () => this.resent.set(true),
        (e: unknown) => this.resendError.set(toApiError(e)),
      )
      .finally(() => this.resendBusy.set(false));
  }

  protected async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // The server call failed (network error, 5xx, etc.) — the server session
      // either got revoked already or will expire on its own; swallow the
      // failure so it doesn't surface as an unhandled rejection.
    } finally {
      // The client must always drop its local state, even if the call failed.
      this.store.clear();
      await this.router.navigateByUrl('/');
    }
  }
}
