import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { ErrorNote } from '../../shared/error-note';

@Component({
  selector: 'app-verify-email',
  imports: [RouterLink, ErrorNote],
  template: `
    <div class="page surface plain">
      @if (busy()) {
        <p>Checking your link…</p>
      } @else if (verified()) {
        <p>Your email is confirmed. You can log in now.</p>
        <p><a routerLink="/login">Log in</a></p>
      } @else if (error(); as e) {
        @if (e.code === 'invalid_token') {
          <p class="error-note" role="alert">This link does not work. It may be old. Log in and send a new link.</p>
          <p><a routerLink="/login">Log in</a></p>
        } @else {
          <app-error-note [error]="e" />
          <p><a routerLink="/login">Log in</a></p>
        }
      }
    </div>
  `,
})
export class VerifyEmail {
  private api = inject(ApiClient);
  private route = inject(ActivatedRoute);

  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly verified = signal(false);

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.error.set(
        new ApiError('missing_token', 'This link is missing information. Log in and send a new link.', 0),
      );
      return;
    }

    this.busy.set(true);
    this.api
      .verifyEmail(token)
      .then(
        () => this.verified.set(true),
        (e: unknown) => this.error.set(e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0)),
      )
      .finally(() => this.busy.set(false));
  }
}
