import { Routes } from '@angular/router';
import { authGuard, guestGuard, rootGuard } from './core/auth/guards';

// The title and the data.description on each route feed the PageTitleStrategy
// (see core/seo/page-title-strategy.ts). The ten public routes below also
// render at build time (see app.routes.server.ts), so this exact copy is
// baked into the pre-rendered HTML — keep it in sync with any copy change.
export const routes: Routes = [
  {
    path: '',
    title: 'AI visibility check for your website | Traficio',
    data: {
      description:
        'See how findable your website is in Google, answer boxes and AI assistants like ChatGPT. Get your score and every problem we find, free. No card needed.',
    },
    canActivate: [rootGuard],
    loadComponent: () => import('./features/landing/landing').then(m => m.Landing),
  },
  {
    path: 'pricing',
    title: 'Pricing: free score, $9 plan | Traficio',
    data: {
      description:
        'Your score and findings are always free. Pro is $9 a month for the step-by-step plan, the re-check that confirms each fix, and your score history.',
    },
    loadComponent: () => import('./features/pricing/pricing').then(m => m.Pricing),
  },
  {
    path: 'terms',
    title: 'Terms of service | Traficio',
    data: {
      description: 'The terms of service for Traficio, including your account, acceptable use, payment and cancellation.',
    },
    loadComponent: () => import('./features/legal/terms').then(m => m.Terms),
  },
  {
    path: 'privacy',
    title: 'Privacy policy | Traficio',
    data: {
      description:
        'How Traficio handles your data: what we collect, why we collect it, how long we keep it, and how to ask us to delete it.',
    },
    loadComponent: () => import('./features/legal/privacy').then(m => m.Privacy),
  },
  {
    path: 'guides',
    title: 'Guides | Traficio',
    data: {
      description:
        'Plain-language guides on SEO, AI visibility and being found by Google and AI assistants like ChatGPT, written for people who run one website.',
    },
    loadComponent: () => import('./features/guides/guides-index').then(m => m.GuidesIndex),
  },
  {
    path: 'guides/why-ai-cannot-find-your-website',
    title: 'Why AI cannot find your website | Traficio',
    data: {
      description:
        'AI assistants read raw HTML, not your JavaScript. See why ChatGPT, Claude and Perplexity can miss your business, and what to check first.',
    },
    loadComponent: () =>
      import('./features/guides/why-ai-cannot-find-your-website').then(m => m.WhyAiCannotFindYourWebsite),
  },
  {
    path: 'guides/what-seo-costs-a-small-business',
    title: 'What SEO costs a small business | Traficio',
    data: {
      description:
        'Agencies commonly quote $1,000 to $5,000 a month for SEO. What that buys, what you can do free, and where a $9 tool fits.',
    },
    loadComponent: () =>
      import('./features/guides/what-seo-costs-a-small-business').then(m => m.WhatSeoCostsASmallBusiness),
  },
  {
    path: 'guides/geo-aeo-and-ai-visibility-explained',
    title: 'GEO, AEO and AI visibility explained | Traficio',
    data: {
      description:
        'SEO, AEO and GEO explained in plain language: being found, being the answer, and being mentioned by AI. What each term really means.',
    },
    loadComponent: () =>
      import('./features/guides/geo-aeo-and-ai-visibility-explained').then(m => m.GeoAeoAndAiVisibilityExplained),
  },
  {
    path: 'guides/is-your-site-readable-by-chatgpt',
    title: 'Is your site readable by ChatGPT? | Traficio',
    data: {
      description:
        'A step-by-step way to see your site the way ChatGPT sees it, plus what GPTBot, ClaudeBot and PerplexityBot each do.',
    },
    loadComponent: () =>
      import('./features/guides/is-your-site-readable-by-chatgpt').then(m => m.IsYourSiteReadableByChatgpt),
  },
  {
    path: 'guides/the-beginners-seo-checklist',
    title: "The beginner's SEO checklist | Traficio",
    data: {
      description:
        'A start-to-finish SEO checklist for a small business website: titles, descriptions, content, contact details, sitemap and images.',
    },
    loadComponent: () =>
      import('./features/guides/the-beginners-seo-checklist').then(m => m.TheBeginnersSeoChecklist),
  },
  {
    path: 'login',
    title: 'Log in | Traficio',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then(m => m.Login),
  },
  {
    path: 'signup',
    title: 'Create your free account | Traficio',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register').then(m => m.Register),
  },
  {
    path: 'verify-email',
    title: 'Confirm your email | Traficio',
    loadComponent: () => import('./features/auth/verify-email').then(m => m.VerifyEmail),
  },
  {
    path: 'auth/complete',
    title: 'One moment | Traficio',
    loadComponent: () => import('./features/auth/auth-complete').then(m => m.AuthComplete),
  },
  {
    path: 'reset-password',
    title: 'Reset your password | Traficio',
    loadComponent: () => import('./features/auth/reset-dispatch').then(m => m.ResetDispatch),
  },
  {
    path: 'reset-password/confirm',
    title: 'Set a new password | Traficio',
    loadComponent: () => import('./features/auth/reset-confirm').then(m => m.ResetConfirm),
  },
  {
    path: 'dashboard',
    title: 'Your dashboard | Traficio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard').then(m => m.Dashboard),
  },
  {
    path: 'assessments/:id/progress',
    title: 'Site check progress | Traficio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/progress/progress').then(m => m.Progress),
  },
  {
    path: 'assessments/:id/report',
    title: 'Your site report | Traficio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/report/report').then(m => m.Report),
  },
  {
    path: 'assessments/:id/plan',
    title: 'Your action plan | Traficio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/plan/plan').then(m => m.Plan),
  },
  {
    path: 'sites/:siteId',
    title: 'Site overview | Traficio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/site-home/site-home').then(m => m.SiteHome),
  },
  {
    path: 'sites/:siteId/history',
    title: 'Score history | Traficio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/history/history').then(m => m.History),
  },
  {
    path: 'account',
    title: 'Your account | Traficio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/account/account').then(m => m.Account),
  },
  { path: '**', redirectTo: '' },
];
