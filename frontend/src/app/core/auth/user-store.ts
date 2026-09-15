import { inject, Injectable, signal } from '@angular/core';
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
