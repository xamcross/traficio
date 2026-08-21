# Preview endpoint security fixes: report

This report lists the nine findings from the security review of `POST /v1/preview`.
For each finding, it states the fix and the test evidence.

## 1. The rate-limit key was the Cloudflare edge IP

File: `backend/src/main/kotlin/app/geostrategy/preview/PreviewRoutes.kt`,
function `previewClientAddress`.

The function now reads headers in this order: `CF-Connecting-IP`, then
`Fly-Client-IP`, then the right-most `X-Forwarded-For` entry, then
`request.local.remoteAddress`. Cloudflare sets `CF-Connecting-IP` to the real
visitor address, and a caller cannot forge that header past Cloudflare. A
comment on the function records this reasoning, and states why
`Fly-Client-IP` stays second: it is correct only for a caller who goes
straight to the Fly hostname.

Test: `CF-Connecting-IP outranks Fly-Client-IP for the rate limit key`, in
`PreviewRoutesTest.kt`. Three visitors share one `Fly-Client-IP` (one
simulated Cloudflare edge) but use distinct `CF-Connecting-IP` values. The
test proves each visitor gets an independent quota.

## 2. A caller who bypassed Cloudflare defeated the limit

Files: `PreviewRateLimiter.kt` (the new `rateLimitKey` helper),
`PreviewRoutes.kt` (the header order from finding 1).

`PreviewRateLimiter.recordAttempt` now masks the caller address with
`rateLimitKey` before it builds the bucket id. An IPv4 address passes
through unchanged. An IPv6 address is masked to its `/64` network prefix, by
hand: the function parses the text into eight 16-bit groups, zeroes the
last four groups, and reassembles the result with
`InetAddress.getByAddress`, which never performs a DNS lookup. A caller
inside one `/64` now shares one bucket, instead of getting close to `2^64`
separate buckets.

I did not add the shared-secret header; the task said that stays with the
requester, on the Cloudflare side.

Tests:
- `PreviewRateLimiterTest.kt`: five pure unit tests on `rateLimitKey` alone —
  same `/64` masks to the same key, a different `/64` masks to a different
  key, an IPv4 address passes through, a non-IPv6 string passes through, and
  hex case does not change the result.
- `two IPv6 addresses in the same slash-64 share one rate limit bucket`, in
  `PreviewRoutesTest.kt`. Three requests from two different addresses inside
  one `/64` use up the shared quota; the fourth gets 429. A request from a
  different `/64` still has a full quota.

## 3. No request-body cap and no URL length cap

Files: `assessment/UrlValidation.kt` (`normalizeUrl`),
`preview/PreviewRoutes.kt` (`receivePreviewRequest`).

`normalizeUrl` now rejects a `url` over 2048 characters as its first check,
before any parsing, with a 400 and code `invalid_url`.

The preview route no longer calls `call.receive<PreviewRequest>()`. A new
`receivePreviewRequest` function checks `Content-Length` first, then reads
the body through `receiveChannel().readRemaining(4097)`, so the route never
buffers more than a few kilobytes in memory regardless of what a caller
claims or sends. A body over 4096 bytes gets a 400 with code
`invalid_request`. This cap is local to the preview route; no other route
changed.

Tests:
- `normalizeUrl rejects a url over 2048 characters, as the first check`, in
  `UrlValidationTest.kt`.
- `a url over 2048 characters is rejected with 400`, in
  `PreviewRoutesTest.kt` — a url that fits the body cap but not the url
  cap, to prove which check catches it.
- `a request body over the size cap is rejected with 400`, in
  `PreviewRoutesTest.kt` — a 10 KB body.

## 4. Nothing bounded concurrent previews on the shared machine

Files: `AppDeps.kt` (new `previewSemaphore` field), `Application.kt` (wiring
and the lower `maxBytes`), `PreviewRoutes.kt` (the guard).

`AppDeps` now carries a `kotlinx.coroutines.sync.Semaphore` with 3 permits.
The route calls `tryAcquire()` before it crawls; when the semaphore is full,
it answers 503 with a `Retry-After` header and code `preview_busy`. The
crawl runs inside a `try`/`finally` that always releases the permit.

