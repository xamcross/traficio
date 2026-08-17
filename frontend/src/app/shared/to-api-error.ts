import { ApiError } from '../core/api/api-client';

/** Normalises any thrown value into an ApiError so templates can branch on `code`. */
export function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', 0);
}
