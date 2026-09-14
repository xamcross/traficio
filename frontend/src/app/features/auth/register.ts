import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { API_BASE } from '../../core/config';
import { readPendingUrl } from '../../core/pending-url';
import { ErrorNote } from '../../shared/error-note';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  template: `
    <div class="page surface plain">
      @if (sent()) {
        <h1>Check your email.</h1>
        <p class="lead">We sent you a link. Click it to confirm your address, then log in and run your first check.</p>
        <p><a routerLink="/login">Log in</a></p>
      } @else {
        <h1>Create your free account</h1>
        <p class="lead">Your score and every finding stay free. We ask for a card only if you want the step-by-step plan.</p>
        @if (pendingDomain(); as domain) {
          <p class="muted">We will check {{ domain }} as soon as you are in.</p>
        }
        <form [formGroup]="form" (ngSubmit)="submit()">
          <label>
            Email
            <input type="email" formControlName="email" autocomplete="email" />
          </label>
          <label>
            Password
            <input type="password" formControlName="password" autocomplete="new-password" />
          </label>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || form.invalid">Create my free account</button>
        </form>

        @if (error(); as e) {
          @if (e.code === 'email_taken') {
            <p class="error-note" role="alert">
              You already have an account. <a routerLink="/login">Log in instead.</a>
            </p>
          } @else {
            <app-error-note [error]="e" />
          }
        }

        <p><a [href]="googleUrl">Continue with Google</a></p>
        <p>Already have an account? <a routerLink="/login">Log in</a></p>
      }
    </div>
  `,
})
export class Register {
  private api = inject(ApiClient);
  private platformId = inject(PLATFORM_ID);

  protected readonly googleUrl = `${API_BASE}/v1/auth/google/start`;
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  /**
   * The address the visitor typed on the landing page, if there is one. Naming
   * it here tells them the work they started is not lost. The dashboard reads
   * the same key back out after they log in, so this only displays it.
   */
  protected readonly pendingDomain = signal(this.readPendingDomain());

  private readPendingDomain(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const raw = readPendingUrl()?.trim();
    if (!raw) return null;
    return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || null;
  }
  protected readonly sent = signal(false);

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.api
      .register(email, password)
      .then(
        () => this.sent.set(true),
        (e: unknown) => this.error.set(e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0)),
      )
      .finally(() => this.busy.set(false));
  }
}
