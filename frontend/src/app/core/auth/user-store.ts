import { inject, Injectable, signal } from '@angular/core';
import { ApiClient } from '../api/api-client';
import { UserDto } from '../api/types';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private api = inject(ApiClient);
  readonly user = signal<UserDto | null>(null);
  readonly loaded = signal(false);

  async refresh(): Promise<void> {
    try { this.user.set(await this.api.me()); }
    catch { this.user.set(null); }
    finally { this.loaded.set(true); }
  }
  clear(): void { this.user.set(null); this.loaded.set(true); }
}
