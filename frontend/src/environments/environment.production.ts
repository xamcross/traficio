// Production values. The API runs on its own origin, so every call is absolute.
// The session cookie is same-site (the site host and api.<domain> share one
// registrable domain), so SameSite=Lax works.
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.traficio.com',
  // The origin this app is served from. Canonical links, the structured data,
  // the sitemap, and the robots.txt Sitemap line all read this one value.
  siteOrigin: 'https://traficio.com',
  freemiusProductId: '39459',
  freemiusPublicKey: 'pk_224e5d326818b1a88085dbebba864',
};
