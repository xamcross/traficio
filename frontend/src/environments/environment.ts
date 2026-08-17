// Development values. `ng serve`, `ng test`, and the Playwright suite use this file.
// The production build replaces it with environment.production.ts (see angular.json).
// Nothing in this file is secret. Every value ships to every browser.
export const environment = {
  production: false,
  // Empty string = same origin. The dev server proxies /v1 and /healthz to
  // localhost:8080 (proxy.conf.json).
  apiBaseUrl: '',
  freemiusProductId: 'REPLACE_ME_FREEMIUS_PRODUCT_ID',
  freemiusPublicKey: 'REPLACE_ME_FREEMIUS_PUBLIC_KEY',
};
