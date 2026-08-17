import { Injectable, signal } from '@angular/core';

/** The domain of the site the current page is about. The header shows it. */
@Injectable({ providedIn: 'root' })
export class SiteContext {
  readonly domain = signal<string | null>(null);
  set(domain: string | null): void { this.domain.set(domain); }
  clear(): void { this.domain.set(null); }
}
