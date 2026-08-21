import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/guards';

// The title and the data.description on each route feed the PageTitleStrategy
// (see core/seo/page-title-strategy.ts). The four public routes below also
// render at build time (see app.routes.server.ts), so this exact copy is
// baked into the pre-rendered HTML — keep it in sync with any copy change.
export const routes: Routes = [
  {
    path: '',
    title: 'AI visibility check for your website | GeoStrategy',
    data: {
      description:
        'See how findable your website is in Google, answer boxes and AI assistants like ChatGPT. Get your score and every problem we find, free. No card needed.',
    },
    loadComponent: () => import('./features/landing/landing').then(m => m.Landing),
  },
  {
    path: 'pricing',
    title: 'Pricing: free score, $9 plan | GeoStrategy',
    data: {
      description:
        'Your score and findings are always free. Pro is $9 a month for the step-by-step plan, the re-check that confirms each fix, and your score history.',
    },
    loadComponent: () => import('./features/pricing/pricing').then(m => m.Pricing),
  },
  {
    path: 'terms',
    title: 'Terms of service | GeoStrategy',
    data: {
      description: 'The terms of service for GeoStrategy, including your account, acceptable use, payment and cancellation.',
    },
    loadComponent: () => import('./features/legal/terms').then(m => m.Terms),
  },
  {
    path: 'privacy',
    title: 'Privacy policy | GeoStrategy',
    data: {
      description:
        'How GeoStrategy handles your data: what we collect, why we collect it, how long we keep it, and how to ask us to delete it.',
    },
    loadComponent: () => import('./features/legal/privacy').then(m => m.Privacy),
  },
  {
    path: 'login',
    title: 'Log in | GeoStrategy',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then(m => m.Login),
  },
  {
    path: 'signup',
    title: 'Create your account | GeoStrategy',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register').then(m => m.Register),
  },
  {
    path: 'verify-email',
    title: 'Confirm your email | GeoStrategy',
    loadComponent: () => import('./features/auth/verify-email').then(m => m.VerifyEmail),
  },
  {
    path: 'auth/complete',
    title: 'One moment | GeoStrategy',
    loadComponent: () => import('./features/auth/auth-complete').then(m => m.AuthComplete),
  },
  {
    path: 'reset-password',
    title: 'Reset your password | GeoStrategy',
    loadComponent: () => import('./features/auth/reset-dispatch').then(m => m.ResetDispatch),
  },
  {
    path: 'reset-password/confirm',
    title: 'Set a new password | GeoStrategy',
    loadComponent: () => import('./features/auth/reset-confirm').then(m => m.ResetConfirm),
  },
  {
    path: 'dashboard',
    title: 'Your dashboard | GeoStrategy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard').then(m => m.Dashboard),
  },
  {
    path: 'assessments/:id/progress',
    title: 'Site check progress | GeoStrategy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/progress/progress').then(m => m.Progress),
  },
  {
    path: 'assessments/:id/report',
    title: 'Your site report | GeoStrategy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/report/report').then(m => m.Report),
  },
  {
    path: 'assessments/:id/plan',
    title: 'Your action plan | GeoStrategy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/plan/plan').then(m => m.Plan),
  },
  {
    path: 'sites/:siteId',
    title: 'Site overview | GeoStrategy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/site-home/site-home').then(m => m.SiteHome),
  },
  {
    path: 'sites/:siteId/history',
    title: 'Score history | GeoStrategy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/history/history').then(m => m.History),
  },
  {
    path: 'account',
    title: 'Your account | GeoStrategy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/account/account').then(m => m.Account),
  },
  { path: '**', redirectTo: '' },
];
