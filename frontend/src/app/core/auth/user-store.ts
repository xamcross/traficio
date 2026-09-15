import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiClient } from '../api/api-client';
import { UserDto } from '../api/types';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private api = inject(ApiClient);
  readonly user = signal<UserDto | null>(null);
  readonly loaded = signal(false);
  // Holds the one call to GET /v1/me while it runs.
  // A second refresh() call returns this promise instead of a new request.
  private inFlight: Promise<void> | null = null;

  constructor() {
    // A billing webhook, or a sign-out in another tab, can change the session while this
    // tab sits in the background. Catch up as soon as the visitor looks at this tab again.
    // The server has no tab to become visible. It must not call the live API at build time.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void this.refresh();
      };
      document.addEventListener('visibilitychange', onVisible);
      inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
    }
  }

  async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchUser();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async fetchUser(): Promise<void> {
    try { this.user.set(await this.api.me()); }
    catch { this.user.set(null); }
    finally { this.loaded.set(true); }
  }

  clear(): void { this.user.set(null); this.loaded.set(true); }
}
