import { ApiError } from '../core/api/api-client';

/**
 * Shared copy for assessment-submission errors (quota, upgrade, read-only, unverified email).
 * Used by both the dashboard's "Check my site" flow and the history page's "Check again" flow
 * so the two surfaces never drift apart.
 */
export function assessmentErrorCopy(e: ApiError): string {
  switch (e.code) {
    case 'email_not_verified':
      return 'Confirm your email first. Click the link in the email we sent you.';
    case 'quota_exceeded':
      return e.message;
    case 'upgrade_required':
      return 'Re-checks are part of Pro. Upgrade to check this site again.';
    case 'site_read_only':
      return 'Your plan covers fewer sites than you have, so this one is locked.';
    default:
      return e.message || 'Something went wrong. Please try again.';
  }
}
