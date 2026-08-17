# Platform configuration playbook

Date: 2026-08-16. Source: the live TulipLot production system
(tuliplot.com + api.tuliplot.com), verified against `main` at `62d282d`.

**Audience:** agents who set up a separate project on the same stack. This
document describes what works in production, the exact configuration
values that make it work, and the traps we hit so you do not hit them.
Replace every TulipLot-specific name with your project's names. Keep the
patterns.

**Stack:** Angular 22 (standalone, zoneless, signals) on Cloudflare Pages ·
Spring Boot 4.1 / Java 25 on Fly.io · MongoDB Atlas M0 · GitHub Actions
CI/CD · Freemius (merchant of record) + Google AdSense · Google OIDC.
The stack is free-tier first. The only fixed costs are the domain and,
optionally, an always-on Fly machine.

---

## 1. The one architectural rule everything depends on

Put the UI and the API under **one registrable domain**
(`tuliplot.com` + `api.tuliplot.com`). This makes the session cookie
same-site, so `SameSite=Lax` works and the browser sends it on API calls.
Cross-site cookies (`SameSite=None`) invite browser blocking and add
attack surface. Two different registrable domains break this permanently.
Decide the domain layout before anything else.

CORS is still required because the origins differ. Use credentialed CORS
with an explicit origin allowlist (`CORS_ALLOWED_ORIGINS`), never `*`.

---

## 2. Deployments

### 2.1 Frontend — Cloudflare Pages

- Create a **direct-upload** Pages project. Deploy the built
  `dist/<app>/browser` directory with
  `npx wrangler pages deploy <dist> --project-name=<name> --branch=main`.
- Attach the apex custom domain to the project. Add a `www` → apex 301
  redirect rule in Cloudflare.
- The Angular build uses `@angular/ssr` with `outputMode: 'static'`. The
  public pages prerender to real HTML files. The authenticated app routes
  use `RenderMode.Client`.
- **`public/_redirects` — the highest-risk file in the frontend.** Rules:
  - Only `RenderMode.Client` routes get a row. Example rows:
    `/login / 200`, `/login/ / 200`, `/app / 200`, `/app/* / 200`.
  - The rewrite destination must be `/`, never `/index.html`. Pages
    converts an `/index.html` destination into a clean-URL 308 redirect
    to `/`, and that took our login down for 45 minutes.
  - Add the trailing-slash twin for every row when canonicals point at
    the slashed form.
  - A prerendered route must NOT get a row. A row shadows the
    prerendered HTML.
  - Every NEW client route needs a new row. A hard navigation to it
    404s otherwise.
  - Test bed: only a real preview deployment
    (`wrangler pages deploy <dist> --project-name=<name> --branch=preview`).
    The local `wrangler pages dev` emulator cannot parse these rules
    correctly. Do not adjudicate its warnings from theory. We did, we
    were wrong, and production broke.
- Ship a real 404: prerender a `/404` page, copy it to `404.html` in a
  postbuild step. Without it, the SPA fallback serves the homepage with
  a 200 for every bad URL (soft 404s).
- A `public/_headers` file sets `X-Robots-Tag: noindex` for `/404`.

### 2.2 Backend — Fly.io

`fly.toml` that works (512 MB shared VM, Java 25 JVM):

```toml
app = "api-<name>"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  SERVER_FORWARD_HEADERS_STRATEGY = "framework"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "120s"
    method = "GET"
    path = "/api/v1/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

The load-bearing lines:

- `SERVER_FORWARD_HEADERS_STRATEGY=framework`. The Fly proxy terminates
  TLS. Without this, Spring builds `http://` redirect URIs and Google
  OAuth rejects the mismatch.
- `grace_period = "120s"`. The JVM cold boot takes up to 3 minutes on a
  shared VM. A short grace period kills the machine mid-boot.
- The Dockerfile sets `JAVA_OPTS="-Xmx300m"`. A 512 MB VM OOMs without a
  heap cap.
- `min_machines_running = 0` is the free option, with a real cost: the
  first request after idle waits for the JVM boot. **Webhooks hit this
  cost too** — a payment webhook can arrive at a cold machine. Freemius
  retries on 5xx, so the design survives it, but an always-on machine
  (~$2–3/month) removes the risk. Decide this before live sales.
- Health checks need a public unauthenticated endpoint
  (`/api/v1/health`, `permitAll`).

### 2.3 CI/CD — GitHub Actions, auto-deploy on merge

