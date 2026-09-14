import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, TitleStrategy, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { credentialsInterceptor } from './core/api/credentials.interceptor';
import { unauthenticatedInterceptor } from './core/api/unauthenticated.interceptor';
import { PageTitleStrategy } from './core/seo/page-title-strategy';
import { reloadOnStaleChunk } from './core/stale-chunk-reload';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withNavigationErrorHandler(reloadOnStaleChunk)),
    provideHttpClient(withInterceptors([credentialsInterceptor, unauthenticatedInterceptor])),
    provideClientHydration(withEventReplay()),
    { provide: TitleStrategy, useClass: PageTitleStrategy },
  ]
};
