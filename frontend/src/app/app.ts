import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UserStore } from './core/auth/user-store';
import { SiteContext } from './core/site-context';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly userStore = inject(UserStore);
  protected readonly siteContext = inject(SiteContext);

  constructor() {
    // Fire-and-forget: settles the header's auth state on load.
    void this.userStore.refresh();
  }
}
