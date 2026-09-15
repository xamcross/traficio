import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { UserStore } from '../auth/user-store';

/**
 * Sends a signed-in user to the login page after a 401 response.
 * A visitor with no session also gets a 401 on each page load.
 * The interceptor must ignore that case. It acts only when a user is signed in.
 */
export const unauthenticatedInterceptor: HttpInterceptorFn = (req, next) => {
  const userStore = inject(UserStore);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && userStore.user() !== null) {
        userStore.clear();
        void router.navigateByUrl('/login');
      }
      // Rethrow the error. The caller still needs it, to build its ApiError.
      return throwError(() => error);
    }),
  );
};
