import { PENDING_URL_KEY } from './config';
import { clearPendingUrl, readPendingUrl, savePendingUrl } from './pending-url';

describe('pending-url', () => {
  beforeEach(() => localStorage.removeItem(PENDING_URL_KEY));
  afterEach(() => localStorage.removeItem(PENDING_URL_KEY));

  it('reads back a url that savePendingUrl just saved, in localStorage rather than sessionStorage', () => {
    savePendingUrl('rivertonbakery.com');
    expect(readPendingUrl()).toBe('rivertonbakery.com');
    expect(sessionStorage.getItem(PENDING_URL_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_URL_KEY)).not.toBeNull();
  });

  it('returns null, and removes the key, for a value older than 24 hours', () => {
    const stale = { url: 'rivertonbakery.com', savedAt: Date.now() - (24 * 60 * 60 * 1000 + 1) };
    localStorage.setItem(PENDING_URL_KEY, JSON.stringify(stale));
    expect(readPendingUrl()).toBeNull();
    expect(localStorage.getItem(PENDING_URL_KEY)).toBeNull();
  });

  it('returns a value saved just under 24 hours ago', () => {
    const fresh = { url: 'rivertonbakery.com', savedAt: Date.now() - (24 * 60 * 60 * 1000 - 1000) };
    localStorage.setItem(PENDING_URL_KEY, JSON.stringify(fresh));
    expect(readPendingUrl()).toBe('rivertonbakery.com');
  });

  it('returns null when there is no saved url', () => {
    expect(readPendingUrl()).toBeNull();
  });

  it('does not remove a value that is not stale, so a second reader can also read it', () => {
    savePendingUrl('rivertonbakery.com');
    expect(readPendingUrl()).toBe('rivertonbakery.com');
    expect(readPendingUrl()).toBe('rivertonbakery.com');
  });

  it('clearPendingUrl removes a saved url', () => {
    savePendingUrl('rivertonbakery.com');
    clearPendingUrl();
    expect(readPendingUrl()).toBeNull();
  });
});
