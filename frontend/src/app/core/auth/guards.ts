import { inject } from '@angular/core';
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
