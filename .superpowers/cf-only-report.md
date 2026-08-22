# Cloudflare-only guard for POST /v1/preview

## The hole

`/v1/preview` is unauthenticated and rate-limited to 3 requests per IP per hour. The rate
limit key comes from `CF-Connecting-IP` first. Cloudflare sets that header, and a caller
cannot forge it through Cloudflare. But `geostrategy-api.fly.dev` also answers directly. A
caller who goes there supplies every header, including `CF-Connecting-IP`, and so gets an
unlimited number of free previews.

## The premise, verified against the live app

The fix rests on one fact. Fly's own proxy overwrites `Fly-Client-IP` with the address of
the peer it sees. It does not pass through a caller-supplied value. I confirmed this fact
against the live app, not from documentation alone.

I sent four requests straight to `https://geostrategy-api.fly.dev/v1/preview`. Each request
carried a different forged `Fly-Client-IP` header (`1.2.3.4`, `5.6.7.8`, `9.10.11.12`,
`13.14.15.16`), and no other identifying header. The preview rate limiter falls back to
`Fly-Client-IP` when `CF-Connecting-IP` is absent. So if Fly had passed my forged values
through, each request would have looked like a different caller. All four would then have
succeeded.

Instead:
- Request 1 (`Fly-Client-IP: 1.2.3.4`): 200 OK.
- Request 2 (`Fly-Client-IP: 5.6.7.8`): 200 OK.
- Request 3 (`Fly-Client-IP: 9.10.11.12`): 200 OK.
- Request 4 (`Fly-Client-IP: 13.14.15.16`): 429 `rate_limited`.

Four different forged addresses collapsed into one rate-limit bucket. Only one address
stayed constant across all four requests: my own real IP, as seen by Fly's proxy. Fly
replaced my header value with that real address every time. This matches the task premise
exactly. **The premise holds.**

## The ranges bundled

Fetched from `https://www.cloudflare.com/ips-v4` and `https://www.cloudflare.com/ips-v6` on
2026-08-22, and pasted as constants in
`backend/src/main/kotlin/app/geostrategy/preview/CloudflareIpRanges.kt`:

IPv4 (15 ranges): 173.245.48.0/20, 103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22,
141.101.64.0/18, 108.162.192.0/18, 190.93.240.0/20, 188.114.96.0/20, 197.234.240.0/22,
198.41.128.0/17, 162.158.0.0/15, 104.16.0.0/13, 104.24.0.0/14, 172.64.0.0/13, 131.0.72.0/22.

IPv6 (7 ranges): 2400:cb00::/32, 2606:4700::/32, 2803:f800::/32, 2405:b500::/32,
2405:8100::/32, 2a06:98c0::/29, 2c0f:f248::/32.

## Design note: why the parser does not call `InetAddress.getByName`

The task suggested `java.net.InetAddress` for the masked-bit comparison. I use
`InetAddress`-style byte-array masking. But I do not hand the untrusted `Fly-Client-IP`
value to `InetAddress.getByName()`. That method has a known quirk: a string that fails
numeric parsing, but still starts with a hex digit (for example `8.8.8.8.8`), falls through
to hostname resolution, and triggers a real DNS lookup. A caller-controlled header must
never trigger a DNS lookup. A DNS lookup is slow. It is non-deterministic in a sandboxed
test run. It is a mild SSRF and denial-of-service surface on every rejected request.

Instead, `CloudflareIpRanges.kt` parses the IPv4 and IPv6 literal text itself, byte by
byte, with no network path of any kind. The IPv6 half reuses the same hand-rolled,
network-free approach already established in `PreviewRateLimiter.kt`'s `parseIpv6Groups`. A
string that is not a plain digit/dot/colon literal returns null. `contains()` then returns
false for it. This approach still compares masked bits over a real address representation.
It keeps the parse fully local, with no side effect.

## Enforcement points

- `backend/src/main/kotlin/app/geostrategy/preview/CloudflareIpRanges.kt` (new): bundles the
  ranges and exposes `contains(address: String): Boolean`.
