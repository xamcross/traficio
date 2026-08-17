import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../core/api/api-client';
import { API_BASE } from '../../core/config';
import { UserStore } from '../../core/auth/user-store';
import { ErrorNote } from '../../shared/error-note';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, ErrorNote],
  template: `
    <div class="page surface plain">
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label>
          Email
          <input type="email" formControlName="email" autocomplete="email" />
        </label>
        <label>
          Password
          <input type="password" formControlName="password" autocomplete="current-password" />
        </label>
        <button type="submit" class="btn btn-primary" [disabled]="busy() || form.invalid">Log in</button>
      </form>

      <app-error-note [error]="error()" />

      <p><a [href]="googleUrl">Continue with Google</a></p>
      <p>New here? <a routerLink="/signup">Create an account</a></p>
      <p><a routerLink="/reset-password">Forgot your password?</a></p>
    </div>
  `,
})
export class Login {
  private api = inject(ApiClient);
  private store = inject(UserStore);
  private router = inject(Router);

  protected readonly googleUrl = `${API_BASE}/v1/auth/google/start`;
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);

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
      .login(email, password)
      .then(
        async () => {
          await this.store.refresh();
          try {
            await this.router.navigateByUrl('/dashboard');
          } catch {
            this.error.set(new ApiError('navigation_failed', 'You are logged in, but we could not open the dashboard. Please try again.', 0));
          }
        },
        (e: unknown) => this.error.set(e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0)),
      )
      .finally(() => this.busy.set(false));
  }
}
