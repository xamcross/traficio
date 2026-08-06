import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/guards';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/landing/landing').then(m => m.Landing) },
  { path: 'pricing', loadComponent: () => import('./features/pricing/pricing').then(m => m.Pricing) },
  { path: 'terms', loadComponent: () => import('./features/legal/terms').then(m => m.Terms) },
  { path: 'privacy', loadComponent: () => import('./features/legal/privacy').then(m => m.Privacy) },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login').then(m => m.Login) },
  { path: 'signup', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register').then(m => m.Register) },
  { path: 'verify-email', loadComponent: () => import('./features/auth/verify-email').then(m => m.VerifyEmail) },
  { path: 'auth/complete', loadComponent: () => import('./features/auth/auth-complete').then(m => m.AuthComplete) },
  { path: 'reset-password', canActivate: [guestGuard], loadComponent: () => import('./features/auth/reset-request').then(m => m.ResetRequest) },
  { path: 'reset-password/confirm', loadComponent: () => import('./features/auth/reset-confirm').then(m => m.ResetConfirm) },
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./features/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'assessments/:id/progress', canActivate: [authGuard], loadComponent: () => import('./features/progress/progress').then(m => m.Progress) },
  { path: 'assessments/:id/report', canActivate: [authGuard], loadComponent: () => import('./features/report/report').then(m => m.Report) },
  { path: 'assessments/:id/plan', canActivate: [authGuard], loadComponent: () => import('./features/plan/plan').then(m => m.Plan) },
  { path: 'sites/:siteId/history', canActivate: [authGuard], loadComponent: () => import('./features/history/history').then(m => m.History) },
  { path: 'account', canActivate: [authGuard], loadComponent: () => import('./features/account/account').then(m => m.Account) },
  { path: '**', redirectTo: '' },
];
