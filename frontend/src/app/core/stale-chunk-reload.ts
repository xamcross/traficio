import { InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationError } from '@angular/router';

export const STALE_CHUNK_RELOAD_KEY = 'traficio.staleChunkReloadAt';

/** A second failure in this time after a reload does not reload again. */
const RELOAD_GUARD_MS = 10_000;

/** Chrome, Firefox and Safari use different words for a failed lazy import. */
const CHUNK_LOAD_FAILURE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** Loads a URL as a new document. A test replaces it, so the test page does not reload. */
export const PAGE_LOADER = new InjectionToken<(url: string) => void>('PAGE_LOADER', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_FAILURE.test(error.message);
}

/**
 * A deploy removes the lazy chunks of the previous build. A tab that stays open across a deploy
 * still runs the old main bundle, so its next lazy route asks for a chunk that answers 404.
 * The handler loads the target URL as a new document, and that document boots the current build.
 * A broken deploy fails again after the reload. The guard then stops a reload loop.
 */
export function reloadOnStaleChunk(event: NavigationError): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID)) || !isChunkLoadError(event.error)) return;
  const now = Date.now();
  try {
    if (now - Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) < RELOAD_GUARD_MS) return;
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Without storage there is no loop guard. Keep the page.
    return;
  }
  inject(PAGE_LOADER)(event.url);
}
