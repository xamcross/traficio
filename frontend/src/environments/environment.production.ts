// Production values. The API runs on its own origin, so every call is absolute.
// The session cookie is same-site (app.<domain> and api.<domain> share one
// registrable domain), so SameSite=Lax works. Replace REPLACE_ME_DOMAIN before
// the first production deploy.
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.REPLACE_ME_DOMAIN',
  freemiusProductId: 'REPLACE_ME_FREEMIUS_PRODUCT_ID',
  freemiusPublicKey: 'REPLACE_ME_FREEMIUS_PUBLIC_KEY',
};
