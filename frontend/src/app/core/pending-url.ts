import { PENDING_URL_KEY } from './config';

/** Shape of the value that savePendingUrl writes. */
interface PendingUrlRecord {
  url: string;
  savedAt: number;
}

/** Life of a saved url. It matches the life of the email verification token (AuthRoutes.kt:45). */
const PENDING_URL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Saves the url a visitor typed on the landing page. The value lives in localStorage, not
 * sessionStorage, so a new tab — such as the one the verification email opens — can read it too.
 */
export function savePendingUrl(url: string): void {
  try {
    const record: PendingUrlRecord = { url, savedAt: Date.now() };
    localStorage.setItem(PENDING_URL_KEY, JSON.stringify(record));
  } catch {
    // The browser may block storage access. The visitor can still type the url again.
  }
}

/**
 * Reads the saved url, and leaves it in place. Call clearPendingUrl once you use the value.
 * A value older than 24 hours is stale, so this function removes it and returns null.
 */
export function readPendingUrl(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_URL_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<PendingUrlRecord>;
    if (typeof record.url !== 'string' || typeof record.savedAt !== 'number') {
      localStorage.removeItem(PENDING_URL_KEY);
      return null;
    }
    if (Date.now() - record.savedAt > PENDING_URL_MAX_AGE_MS) {
      localStorage.removeItem(PENDING_URL_KEY);
      return null;
    }
    return record.url;
  } catch {
    return null;
  }
}

/** Removes the saved url. Call this once a caller has used the value from readPendingUrl. */
export function clearPendingUrl(): void {
  try {
    localStorage.removeItem(PENDING_URL_KEY);
  } catch {
    // The browser may block storage access. There is then nothing to remove.
  }
}