The preview fetcher's `maxBytes` is now `512 * 1024` (512 KB), set only on
the `HttpFetcher` instance built for `previewCrawler` in `Application.kt`.
The authenticated crawler's `HttpFetcher` keeps its 2 MB default; that line
did not change.

Test: `a full preview semaphore answers 503 with retry-after, and recovers
once a permit frees up`, in `PreviewRoutesTest.kt`. The test acquires all 3
permits directly on `deps.previewSemaphore`, confirms 503 with a positive
`Retry-After` and `preview_busy` in the body, then releases a permit and
confirms the next request succeeds.

## 5. The frontend blamed itself for the visitor's own site

File: `frontend/src/app/features/landing/landing.ts`.

`runPreview`'s catch block now calls a new `stateForError` helper that
branches on `ApiError.code` first: `site_unreachable` and `robots_blocked`
each get their own `PreviewState` and their own message. The 429 and 400
status checks stay as the fallback for codes the branch does not name, and
a true 500 still shows the generic message.

New copy:
- `site_unreachable`: "We could not reach that address. Check it and try
  again."
- `robots_blocked`: "That site asks crawlers to stay out, so we can't read
  it."

Tests, in `landing.spec.ts`: `names the real cause on a site_unreachable
error, not a generic failure` and `names the real cause on a robots_blocked
error, not a generic failure`. Each confirms the specific message shows and
the generic "Something went wrong on our side" message does not.

## 6. `ai_readability` overstated a narrow signal

File: `PreviewRoutes.kt`, function `buildPreviewChecks`.

The check now counts js-only pages directly from `digest.pages`, rather
than reading the crawl-wide `looksJsOnly` majority flag. Zero js-only pages
reads `good`. One page reads `medium`. Two or more pages reads `high`. The
sentence is softer: "We found almost no text on your pages before
JavaScript runs. AI assistants read the raw page, so they may see very
little." This does not touch `CrawlDigest.looksJsOnly` itself, which the
paid assessment pipeline still reads unchanged.

Tests, in `PreviewRoutesTest.kt`:
- `a single javascript-only page produces the ai_readability check at
  medium severity` (renamed from the old "high severity" test, and its
  assertion updated).
- `two or more javascript-only pages raise ai_readability to high
  severity` (new, a two-page site reached through the homepage's own
  link).

## 7. A typo cost a free preview

File: `PreviewRoutes.kt`, function inside `previewRoutes`.

The handler now runs in this order: read the body with the size cap, parse
and validate the url with `normalizeUrl` (no network call), read the
caller's address, call `recordAttempt`, then `deps.ssrf.check`, then the
semaphore and the crawl. `recordAttempt` still runs before every network
call to the visitor's own site, so the burst race stays closed; it only
moved after the url parsing, which never touches the network.

This reorder is covered by every existing preview test still passing (a
malformed url still returns 400, and the rate-limit test still returns 429
on the fourth valid attempt), plus the new url-length and body-cap tests,
which prove a bad request never reaches `recordAttempt`'s network-adjacent
neighbours out of order.

## 8. `meta_descriptions` severity was too high; `thin_content` false-flagged boilerplate

File: `PreviewRoutes.kt`, function `buildPreviewChecks`.

`meta_descriptions` now reads `medium`, not `high`, when a page has no meta
description.

`thin_content` now excludes a page whose path contains `contact`,
`privacy`, `terms`, `legal`, or `about` from both the numerator and the
denominator, and the message states this: "…checked pages (not counting
contact, privacy or terms pages) have fewer than 300 words."

Tests, in `PreviewRoutesTest.kt` (updated assertion) and the new
`PreviewChecksTest.kt`:
- `checks flag every deterministic problem with the expected severity`
  (updated to expect `medium`).
- `meta_descriptions is medium, not high, when a page has none`.
- `thin_content excludes boilerplate pages from the count` (three short
  boilerplate pages plus one full-length homepage reads `good`).
