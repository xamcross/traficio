import { environment } from '../../environments/environment';

// The API origin. Empty in dev (same origin through the dev proxy). Absolute in prod.
export const API_BASE = environment.apiBaseUrl;
export const FREEMIUS_PRODUCT_ID = environment.freemiusProductId;
export const FREEMIUS_PUBLIC_KEY = environment.freemiusPublicKey;
export const FREEMIUS_PORTAL_URL = 'https://users.freemius.com'; // customer portal entry
// sessionStorage key for the URL a visitor typed on the landing page before signing up or
// logging in; the dashboard reads it back out to pick up where that flow left off.
export const PENDING_URL_KEY = 'geostrategy.pendingUrl';

/** Shown price. Freemius bills the real price; keep the two equal (launch checklist 7.1a). */
export const PRO_PRICE_LABEL = '$9';
/** Tier numbers used in copy. Keep equal to the backend env values (launch checklist 7.1a). */
export const FREE_TIER_COPY = { sites: 1, checks: 1 };
export const PRO_TIER_COPY = { sites: 5, checks: 10 };
