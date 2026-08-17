import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { ErrorNote } from '../../shared/error-note';

@Component({
  selector: 'app-reset-request',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  template: `
    <div class="page surface plain">
      @if (sent()) {
        <p>Check your email. If an account exists for that address, we sent a link to reset your password.</p>
        <p><a routerLink="/login">Log in</a></p>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()">
          <label>
            Email
            <input type="email" formControlName="email" autocomplete="email" />
          </label>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || form.invalid">Send reset link</button>
        </form>

        <app-error-note [error]="error()" />

        <p>Remembered your password? <a routerLink="/login">Log in</a></p>
      }
    </div>
  `,
})
export class ResetRequest {
  private api = inject(ApiClient);

  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly sent = signal(false);

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
  });

  protected submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { email } = this.form.getRawValue();
    this.api
      .requestPasswordReset(email)
      .then(
        () => this.sent.set(true),
        (e: unknown) => this.error.set(e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0)),
      )
      .finally(() => this.busy.set(false));
  }
}