One workflow with five jobs (see `.github/workflows/ci.yml`):

1. `changes` — `dorny/paths-filter` computes `frontend` / `backend`
   outputs from the changed paths (`frontend/** + content/**` vs
   `backend/**`).
2. `backend` — Gradle build with a **`mongo:8.0` service container** and
   `MONGODB_TEST_URI=mongodb://localhost:27017` (see §3).
3. `frontend` — `npm ci`, `npx vitest run`, production build, upload the
   dist as an artifact (only on non-PR events).
4. `deploy-frontend` — downloads the tested artifact and deploys it with
   `cloudflare/wrangler-action`. It never rebuilds. Push-to-main only,
   gated on the test jobs, plus a `workflow_dispatch` escape hatch.
5. `deploy-backend` — `flyctl deploy --remote-only`, same gating.

Rules that matter:

- Give each deploy job its **own** concurrency group with
  `cancel-in-progress: false`. A shared group cancels a pending frontend
  deploy when a backend deploy starts.
- Pin third-party actions you feed secrets to by commit SHA.
- Build with the project's build script (`npm run build`), not a bare
  `ng build` — prebuild steps (content compile, sitemap, 404 copy) must
  run in CI too.
- Repository secrets: `FLY_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_API_TOKEN`. Scope the Cloudflare token to the account with
  Pages:Edit only.
- Node versions bite twice: the Angular CLI enforces a minimum Node
  (build in CI on a pinned Node 22 when local Node fails the floor), and
  an npm 11 lockfile can omit optional-dependency transitives that npm 10
  (`npm ci`) rejects. After you add dependencies, validate the lockfile
  with the same npm major CI uses.

---

## 3. Database configuration — MongoDB Atlas + Spring Boot 4

- Atlas M0 (free). One cluster, one database, a dedicated DB user.
  Network access 0.0.0.0/0 is the pragmatic M0 choice; the credential is
  the real gate.
- **The property is `spring.mongodb.uri` on Boot 4.** Boot 4 renamed
  `spring.data.mongodb.uri`, and the old name fails at the "error"
  deprecation level — with a config that silently falls back to
  localhost in prod if you miss it.
- Cap the pool in the URI: `?maxPoolSize=50&minPoolSize=5`. An M0 allows
  500 connections total across all clients.
- Env-driven with a localhost default:
  `uri: ${MONGODB_URI:mongodb://localhost:27017/<db>?maxPoolSize=50&minPoolSize=5}`.
- **Sessions:** `spring-session-data-mongodb` does not exist on Boot 4.1.
  We wrote a small custom `MongoSessionRepository` on
  `spring-session-core` (`@EnableSpringHttpSession`). Budget a day for
  this; it also gives you session-id rotation control (see §4).
- Startup seeding: an idempotent `ApplicationRunner` that UPSERTs
  reference data (our catalog). Plain inserts never propagate updates to
  an existing database.
- **Tests:** local runs use a shared singleton Testcontainer; CI uses the
  workflow's Mongo service container. One env seam switches them:
  `MONGODB_TEST_URI` set → use it (CI), else start the container
  (local). Isolate per test class by database name. Do not fight
  Testcontainers networking on GitHub runners — the advertised
  replica-set host is unreachable from the test JVM there; the service
  container simply works.
- Windows + Docker Desktop locals: set
  `docker.host=npipe:////./pipe/dockerDesktopLinuxEngine` in
  `~/.testcontainers.properties`, and `DOCKER_API_VERSION=1.44` for
  Gradle-run Testcontainers.
- TTL cleanup (sessions, processed webhook events) uses Mongo TTL
  indexes, declared in one `MongoIndexConfig`.

---

## 4. Auth configuration

Stateful session auth. No JWTs. The API is same-site with the UI, so a
httpOnly session cookie is the simplest secure design.

**Session cookie** (custom session store, see §3):

- Name your own (`TULIPSESSION`), httpOnly, `SameSite=Lax`,
  `Secure` from `COOKIE_SECURE=true` in prod.
- `COOKIE_DOMAIN=tuliplot.com` — **no leading dot.** RFC 6265 rejects
  `.domain.com`; Tomcat throws on it and every request 500s. The dotless
  form already covers subdomains.
- Rotate the session id on login and register (fixation defense). Delete
  the old session document when the id changes.
- The principal stored in the session must be `Serializable` — including
  the OIDC user object. Ours was not; every Google login 401'd in prod.

