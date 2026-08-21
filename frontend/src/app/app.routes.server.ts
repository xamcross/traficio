import { RenderMode, ServerRoute } from '@angular/ssr';

// Only these ten public paths render at build time. Every other route needs
// a runtime token or a signed-in user, so it stays client-rendered. List each
// path so a future route is never pre-rendered by accident.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'terms', renderMode: RenderMode.Prerender },
  { path: 'privacy', renderMode: RenderMode.Prerender },
  { path: 'guides', renderMode: RenderMode.Prerender },
  { path: 'guides/why-ai-cannot-find-your-website', renderMode: RenderMode.Prerender },
  { path: 'guides/what-seo-costs-a-small-business', renderMode: RenderMode.Prerender },
  { path: 'guides/geo-aeo-and-ai-visibility-explained', renderMode: RenderMode.Prerender },
  { path: 'guides/is-your-site-readable-by-chatgpt', renderMode: RenderMode.Prerender },
  { path: 'guides/the-beginners-seo-checklist', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
