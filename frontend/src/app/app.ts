import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { ApiClient } from './core/api/api-client';
import { UserStore } from './core/auth/user-store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private api = inject(ApiClient);
  private router = inject(Router);
  protected readonly userStore = inject(UserStore);

  constructor() {
    // Fire-and-forget: settles the header's auth state on load.
    void this.userStore.refresh();
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
      this.userStore.clear();
      await this.router.navigateByUrl('/');
    }
  }
}
