import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { API_BASE } from '../../core/config';
import { ErrorNote } from '../../shared/error-note';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  template: `
    @if (sent()) {
      <p>Check your email. We sent you a link. Click the link to confirm your address.</p>
      <p><a routerLink="/login">Log in</a></p>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label>
          Email
          <input type="email" formControlName="email" autocomplete="email" />
        </label>
        <label>
          Password
          <input type="password" formControlName="password" autocomplete="new-password" />
        </label>
        <button type="submit" [disabled]="busy() || form.invalid">Create account</button>
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
  `,
})
export class Register {
  private api = inject(ApiClient);

  protected readonly googleUrl = `${API_BASE}/v1/auth/google/start`;
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
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
