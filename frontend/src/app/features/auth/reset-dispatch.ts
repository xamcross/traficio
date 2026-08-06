import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserStore } from '../../core/auth/user-store';
import { ResetRequest } from './reset-request';

/**
 * Dispatcher for `/reset-password`. The password-reset email (see backend
 * Emails.kt#resetEmailHtml) always links here with `?token=...`; a token means "confirm a new
 * password" and must go to ResetConfirm, preserving the query params, even for a signed-in
 * visitor. No token means "ask for a reset email" - the plain request form, which stays guarded
 * like login/signup so a signed-in visitor lands on the dashboard instead. That guard check only
 * runs on the no-token path, so a token can never be swallowed by it.
 */
@Component({
  selector: 'app-reset-dispatch',
  imports: [ResetRequest],
  template: `@if (showRequest()) {
    <app-reset-request />
  }`,
})
export class ResetDispatch implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userStore = inject(UserStore);

  protected readonly showRequest = signal(false);

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) {
      await this.router.navigate(['/reset-password/confirm'], {
        queryParams: this.route.snapshot.queryParams,
        replaceUrl: true,
      });
      return;
    }

    if (!this.userStore.loaded()) await this.userStore.refresh();
    if (this.userStore.user()) {
      await this.router.navigateByUrl('/dashboard');
      return;
    }
    this.showRequest.set(true);
  }
}
