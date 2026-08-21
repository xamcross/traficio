import { RenderMode, ServerRoute } from '@angular/ssr';

// Only these four public paths render at build time. Every other route needs
// a runtime token or a signed-in user, so it stays client-rendered. List each
// path so a future route is never pre-rendered by accident.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'terms', renderMode: RenderMode.Prerender },
  { path: 'privacy', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
