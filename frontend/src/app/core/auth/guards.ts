import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { UserStore } from './user-store';

export const authGuard: CanActivateFn = async () => {
  const store = inject(UserStore); const router = inject(Router);
  // Already loaded: decide from the current signal. Refresh in the background.
  // A webhook, or another tab, may have changed the tier or the session.
  // This navigation does not wait for that refresh.
  if (store.loaded()) void store.refresh();
  else await store.refresh();
  return store.user() ? true : router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = async () => {
  const store = inject(UserStore); const router = inject(Router);
  if (store.loaded()) void store.refresh();
  else await store.refresh();
  return store.user() ? router.createUrlTree(['/dashboard']) : true;
};

/** Guards the root path. The route pre-renders at build time, so on the
 *  server it must not call /v1/me — it always returns true there. */
export const rootGuard: CanActivateFn = async () => {
  if (isPlatformServer(inject(PLATFORM_ID))) return true;
  const store = inject(UserStore); const router = inject(Router);
  if (!store.loaded()) await store.refresh();
  return store.user() ? router.createUrlTree(['/dashboard']) : true;
};
