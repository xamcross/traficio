import { ApiError } from '../core/api/api-client';

/** The plan gate lives on /pricing. With a site id the gate shows that site's locked plan. */
export function pricingUrlFor(siteId?: string | null): string {
  return siteId ? `/pricing?site=${encodeURIComponent(siteId)}` : '/pricing';
}

export function isUpgradeRequired(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'upgrade_required';
}