**CSRF** (double-submit cookie for a SPA):

- `CookieCsrfTokenRepository.withHttpOnlyFalse()` + a SPA token request
  handler + a filter that forces the cookie to be written.
- The CSRF cookie gets the same domain/secure settings as the session
  cookie.
- **Angular's `withXsrfConfiguration` does not work cross-origin** — it
  skips absolute URLs, and every call to `api.<domain>` is absolute. Write
  your own interceptor: read the `XSRF-TOKEN` cookie, set `X-XSRF-TOKEN`
  on mutating requests to your API base URL only.
- Exempt exactly one path from CSRF: the billing webhook (it
  authenticates by HMAC signature instead).

**Google OIDC:**

- Spring `oauth2Login` with a custom OIDC user service. Env:
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (dummy defaults keep dev
  bootable).
- The success handler redirects to the UI origin
  (`OAUTH2_SUCCESS_URL=https://<ui-domain>/app`) — UI and API are
  different origins, so the default relative redirect is wrong.
- Google console: authorized origin `https://api.<domain>`, redirect URI
  `https://api.<domain>/login/oauth2/code/google`. Publish the OAuth app
  (External, no sensitive scopes → no verification).
- The `SERVER_FORWARD_HEADERS_STRATEGY=framework` line in §2.2 is part
  of this — without it the redirect URI is built as `http://`.

**Authorization surface:** default-deny. `permitAll` only for: health,
register, login, password-reset, public config reads (catalog, ads
config), the billing webhook, and the two OAuth paths (`/oauth2/**`,
`/login/oauth2/**`). Everything else `authenticated()`, with a 401
`HttpStatusEntryPoint`.

**Known trap:** with the 401 entry point, an unhandled server exception
that reaches the `/error` dispatch surfaces as a 401, not a 500. Handle
exceptions inside controllers that must report 5xx faithfully (our
webhook controller catches `RuntimeException` and returns 500 itself).

---

## 5. Monetization configuration

### 5.1 Billing — Freemius (merchant of record)

Why Freemius: Stripe does not onboard merchants based in Ukraine.
Freemius is a merchant of record (they are the seller, they handle VAT)
and pays out via PayPal, Payoneer, Wise, or wire. If your seller entity
is Stripe-eligible, the same architecture works with Stripe.

**Configuration:**

- Frontend `environment.ts`: `freemius: { productId, planId, publicKey }`.
  All three are public by design.
- Backend env (Fly secrets): `FREEMIUS_PRODUCT_ID`,
  `FREEMIUS_SECRET_KEY`, `FREEMIUS_API_TOKEN`. Two different
  credentials: the **secret key** only signs webhooks (HMAC); the **API
  token** is the Bearer credential for the REST API (dashboard →
  Settings → API Token). Do not conflate them.
- Empty defaults everywhere, so the app boots in dev without billing.
- Bound outbound HTTP: `spring.http.clients.connect-timeout: 5s`,
  `read-timeout: 10s`. Without it, one hung billing API call pins a
  request thread indefinitely.

**The webhook pattern (transferable to any provider):**
event → verify → dedupe → retrieve from the API → resync.

- Raw-body endpoint (`POST /api/v1/billing/webhook`). Compute
  HMAC-SHA256 over the **exact raw bytes** with the secret key; compare
  to the `X-Signature` header with `MessageDigest.isEqual`. Never parse
  before verifying. Bad signature → 401.
- Dedupe on the event id in a TTL collection. Duplicate → 200, no work.
- The payload is only a trigger. Fetch the license from the provider API
  and derive the tier from that response — this survives out-of-order
  and thin events.
- Write the dedupe record only AFTER a successful apply. Any
  post-signature failure → 500, so the provider retries and the retry
  completes the work. A 4xx makes providers stop retrying — reserve 401
  for signatures, 200 for events you deliberately ignore (unknown type,
  unmatchable buyer).
- Buyer matching: the checkout overlay locks the email field to the
  signed-in account email (`readonly_user: true`); the webhook matches
  by email.
- Frontend flow: lazy-load `https://checkout.freemius.com/js/v1/`, open
  `new FS.Checkout({product_id, plan_id, public_key})`, and on success
  poll `/auth/me` until the tier flips (the webhook does the flip, not
  the success callback). Show an honest "activation pending" state on
  poll timeout.