- `backend/src/main/kotlin/app/geostrategy/preview/PreviewRoutes.kt`: adds a private
  extension `ApplicationCall.arrivedThroughCloudflare()`, and calls it as the very first
  statement inside `post("/v1/preview") { ... }`, before the body is even read. No
  `Fly-Client-IP` header returns true (allow: local dev, tests). A present header is passed
  to `CloudflareIpRanges.contains()`; a match allows, anything else logs at info
  (`"Rejected a preview request: Fly-Client-IP {} is outside Cloudflare's ranges"`) and
  responds 403 with `ApiError("forbidden", "This endpoint is not available on this host.")`
  — no mention of Cloudflare or the header name in the body. Every other route is untouched.

Because the check is the first statement in the handler, it runs before
`receivePreviewRequest()`, before `previewClientAddress()`, before
`deps.previewLimiter.recordAttempt()`, before the SSRF check, and before the crawler — so a
blocked caller never increments a real visitor's rate-limit counter and never triggers a
crawl. This is proven by test, not just by code order (see below).

## Tests

All required cases are covered. New tests, all passing:

`backend/src/test/kotlin/app/geostrategy/preview/CloudflareIpRangesTest.kt` (9 tests):
1. An IPv4 address inside a range is contained.
2. An IPv4 address outside every range is not contained.
3. An IPv6 address inside a range is contained.
4. An IPv6 address outside every range is not contained.
5. The first address of a range is contained (boundary).
6. The last address of a range is contained (boundary).
7. One address below the first address of a range is not contained.
8. One address past the last address of a range is not contained.
9. A malformed address (`not-an-ip`, empty string, `999.999.999.999`, `1.2.3.4.5`,
   `gggg::1`) returns false, no exception.

New tests added to `backend/src/test/kotlin/app/geostrategy/preview/PreviewRoutesTest.kt`
(5 tests):
1. `no Fly-Client-IP header lets the preview through, as in local development and the test
   suite` — proves the unaffected path.
2. `a Fly-Client-IP inside a Cloudflare range lets the preview through` — 200.
3. `a Fly-Client-IP outside every Cloudflare range is rejected with 403, and the crawl
   never runs` — uses a `FailingFetcher` that fails the test if the crawler is ever
   called; also asserts the response body names neither "Cloudflare" nor
   "Fly-Client-IP".
4. `a malformed Fly-Client-IP is rejected with 403 and never throws` — header value
   `not-an-ip`.
5. `a rejected Fly-Client-IP never increments the rate limit counter, and never crawls` —
   sends 5 rejected requests (well past the 3/hour limit) from one address, then proves a
   legitimate follow-up from the same address still has its full quota of 3.

One existing test was adjusted, not weakened: `CF-Connecting-IP outranks Fly-Client-IP for
the rate limit key` previously used `Fly-Client-IP: 198.51.100.9` (a documentation/test-net
address), which the new guard would now reject before the rate-limit logic it was built to
exercise ever ran. I changed that one value to `173.245.48.9`, a real Cloudflare address,
so the test still isolates the behaviour it names.

## Results

- Baseline, confirmed before any change: **165 tests, 0 failures, 0 errors** (via
  `docker run mongo:7.0` on port 27021, `MONGODB_TEST_URI` + `DOCKER_API_VERSION=1.44`,
  `./gradlew test --no-daemon`).
- After the change: **179 tests, 0 failures, 0 errors** (14 new tests: 9 unit + 5 route).
  `BUILD SUCCESSFUL in 3m 22s`.
- Server log during the test run confirms the rejection path fires and logs, for example:
  `INFO a.geostrategy.preview.PreviewRoutes - Rejected a preview request: Fly-Client-IP
  8.8.8.8 is outside Cloudflare's ranges`.

## Scope respected

- No file under `frontend/` touched.
- No new dependency added (`build.gradle.kts` unchanged).
- The SSRF guard, the semaphore, and the "never calls the model" property are untouched;
  the existing test that checks each of them still passes unmodified.
- Only `/v1/preview` carries the new guard. No other route was changed.
