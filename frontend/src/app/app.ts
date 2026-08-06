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
    await this.api.logout();
    this.userStore.clear();
    await this.router.navigateByUrl('/');
  }
}
