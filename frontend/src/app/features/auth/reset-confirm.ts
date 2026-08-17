import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { ErrorNote } from '../../shared/error-note';

@Component({
  selector: 'app-reset-confirm',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  template: `
    <div class="page surface plain">
      @if (done()) {
        <p>Your password is changed. Log in with the new password.</p>
        <p><a routerLink="/login">Log in</a></p>
      } @else if (!token) {
        <app-error-note [error]="error()" />
        <p><a routerLink="/reset-password">Send a new link</a></p>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()">
          <label>
            New password
            <input type="password" formControlName="password" autocomplete="new-password" />
          </label>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || form.invalid">Change password</button>
        </form>

        <app-error-note [error]="error()" />
      }
    </div>
  `,
})
export class ResetConfirm {
  private api = inject(ApiClient);
  private route = inject(ActivatedRoute);

  protected readonly token: string | null;
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly done = signal(false);

  protected readonly form = new FormGroup({
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    this.token = this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      this.error.set(
        new ApiError('missing_token', 'This link is missing information. Send a new link.', 0),
      );
    }
  }

  protected submit(): void {
    if (this.form.invalid || this.busy() || !this.token) return;
    this.busy.set(true);
    this.error.set(null);
    const { password } = this.form.getRawValue();
    this.api
      .confirmPasswordReset(this.token, password)
      .then(
        () => this.done.set(true),
        (e: unknown) => this.error.set(e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0)),
      )
      .finally(() => this.busy.set(false));
  }
}
