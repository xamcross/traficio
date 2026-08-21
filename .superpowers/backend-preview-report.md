# Anonymous preview endpoint: report

## The endpoint

`POST /v1/preview` needs no authentication. The body is `{ "url": "..." }`.

The route lives in `backend/src/main/kotlin/app/geostrategy/preview/PreviewRoutes.kt`.
The handler does these steps, in order:

1. It reads the caller's address and checks the rate limiter.
2. It normalises the URL with `normalizeUrl` from `assessment/UrlValidation.kt`.
3. It runs `deps.ssrf.check(domain)`, the same guard the full assessment route uses.
4. It crawls the site with a crawler capped at 5 pages.
5. It builds the deterministic checks and returns them.

The route stores nothing. It never creates a `Site`, an `Assessment`, or a user record.
It never reads `deps.claude`, so it cannot call the model. This is a property of the
code, not just a test result: the function has no reference to a `ClaudeClient`.

## The DTO

```
PreviewResponseDto(
    domain: String,
    pagesChecked: Int,
    checks: List<PreviewCheckDto>,
    moreFindingsInFullCheck: Int? = null,
)
PreviewCheckDto(id: String, severity: String, description: String)
```

`moreFindingsInFullCheck` stays null on every response. The full check reads the
model's own judgement, so the endpoint cannot state that count in advance. The task
asked to leave the field out rather than invent a number, so it always returns null.

## The checks and their data source

All seven checks come from `CrawlDigest`, which the crawler already produces. No check
calls the model.

| id | source | bad severity | good case |
|---|---|---|---|
| `ai_readability` | `digest.looksJsOnly` | high | AI assistants can read the page directly |
| `https` | `digest.facts.https` | high | the site uses a secure connection |
| `sitemap` | `digest.facts.sitemapPresent` | medium | a sitemap.xml file exists |
| `page_titles` | pages with a blank or missing `title` | high | every page has a title |
| `meta_descriptions` | pages with a blank or missing `metaDescription` | high | every page has a description |
| `thin_content` | pages with `wordCount < 300` | medium | every page has enough text |
| `image_alt_text` | `imgWithAltCount` vs `imgCount` across pages | low | most images have alt text |

The task named `ai_readability` as "the headline" check and gave it a fixed severity
of "high" in its own test list, so this endpoint does not use "critical" anywhere.
That word is reserved in the DTO's documented vocabulary, for a future check.

## The rate-limit design

`backend/src/main/kotlin/app/geostrategy/preview/PreviewRateLimiter.kt` counts requests
per caller address in Mongo, with no in-memory state. It:

- reads the address from `X-Forwarded-For` (Cloudflare and Fly both set this), and
  falls back to the raw socket address when the header is absent;
- buckets each address into a fixed one-hour window, keyed as `"<address>:<windowStart>"`;
- increments the bucket with one atomic `findOneAndUpdate` upsert;
- allows 3 requests per window; the 4th and later requests get 429 with a
  `Retry-After` header stating the seconds left in the window.

The TTL index in `persistence/Mongo.kt` (`ensureIndexes`) drops each bucket once its
window ends, so no cleanup job is needed. This follows the same pattern as the
existing `tokens` and `sessions` TTL indexes.

## Wiring changes

`AppDeps` gained three fields: `claude: ClaudeClient`, `previewCrawler: Crawler`
(page cap 5), and `previewLimiter: PreviewRateLimiter`. `claude` was not on `AppDeps`
before this change; it now sits there so a test can inject a client that fails if
called, and so the route's total absence of a Claude reference is provable. No
existing route reads any of the three new fields, so no existing endpoint changes
behaviour. `testDeps` in `TestSupport.kt` gained matching parameters, all with
defaults that preserve every existing test's behaviour.

## Tests

New file: `backend/src/test/kotlin/app/geostrategy/preview/PreviewRoutesTest.kt`, 8 tests.

1. `preview of a normal site returns checks and a domain, with no session cookie` — pass
2. `a javascript-only site produces the ai_readability check at high severity` — pass
3. `checks flag every deterministic problem with the expected severity` — pass (bonus:
   covers the bad branch of all 7 checks in one fixture)
4. `a preview persists nothing` — pass (asserts `sites` and `assessments` stay at 0 documents)
5. `a blocked address is rejected by the ssrf guard` — pass
6. `the fourth preview from one address within the hour returns 429 with retry-after` — pass
7. `a malformed url returns 400 with a helpful message` — pass
8. `the preview endpoint never calls the model` — pass (injects a `FailingClaudeClient`
   whose methods call `kotlin.test.fail`; a 200 response proves neither method ran)

Baseline: 138 tests. After this change: 146 tests, 0 failures, 0 errors.
Command used, per the task's instructions:

```
docker rm -f gs-mongo-prev
docker run -d --rm --name gs-mongo-prev -p 27020:27017 mongo:7.0
cd backend
MONGODB_TEST_URI=mongodb://localhost:27020 DOCKER_API_VERSION=1.44 ./gradlew test --no-daemon
docker rm -f gs-mongo-prev
```

## Concerns

- The rate-limit window is a fixed clock-aligned hour, not a rolling hour from the
  caller's first request. A caller near a window edge could send 3, wait a short
  time, then send 3 more. This matches the Mongo TTL pattern already in the codebase
  and keeps the write pattern to one atomic upsert; a sliding window would need more
  storage and more writes for a modest gain against a determined abuser.
- `X-Forwarded-For` is a spoofable header on its own. This app sits behind Cloudflare
  and Fly, both of which set or overwrite this header at their edge, so a direct
  client cannot forge it past those proxies in production. A local or test client can
  still set it freely, which is what the tests rely on.
- The crawler's own budget timeout (`budgetMillis`, default 90 seconds) is unchanged
  for the preview. Only the page cap dropped, from 15 to 5. A slow anonymous target
  could still hold a preview request open for up to 90 seconds; this matches the
  existing crawler's behaviour and the task only asked for a smaller page cap.
