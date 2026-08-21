import { Component, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
    // Only the browser has a session cookie to send, and pre-rendering must
    // not call the live API at build time, so this stays out of the server.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      void this.userStore.refresh();
    }
  }
}
