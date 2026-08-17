// Production values. The API runs on its own origin, so every call is absolute.
// The session cookie is same-site (app.<domain> and api.<domain> share one
// registrable domain), so SameSite=Lax works.
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.traficio.com',
  freemiusProductId: 'REPLACE_ME_FREEMIUS_PRODUCT_ID',
  freemiusPublicKey: 'REPLACE_ME_FREEMIUS_PUBLIC_KEY',
};
