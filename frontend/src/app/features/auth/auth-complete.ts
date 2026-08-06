import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { UserStore } from '../../core/auth/user-store';

@Component({
  selector: 'app-auth-complete',
  template: `<p>One moment…</p>`,
})
export class AuthComplete {
  private store = inject(UserStore);
  private router = inject(Router);

  constructor() {
    this.store.refresh().then(() => this.router.navigateByUrl(this.store.user() ? '/dashboard' : '/login'));
  }
}