- Register the webhook URL in the provider dashboard — this is a manual
  owner step that code cannot do.

**Status facts (2026-08-16):** sandbox checkout verified end to end
(webhook 200). Freemius seller **verification is pending — live sales
stay blocked until it clears.** Open decisions: `min_machines_running=1`
(cold-start webhooks, §2.2), a revoke test, and a `license.shortened`
retry test.

### 5.2 Ads — Google AdSense

- The ad unit lives in native DOM (never inside an iframe) and degrades
  to a house "upgrade" promo until AdSense approves.
- Config is env-driven end to end: backend `ADSENSE_CLIENT` /
  `ADSENSE_SLOT` served by a public `GET /api/v1/config/ads`; frontend
  `environment.adsenseClient`. All empty until approval — flipping them
  is a config change, not a code change.
- `public/ads.txt` must carry the real publisher id
  (`google.com, pub-<id>, DIRECT, f08c47fec0942fa0`).
- Policy strategy that made review viable: a prerendered **public
  content site** (guides, blog, legal) plus a public no-login `/try`
  page that renders the ad slot. A login-gated, robots-excluded ad
  surface is a rejection risk.
- Account gotcha: an existing AdMob account holds your publisher id
  hostage — Google allows one publisher account. Upgrade it via
  adsense.google.com/start → "Continue in this account"; the pub id
  survives.
- Status: review pending; env keys still empty.

---

## 6. Other configuration

- **Frontend environments:** `apiBaseUrl` points at the API origin +
  `/api/v1`. The dev file points at `http://localhost:8080`. Nothing
  secret lives in the frontend — everything in `environment.ts` ships to
  every browser.
- **Session/config parity list for the API (full Fly secrets set):**
  `MONGODB_URI`, `COOKIE_DOMAIN`, `COOKIE_SECURE`,
  `CORS_ALLOWED_ORIGINS`, `OAUTH2_SUCCESS_URL`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `FREEMIUS_PRODUCT_ID`, `FREEMIUS_SECRET_KEY`,
  `FREEMIUS_API_TOKEN`, and later `ADSENSE_CLIENT`, `ADSENSE_SLOT`.
  `SERVER_FORWARD_HEADERS_STRATEGY` and `JAVA_OPTS` live in
  `fly.toml`/Dockerfile, not secrets.
- **SEO/discovery files** (all in `frontend/public/` or generated at
  build): `robots.txt` (allow all + named AI crawlers, `Disallow: /app`,
  `Content-Signal` line, sitemap pointer), a generated `sitemap.xml`
  (the content build script owns it — set the base URL there),
  `llms.txt` + `llms-full.txt` for AI answer engines, OG banners
  generated per post by a script that auto-discovers slugs (a hardcoded
  slug map ships broken images for every new post).
- **Titles:** public pages set title + meta through one `SeoService`;
  authenticated routes use Angular route `title` + a custom
  `TitleStrategy` that appends the brand suffix only when a route
  declares a title. Two mechanisms, no overlap.
- **Site identity:** one `site-identity.json` (name, domain, tagline)
  imported everywhere the brand appears, so a rename is one file.
- **Support email without a mailbox:** Cloudflare Email Routing forwards
  `support@<domain>` to a personal inbox. Receive-only, free, and it
  satisfies "developer contact" fields (store listings, AdSense).
- **Local Node pin:** keep a known-good Node under a tools directory and
  prepend it to `PATH` for frontend builds when the system Node misses
  the CLI floor. Unit tests usually run fine on the system Node.

---

## 7. The ordering that worked (new-project checklist)

1. Register the domain (Cloudflare). Decide `<domain>` + `api.<domain>`.
2. Atlas: project, M0 cluster, DB user. Note the URI with the pool cap.
3. Fly: create the app, set the §6 secrets, deploy, add the
   `api.<domain>` cert + DNS record, verify `/api/v1/health`.
4. Pages: create the project, first manual deploy, attach the custom
   domain, `www` redirect.
5. Google OAuth: client + origins + redirect URI, publish the app.
   Verify the full login round trip in a real browser.
6. GitHub: repository secrets, merge the CI workflow, verify one
   auto-deploy per target.
7. Billing dashboard: product + plan, copy the three credentials to Fly,
   register the webhook URL, run one sandbox checkout end to end.
8. Ads: ship the public content surface first, then apply.
9. Manual QA of the auth + payment round trips. Automated suites do not
   cover real Google and real checkout.
