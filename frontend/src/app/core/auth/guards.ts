import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserStore } from './user-store';

export const authGuard: CanActivateFn = async () => {
  const store = inject(UserStore); const router = inject(Router);
  if (!store.loaded()) await store.refresh();
  return store.user() ? true : router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = async () => {
  const store = inject(UserStore); const router = inject(Router);
  if (!store.loaded()) await store.refresh();
  return store.user() ? router.createUrlTree(['/dashboard']) : true;
};
