import { environment } from '../../environments/environment';

// The API origin. Empty in dev (same origin through the dev proxy). Absolute in prod.
export const API_BASE = environment.apiBaseUrl;
export const FREEMIUS_PRODUCT_ID = environment.freemiusProductId;
export const FREEMIUS_PUBLIC_KEY = environment.freemiusPublicKey;
// localStorage key for the URL a visitor types on the landing page. A visitor types the
// URL before they sign up or log in. The dashboard reads the value after login. It then
// starts the first check for that URL. See core/pending-url.ts for the functions for this
// key.
export const PENDING_URL_KEY = 'geostrategy.pendingUrl';

/** Shown price. Freemius bills the real price; keep the two equal (launch checklist 8.1a). */
export const PRO_PRICE_LABEL = '$9';
/** Tier numbers used in copy. Keep equal to the backend env values (launch checklist 8.1a). */
export const FREE_TIER_COPY = { sites: 1, checks: 1 };
export const PRO_TIER_COPY = { sites: 5, checks: 10 };