- `thin_content still flags a genuinely short content page` (a short page
  outside the boilerplate list still reads `medium`).

## 9. `image_alt_text` penalised correct markup and mislabelled the halfway case

Files: `crawl/PageSignals.kt` (new `imgDecorativeCount` signal),
`preview/PreviewRoutes.kt` (`buildPreviewChecks`).

The crawler's signals did not distinguish "no alt attribute" from
`alt=""`, so I added `imgDecorativeCount` to `PageDigest`: the count of
`<img>` elements that carry an `alt` attribute with a blank value. This
field defaults to 0, so no other caller of `PageDigest` needed a change.

`buildPreviewChecks` now subtracts the decorative count from both the
numerator and the denominator, so a correctly empty `alt=""` no longer
counts as missing. The "good" threshold is now 80% (`totalWithAlt * 100 >=
countedImages * 80`), not the old 50%, which used to call an exact
half-and-half split "good."

Tests, in `PageSignalsTest.kt` (extended) and the new
`PreviewChecksTest.kt`:
- `extracts the full signal set` now includes a third image with
  `alt=""` and asserts `imgDecorativeCount == 1`.
- `image_alt_text excludes a correctly empty alt from both sides of the
  count` — checks the exact description text, "1 of 2," not "1 of 3."
- `image_alt_text needs at least 80 percent to read good, not 50` — an
  exact 50% split now reads `low`.
- `image_alt_text reads good at exactly 80 percent`.
- `image_alt_text reads good with only decorative images`.

## Constraints held

- No check calls the model. `buildPreviewChecks` still takes only a
  `CrawlDigest` and returns `List<PreviewCheckDto>`; nothing in the changed
  code references `ClaudeClient`. The existing `the preview endpoint never
  calls the model` test still passes, unchanged.
- The SSRF guard is unchanged. `deps.ssrf.check(domain)` still runs before
  the crawl, on every redirect hop inside `HttpFetcher`, exactly as before.

## Test evidence

Backend: `cd backend && MONGODB_TEST_URI=mongodb://localhost:27020
DOCKER_API_VERSION=1.44 ./gradlew test --no-daemon`, against a fresh
`mongo:7.0` container.

Result: **165 tests, 0 failures, 0 errors** (baseline 146). Totals summed
from `backend/build/test-results/test/*.xml`.

Frontend unit tests: `npx ng test --watch=false --browsers=ChromeHeadless`.

Result: **137 of 137 SUCCESS** (baseline 135).

Frontend build: `npm run build`. Result: succeeded, 10 static routes
prerendered, `postbuild` scripts ran clean.

Frontend e2e: `npx playwright test`.

Result: **2 passed** (`happy-path.spec.ts`, `pro-next-task.spec.ts`).

## Files changed

- `backend/src/main/kotlin/app/geostrategy/AppDeps.kt`
- `backend/src/main/kotlin/app/geostrategy/Application.kt`
- `backend/src/main/kotlin/app/geostrategy/assessment/UrlValidation.kt`
- `backend/src/main/kotlin/app/geostrategy/crawl/PageSignals.kt`
- `backend/src/main/kotlin/app/geostrategy/preview/PreviewRateLimiter.kt`
- `backend/src/main/kotlin/app/geostrategy/preview/PreviewRoutes.kt`
- `backend/src/test/kotlin/app/geostrategy/TestSupport.kt`
- `backend/src/test/kotlin/app/geostrategy/assessment/UrlValidationTest.kt`
- `backend/src/test/kotlin/app/geostrategy/crawl/PageSignalsTest.kt`
- `backend/src/test/kotlin/app/geostrategy/preview/PreviewRoutesTest.kt`
- `backend/src/test/kotlin/app/geostrategy/preview/PreviewRateLimiterTest.kt` (new)
- `backend/src/test/kotlin/app/geostrategy/preview/PreviewChecksTest.kt` (new)
- `frontend/src/app/features/landing/landing.ts`
- `frontend/src/app/features/landing/landing.spec.ts`
