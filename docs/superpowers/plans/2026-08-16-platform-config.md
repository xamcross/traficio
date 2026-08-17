# Platform Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the deployment scripts and the deployment configuration of GeoStrategy with the platform playbook in `docs/2026-08-16-platform-config-playbook.md`.

**Architecture:** The backend stays a Ktor monolith on Fly.io (always-on 512 MB machine, JVM heap cap, long health grace). The frontend stays an Angular SPA on Cloudflare Pages (direct upload, explicit `_redirects` rows, real `404.html`, `robots.txt`). One GitHub Actions workflow tests both halves and deploys each half after a merge to `main`. The frontend gets Angular environment files, so the production build points at `https://api.<domain>` while dev keeps the same-origin proxy.

**Tech Stack:** Kotlin 2.2 / Ktor 3.2 / Gradle 8.14 / JDK 21 · Angular 20 / Karma / Playwright · Docker · Fly.io (`fly.toml`) · Cloudflare Pages (`wrangler pages deploy`) · GitHub Actions · MongoDB (Testcontainers locally, a service container in CI).

**Spec:** `docs/2026-08-16-platform-config-playbook.md` (the guide). Related: `docs/superpowers/specs/2026-08-04-geostrategy-design.md` §"Deployment" (line 36) and §"Sessions" (line 100); `docs/launch-checklist.md`.

## Global Constraints

- The playbook is a guide from a Spring Boot project. This project is Ktor. Copy the platform patterns. Do not copy the Spring-specific parts (`spring.mongodb.uri`, `SERVER_FORWARD_HEADERS_STRATEGY`, `spring-session`).
- Domain layout stays as the spec says: SPA at `https://app.<domain>`, API at `https://api.<domain>`. One registrable domain, so `SameSite=Lax` works (playbook §1).
- The real domain is not known yet. Use the marker `REPLACE_ME_DOMAIN` in code, and `<domain>` in prose. This follows the existing `REPLACE_ME_*` convention in `frontend/src/app/core/config.ts`.
- The Fly app name stays `geostrategy-api`. The Pages project name is `geostrategy`. The Git default branch is `main` (see "Decisions" below).
- The health endpoint stays `GET /healthz` (`backend/src/main/kotlin/app/geostrategy/Application.kt:117`). It has no auth. The playbook path `/api/v1/health` does not apply.
- The Fly machine stays always-on: `min_machines_running = 1`, `auto_stop_machines = "off"`. Reason: `JobWorker` runs assessments in-process for up to 900 s and `BillingRevalidator` runs daily. Fly auto-stop would kill a running assessment. The playbook accepts an always-on machine (§2.2).
- The JVM heap cap is `-Xmx300m` on a 512 MB machine (playbook §2.2).
- Health check `grace_period = "120s"` (playbook §2.2).
- `_redirects` destinations are `/`, never `/index.html` (playbook §2.1).
- Pin third-party actions that receive secrets by commit SHA (playbook §2.3). Pinned values (resolved 2026-08-16):
  - `cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0` (v4.0.0)
  - `superfly/flyctl-actions/setup-flyctl@ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1` (1.6)
  - `dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d` (v4.0.3)
- CI Node is `24`. Reason: the lockfile was written by npm 11.6.2 (Node 24). Node 22 ships npm 10, and an npm 11 lockfile can fail `npm ci` on npm 10 (playbook §2.3).
- CI JDK is Temurin `21` (`jvmToolchain(21)` in `backend/build.gradle.kts`).
- The CI Mongo service image is `mongo:7.0`, the same as `TestSupport.kt`.
- All prose in files that this plan creates or changes follows ASD-STE100.
- Commit after each task. Commit subject lines use the conventional-commit format.

## Decisions taken in this plan (change them if the owner rules otherwise)

| # | Decision | Reason | Alternative |
|---|----------|--------|-------------|
| D1 | SPA at `app.<domain>`, not at the apex | The spec (line 100), the code comments, and the launch checklist already say `app.` | Attach the apex to the Pages project and add a `www` → apex redirect (playbook §2.1). Only dashboard settings and `APP_URL` change. |
| D2 | Always-on Fly machine | In-process job worker and daily revalidator | `auto_stop_machines = "stop"`, `min_machines_running = 0`. Not safe for this backend. |
| D3 | `COOKIE_DOMAIN` unset in production (host-only cookie on `api.<domain>`) | The SPA never reads the cookie. The browser sends a host-only cookie on credentialed calls to `api.<domain>`. `SameSite=Lax` holds because `app.` and `api.` share one registrable domain. | Set `COOKIE_DOMAIN=<domain>` (no leading dot, playbook §4). Never `.<domain>`. |
| D4 | Static `404.html` plus explicit `_redirects` rows | Playbook §2.1: a real 404 status, no soft 404s | Delete `_redirects` and `404.html`, use the automatic Pages SPA fallback (all bad URLs answer 200). |
| D5 | Playwright e2e runs in CI and gates deploys | It is the only integration test. The backend is mocked, so it is stable. | Drop the e2e step from `ci.yml`. |
| D6 | No `@angular/ssr` prerender | Out of scope. It is a code change, not a config change. | Follow-up: adopt `outputMode: 'static'`, then remove the `_redirects` rows of prerendered routes. |
| D7 | Fly region stays `waw` | Already chosen. Atlas M0 has no Warsaw region; Frankfurt (`eu-central-1`) is the closest. Latency `waw`↔`fra` is small. | Change `primary_region` to `fra`. |
| D8 | Product name stays GeoStrategy | The GitHub repository is `xamcross/traficio`. Nobody has said the product renames. | If the product renames, do it in a separate task. |

## Facts about the environment (verified 2026-08-16)

- Remote: `https://github.com/xamcross/traficio.git`. The repository is **public**. It was empty on 2026-08-16 morning; another session pushed `master` the same day, so the default branch is `master`. Nothing secret is in the code (scan done). The `.superpowers/sdd/` review artifacts will become public with the first push.
- Local branch is `master`. No `main` exists yet. `ci.yml` triggers on `main`. Rename before the first push: `git branch -m master main` in the main checkout, then `git push -u origin main`.
- Baseline in the worktree: frontend 78 unit tests pass, backend 117 tests pass.
- Local tools: Node 24.13.0, npm 11.6.2, JDK 24 on `PATH` (Gradle uses the toolchain JDK 21), Docker Desktop 29.5.3, `flyctl` 0.4.79, `wrangler` 4.95.0 (`npx`), `gh` 2.92.0.
- Windows Testcontainers: `~/.testcontainers.properties` uses the npipe strategy. Run Gradle tests with `DOCKER_API_VERSION=1.44`.

## File map

| Path | Task | Change |
|------|------|--------|
| `.gitignore` | 1 | Add `.claude/worktrees/` |
| `backend/.dockerignore` | 1 | Create |
| `backend/Dockerfile` | 1 | Add `JAVA_OPTS`, dependency layer cache |
| `backend/fly.toml` | 1 | Add `[[vm]]`, grace 120 s, explicit always-on |
| `backend/README.md` | 1, 2 | Deploy section, test seam note |
| `backend/src/test/kotlin/app/geostrategy/TestSupport.kt` | 2 | `MONGODB_TEST_URI` seam |
| `frontend/src/environments/environment.ts` | 3 | Create (dev defaults) |
| `frontend/src/environments/environment.production.ts` | 3 | Create (prod values) |
| `frontend/angular.json` | 3 | `fileReplacements` in `production` |
| `frontend/src/app/core/config.ts` | 3 | Read from `environment` |
| `frontend/public/_redirects` | 4 | Explicit rows, `/` destination |
| `frontend/public/404.html` | 4 | Create |
| `frontend/public/_headers` | 4 | Create |
| `frontend/public/robots.txt` | 4 | Create |
| `frontend/README.md` | 3, 4, 5 | Environments, Pages files, deploy |
| `.github/workflows/ci.yml` | 5 | Create |
| `docs/launch-checklist.md` | 6 | Update steps 3, 4, 7; add CI step |

---

### Task 1: Backend container and Fly configuration

**Files:**
- Modify: `.gitignore`
- Create: `backend/.dockerignore`
- Modify: `backend/Dockerfile`
- Modify: `backend/fly.toml`
- Modify: `backend/README.md` ("Deploy to Fly.io" section)

**Interfaces:**
- Consumes: the Gradle `application` plugin start script `/app/bin/geostrategy-backend`. It reads `JAVA_OPTS` and `GEOSTRATEGY_BACKEND_OPTS` from the environment.
- Produces: an image that listens on `8080` and answers `GET /healthz` with `ok`. Task 5 deploys it with `flyctl deploy --remote-only`.

- [ ] **Step 1: Ignore the worktree directory and the build output**

Append to `.gitignore` (root):

```gitignore

# Claude Code worktrees
.claude/worktrees/
```

Create `backend/.dockerignore`:

```
build/
.gradle/
*.log
```

- [ ] **Step 2: Rewrite the Dockerfile**

Replace the content of `backend/Dockerfile` with:

```dockerfile
# Build stage. Copy the Gradle files first, so the dependency layer stays cached
# when only the sources change.
FROM gradle:8.14-jdk21 AS build
WORKDIR /src
COPY settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
RUN gradle --no-daemon dependencies > /dev/null 2>&1 || true
COPY . .
RUN gradle --no-daemon installDist

# Runtime stage. A 512 MB Fly machine needs a heap cap, or the JVM goes out of memory.
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/build/install/geostrategy-backend/ /app/
ENV JAVA_OPTS="-Xmx300m -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
CMD ["/app/bin/geostrategy-backend"]
```

- [ ] **Step 3: Rewrite fly.toml**

Replace the content of `backend/fly.toml` with:

```toml
# Fly.io configuration for the GeoStrategy API.
# See docs/2026-08-16-platform-config-playbook.md §2.2 for the reasons behind each value.
app = "geostrategy-api"
primary_region = "waw"  # closest Atlas M0 region is Frankfurt (eu-central-1)

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  # Always on. The in-process job worker runs assessments for up to 900 s and the
  # billing revalidator runs daily. Auto-stop would kill a running assessment.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    # The JVM cold boot can take minutes on a shared VM. A short grace period kills
    # the machine mid-boot.
    grace_period = "120s"
    method = "GET"
    path = "/healthz"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 4: Build the image and check the health endpoint**

Run from `backend/`:

```bash
docker build -t geostrategy-backend:local .
docker network create gs-net 2>/dev/null || true
docker run -d --rm --name gs-mongo-smoke --network gs-net mongo:7.0
docker run -d --rm --name gs-api-smoke --network gs-net -p 18080:8080 \
  -e MONGODB_URI=mongodb://gs-mongo-smoke:27017 geostrategy-backend:local
sleep 15
curl -s http://localhost:18080/healthz; echo
docker exec gs-api-smoke sh -c 'echo "JAVA_OPTS=$JAVA_OPTS"'
docker logs gs-api-smoke 2>&1 | grep -i 'responding\|started' | head -3
docker rm -f gs-api-smoke gs-mongo-smoke
```

Expected: `ok` from curl. `JAVA_OPTS=-Xmx300m -XX:+ExitOnOutOfMemoryError`. A Ktor "Responding at http://0.0.0.0:8080" log line.

- [ ] **Step 5: Validate fly.toml**

Run from `backend/`: `flyctl config validate`

Expected: `Configuration is valid`. If the command asks for a login, skip it and note it in the task report. The owner validates on the first `fly deploy`.

- [ ] **Step 6: Update the backend README deploy section**

In `backend/README.md`, replace the section "## Deploy to Fly.io (first time)" with:

```markdown
## Deploy to Fly.io (first time)

CI deploys the backend after each merge to `main` (see `.github/workflows/ci.yml`).
Do these steps once, by hand, before the first CI deploy.

1. Run `fly launch --no-deploy --copy-config` from `backend/`. Accept `fly.toml`.
   Adjust the app name if `geostrategy-api` is taken.
2. Set the secrets. Use one `fly secrets set` command:

       MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?maxPoolSize=50&minPoolSize=5"
       MONGODB_DB="geostrategy"
       BASE_URL="https://api.<domain>"
       APP_URL="https://app.<domain>"
       RESEND_API_KEY="re_..."
       EMAIL_FROM="GeoStrategy <noreply@<domain>>"
       GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..."
       ANTHROPIC_API_KEY="sk-ant-..."
       FREEMIUS_SECRET_KEY="..." FREEMIUS_PRO_PLAN_ID="..."

   Do not set `COOKIE_DOMAIN`. The session cookie is then host-only on
   `api.<domain>`, and the browser sends it on every credentialed call from
   `app.<domain>`. If you must widen it, use `COOKIE_DOMAIN=<domain>` with no
   leading dot.
   `PORT` lives in `fly.toml`. `JAVA_OPTS` lives in the `Dockerfile`. They are not
   secrets.
3. Run `fly deploy` once by hand.
4. Run `fly certs add api.<domain>`. In Cloudflare DNS add a CNAME `api` →
   `geostrategy-api.fly.dev` (proxied).
5. Check `https://api.<domain>/healthz`. It must return `ok`.
6. Google Cloud Console: add `https://api.<domain>/v1/auth/google/callback` as an
   authorized redirect URI.
7. MongoDB Atlas: a database user with `readWrite` on `geostrategy`. Network
   access `0.0.0.0/0` is the pragmatic M0 choice; the credential is the gate.

The machine is always on (`min_machines_running = 1`). Reason: the job worker and
the billing revalidator run in-process. The cost is about USD 3 per month.
The JVM heap cap is 300 MB on a 512 MB machine. Raise both together if the
crawler needs more memory.
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore backend/.dockerignore backend/Dockerfile backend/fly.toml backend/README.md
git commit -m "build(backend): fly.toml vm/health tuning, JVM heap cap, dockerignore"
```

---

### Task 2: Backend test database seam for CI

**Files:**
- Modify: `backend/src/test/kotlin/app/geostrategy/TestSupport.kt:28-38`
- Modify: `backend/README.md` ("Local development" section)

**Interfaces:**
- Consumes: env var `MONGODB_TEST_URI` (optional).
- Produces: `TestMongo.freshDb()` unchanged. Task 5 sets `MONGODB_TEST_URI=mongodb://localhost:27017` in CI.

- [ ] **Step 1: Show that the env var has no effect yet**

Start a plain Mongo and point the tests at it, while the seam does not exist yet:

```bash
docker run -d --rm --name gs-mongo-ci -p 27018:27017 mongo:7.0
cd backend
MONGODB_TEST_URI=mongodb://localhost:27018 DOCKER_API_VERSION=1.44 ./gradlew test --no-daemon -q --tests 'app.geostrategy.users.*'
```

Expected: the tests still start a Testcontainers container (the log shows `Creating container for image: mongo:7.0`). The env var has no effect yet. This is the behaviour the seam changes.

- [ ] **Step 2: Add the seam**

In `TestSupport.kt`, replace the `TestMongo` object with:

```kotlin
/**
 * Test database. Local runs start one shared Testcontainers Mongo. CI sets
 * MONGODB_TEST_URI to the workflow's Mongo service container. Each test class
 * gets its own database name, so the two modes isolate tests the same way.
 */
object TestMongo {
    private val container: MongoDBContainer by lazy {
        MongoDBContainer("mongo:7.0").also { it.start() }
    }
    private val connectionString: String by lazy {
        System.getenv("MONGODB_TEST_URI")?.takeIf { it.isNotBlank() } ?: container.connectionString
    }
    private val client: MongoClient by lazy { MongoClient.create(connectionString) }

    fun freshDb(): MongoDatabase {
        val db = client.getDatabase("t" + UUID.randomUUID().toString().replace("-", ""))
        runBlocking { ensureIndexes(db) }
        return db
    }
}
```

- [ ] **Step 3: Run the tests in both modes**

CI mode (no Testcontainers container starts):

```bash
cd backend
MONGODB_TEST_URI=mongodb://localhost:27018 DOCKER_API_VERSION=1.44 ./gradlew test --no-daemon -q 2>&1 | grep -c 'Creating container' 
```

Expected: `0`. Then check the results: `grep -ho 'failures="[0-9]*"' build/test-results/test/*.xml | sort | uniq -c` shows only `failures="0"`.

Local mode:

```bash
docker rm -f gs-mongo-ci
DOCKER_API_VERSION=1.44 ./gradlew test --no-daemon -q
```

Expected: exit code 0, 117 tests, 0 failures.

- [ ] **Step 4: Document the seam**

In `backend/README.md`, section "## Local development", add after item 5:

```markdown
6. The tests start one shared Testcontainers Mongo. To use a Mongo that already
   runs, set `MONGODB_TEST_URI` (for example `mongodb://localhost:27017`). CI
   uses this seam with a `mongo:7.0` service container.
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/test/kotlin/app/geostrategy/TestSupport.kt backend/README.md
git commit -m "test(backend): MONGODB_TEST_URI seam for CI service container"
```

---

### Task 3: Frontend environment files

**Files:**
- Create: `frontend/src/environments/environment.ts`
- Create: `frontend/src/environments/environment.production.ts`
- Modify: `frontend/angular.json` (production configuration)
- Modify: `frontend/src/app/core/config.ts`
- Modify: `frontend/README.md` (sections "Connect to the API in production" and "Before production")

**Interfaces:**
- Consumes: nothing new.
- Produces: `environment.apiBaseUrl: string`, `environment.freemiusProductId: string`, `environment.freemiusPublicKey: string`, `environment.production: boolean`. `config.ts` keeps its exported names `API_BASE`, `FREEMIUS_PRODUCT_ID`, `FREEMIUS_PUBLIC_KEY`, `FREEMIUS_PORTAL_URL`, `PENDING_URL_KEY`. No consumer changes.

- [ ] **Step 1: Create the development environment (the default file)**

`frontend/src/environments/environment.ts`:

```ts
// Development values. `ng serve`, `ng test`, and the Playwright suite use this file.
// The production build replaces it with environment.production.ts (see angular.json).
// Nothing in this file is secret. Every value ships to every browser.
export const environment = {
  production: false,
  // Empty string = same origin. The dev server proxies /v1 and /healthz to
  // localhost:8080 (proxy.conf.json).
  apiBaseUrl: '',
  freemiusProductId: 'REPLACE_ME_FREEMIUS_PRODUCT_ID',
  freemiusPublicKey: 'REPLACE_ME_FREEMIUS_PUBLIC_KEY',
};
```

- [ ] **Step 2: Create the production environment**

`frontend/src/environments/environment.production.ts`:

```ts
// Production values. The API runs on its own origin, so every call is absolute.
// The session cookie is same-site (app.<domain> and api.<domain> share one
// registrable domain), so SameSite=Lax works. Replace REPLACE_ME_DOMAIN before
// the first production deploy.
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.REPLACE_ME_DOMAIN',
  freemiusProductId: 'REPLACE_ME_FREEMIUS_PRODUCT_ID',
  freemiusPublicKey: 'REPLACE_ME_FREEMIUS_PUBLIC_KEY',
};
```

- [ ] **Step 3: Wire the file replacement**

In `frontend/angular.json`, inside `projects.frontend.architect.build.configurations.production`, add before `"budgets"`:

```json
"fileReplacements": [
  {
    "replace": "src/environments/environment.ts",
    "with": "src/environments/environment.production.ts"
  }
],
```

- [ ] **Step 4: Point config.ts at the environment**

Replace the content of `frontend/src/app/core/config.ts` with:

```ts
import { environment } from '../../environments/environment';

// The API origin. Empty in dev (same origin through the dev proxy). Absolute in prod.
export const API_BASE = environment.apiBaseUrl;
export const FREEMIUS_PRODUCT_ID = environment.freemiusProductId;
export const FREEMIUS_PUBLIC_KEY = environment.freemiusPublicKey;
export const FREEMIUS_PORTAL_URL = 'https://users.freemius.com'; // customer portal entry
// sessionStorage key for the URL a visitor typed on the landing page before signing up or
// logging in; the dashboard reads it back out to pick up where that flow left off.
export const PENDING_URL_KEY = 'geostrategy.pendingUrl';
```

- [ ] **Step 5: Run the unit tests**

Run from `frontend/`: `npx ng test --watch=false --browsers=ChromeHeadless`

Expected: `TOTAL: 78 SUCCESS`. The tests use the dev file, so `API_BASE` is still `''`.

- [ ] **Step 6: Check both builds**

```bash
cd frontend
npm run build
grep -l 'api.REPLACE_ME_DOMAIN' dist/frontend/browser/*.js | head -1
grep -c 'api.REPLACE_ME_DOMAIN' dist/frontend/browser/main-*.js
npx ng build --configuration development
grep -c 'api.REPLACE_ME_DOMAIN' dist/frontend/browser/main.js
```

Expected: the production build has at least one file with the marker (count ≥ 1). The development build count is `0`. If `main-*.js` does not match, search all `dist/frontend/browser/*.js`.

- [ ] **Step 7: Update the frontend README**

Replace the section "## Connect to the API in production" with:

```markdown
## Environments

`src/environments/environment.ts` holds the development values. `npm run build`
replaces it with `src/environments/environment.production.ts` (see
`fileReplacements` in `angular.json`). Nothing in these files is secret. Every
value ships to every browser.

| Key | Development | Production |
|-----|-------------|------------|
| `apiBaseUrl` | `''` (same origin, dev proxy) | `https://api.<domain>` |
| `freemiusProductId` | `REPLACE_ME_FREEMIUS_PRODUCT_ID` | the real product id |
| `freemiusPublicKey` | `REPLACE_ME_FREEMIUS_PUBLIC_KEY` | the real public key |

The SPA and the API share one registrable domain (`app.<domain>` and
`api.<domain>`). The session cookie is same-site, so `SameSite=Lax` works. The
backend allows the SPA origin in CORS through `APP_URL`.
```

In the section "## Before production", replace the two `config.ts` bullets with:

```markdown
- Replace `REPLACE_ME_DOMAIN` in `src/environments/environment.production.ts` with the real
  domain.
- Replace `REPLACE_ME_FREEMIUS_PRODUCT_ID` and `REPLACE_ME_FREEMIUS_PUBLIC_KEY` in
  `src/environments/environment.production.ts` with the real Freemius values.
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/environments frontend/angular.json frontend/src/app/core/config.ts frontend/README.md
git commit -m "feat(frontend): environment files with production API origin"
```

---

### Task 4: Cloudflare Pages static files

**Files:**
- Modify: `frontend/public/_redirects`
- Create: `frontend/public/404.html`
- Create: `frontend/public/_headers`
- Create: `frontend/public/robots.txt`
- Modify: `frontend/README.md` (section "## Deploy to Cloudflare Pages")

**Interfaces:**
- Consumes: the route list in `frontend/src/app/app.routes.ts`.
- Produces: files copied to `dist/frontend/browser/` by the `assets` glob in `angular.json`. Task 5 deploys that directory.

- [ ] **Step 1: Write the redirect rows**

Replace the content of `frontend/public/_redirects` with:

```
# Cloudflare Pages rewrite rules. Read docs/2026-08-16-platform-config-playbook.md §2.1
# before you change this file.
# - The destination is "/", never "/index.html". Pages turns "/index.html" into a 308.
# - Every client route needs a row, plus its trailing-slash twin.
# - A path with no row falls through to 404.html.
# - Test only on a real preview deployment (--branch=preview). "wrangler pages dev"
#   cannot parse these rules correctly.
/pricing / 200
/pricing/ / 200
/terms / 200
/terms/ / 200
/privacy / 200
/privacy/ / 200
/login / 200
/login/ / 200
/signup / 200
/signup/ / 200
/verify-email / 200
/verify-email/ / 200
/auth/complete / 200
/auth/complete/ / 200
/reset-password / 200
/reset-password/ / 200
/reset-password/confirm / 200
/reset-password/confirm/ / 200
/dashboard / 200
/dashboard/ / 200
/assessments/* / 200
/sites/* / 200
/account / 200
/account/ / 200
```

- [ ] **Step 2: Write the 404 page**

`frontend/public/404.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Page not found · GeoStrategy</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { text-align: center; padding: 2rem; }
  </style>
</head>
<body>
  <main>
    <h1>Page not found</h1>
    <p>This address does not exist. <a href="/">Go to the home page.</a></p>
  </main>
</body>
</html>
```

- [ ] **Step 3: Write the headers file**

`frontend/public/_headers`:

```
/404
  X-Robots-Tag: noindex
/404.html
  X-Robots-Tag: noindex
```

- [ ] **Step 4: Write robots.txt**

`frontend/public/robots.txt`:

```
User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /assessments/
Disallow: /sites/
Disallow: /account
Disallow: /auth/
Disallow: /verify-email
Disallow: /reset-password
```

- [ ] **Step 5: Build and check the output**

```bash
cd frontend
npm run build
ls dist/frontend/browser/_redirects dist/frontend/browser/_headers dist/frontend/browser/404.html dist/frontend/browser/robots.txt
grep -c ' / 200$' dist/frontend/browser/_redirects
grep -c '/index.html' dist/frontend/browser/_redirects
```

Expected: all four files exist. Row count `24`. `/index.html` count `0`.

- [ ] **Step 6: Cross-check the rows against the routes**

Run from `frontend/`:

```bash
grep -oE "path: '[^'*:]+" src/app/app.routes.ts | sed "s/path: '//" | sort -u
```

The command prints each route path up to its first parameter (`assessments/`, `sites/`) and skips the root and the `**` route. Every printed path must have a row in `_redirects`, either as an exact row or under a `/*` row (`assessments/` → `/assessments/*`, `sites/` → `/sites/*`). Fix any miss.

- [ ] **Step 7: Update the frontend README deploy section**

Replace the section "## Deploy to Cloudflare Pages" with:

```markdown
## Deploy to Cloudflare Pages

CI deploys the frontend after each merge to `main` (see `.github/workflows/ci.yml`).
The Pages project is a **direct-upload** project. Do these steps once, by hand.

1. Create the Pages project: `npx wrangler pages project create geostrategy --production-branch=main`.
2. Build and upload once by hand: `npm run build`, then
   `npx wrangler pages deploy dist/frontend/browser --project-name=geostrategy --branch=main`.
3. Attach the custom domain `app.<domain>` to the project in the Cloudflare dashboard.
4. Add the repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` on
   GitHub. Scope the token to the account with `Pages:Edit` only.

### Files in `public/` that Pages reads

- `_redirects` — one rewrite row per client route, destination `/`. A path with no
  row answers with `404.html`. **Add a row for every new client route.** Read the
  comment at the top of the file before you change it.
- `404.html` — the real 404 page. Without it, every bad URL answers 200 with the
  app shell (a soft 404).
- `_headers` — `X-Robots-Tag: noindex` for the 404 page.
- `robots.txt` — allows the public pages, blocks the app routes.

### Test a change to `_redirects`

Deploy a preview and test it in a real browser. The local emulator
(`wrangler pages dev`) cannot parse these rules correctly. Do not trust it.

    npm run build
    npx wrangler pages deploy dist/frontend/browser --project-name=geostrategy --branch=preview

Then open the preview URL and check: a hard navigation to `/login` shows the login
page (200), `/dashboard/` (trailing slash) shows the app, and `/no-such-page` shows
the 404 page with status 404.
```

- [ ] **Step 8: Commit**

```bash
git add frontend/public frontend/README.md
git commit -m "feat(frontend): explicit Pages redirects, real 404, headers, robots"
```

---

### Task 5: GitHub Actions CI/CD workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `MONGODB_TEST_URI` seam (Task 2), `npm run build` output at `frontend/dist/frontend/browser` (Tasks 3, 4), `backend/fly.toml` (Task 1).
- Consumes secrets: `FLY_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.
- Produces: the artifact `frontend-dist`; a production Pages deployment; a Fly deployment.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
# One workflow, five jobs. See docs/2026-08-16-platform-config-playbook.md §2.3.
# 1. changes        - which half changed
# 2. backend        - Gradle tests with a Mongo service container
# 3. frontend       - unit tests, production build, e2e, artifact upload
# 4. deploy-frontend - upload the tested artifact to Cloudflare Pages (main only)
# 5. deploy-backend  - flyctl deploy --remote-only (main only)
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ github.event_name == 'workflow_dispatch' || steps.filter.outputs.backend == 'true' }}
      frontend: ${{ github.event_name == 'workflow_dispatch' || steps.filter.outputs.frontend == 'true' }}
    steps:
      - uses: actions/checkout@v7
      - id: filter
        if: github.event_name != 'workflow_dispatch'
        uses: dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d # v4.0.3
        with:
          filters: |
            backend:
              - 'backend/**'
              - '.github/workflows/ci.yml'
            frontend:
              - 'frontend/**'
              - '.github/workflows/ci.yml'

  backend:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongo:7.0
        ports:
          - 27017:27017
        options: >-
          --health-cmd "mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: '21'
      - uses: gradle/actions/setup-gradle@v6
      - name: Test
        run: ./gradlew test --no-daemon
        env:
          MONGODB_TEST_URI: mongodb://localhost:27017
      - if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: backend-test-report
          path: backend/build/reports/tests/test

  frontend:
    needs: changes
    if: needs.changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - name: Unit tests
        run: npx ng test --watch=false --browsers=ChromeHeadless
      - name: Production build
        run: npm run build
      - name: Install Playwright browser
        run: npx playwright install --with-deps chromium
      - name: End-to-end tests
        run: npx playwright test
      - if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: frontend/playwright-report
      - if: github.event_name != 'pull_request'
        uses: actions/upload-artifact@v7
        with:
          name: frontend-dist
          path: frontend/dist/frontend/browser
          if-no-files-found: error

  deploy-frontend:
    needs: [changes, backend, frontend]
    if: >-
      ${{ !cancelled()
          && github.ref == 'refs/heads/main'
          && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
          && needs.frontend.result == 'success'
          && (needs.backend.result == 'success' || needs.backend.result == 'skipped') }}
    runs-on: ubuntu-latest
    # Own group, never cancel: a backend deploy must not cancel a pending frontend deploy.
    concurrency:
      group: deploy-frontend
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v8
        with:
          name: frontend-dist
          path: frontend-dist
      - uses: cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0 # v4.0.0
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy frontend-dist --project-name=geostrategy --branch=main

  deploy-backend:
    needs: [changes, backend, frontend]
    if: >-
      ${{ !cancelled()
          && github.ref == 'refs/heads/main'
          && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
          && needs.backend.result == 'success'
          && (needs.frontend.result == 'success' || needs.frontend.result == 'skipped') }}
    runs-on: ubuntu-latest
    concurrency:
      group: deploy-backend
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v7
      - uses: superfly/flyctl-actions/setup-flyctl@ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1 # 1.6
      - run: flyctl deploy --remote-only
        working-directory: backend
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 2: Lint the workflow**

Run from the repository root:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no output (exit 0). Fix every reported problem. If the shellcheck warnings concern quoting only, fix them too.

- [ ] **Step 3: Rehearse the frontend job locally**

Run from `frontend/` with the same commands as the workflow:

```bash
npx ng test --watch=false --browsers=ChromeHeadless
npm run build
npx playwright install chromium
npx playwright test
```

Expected: `TOTAL: 78 SUCCESS`; a build with no error; `1 passed` from Playwright.

- [ ] **Step 4: Rehearse the backend job locally**

```bash
docker run -d --rm --name gs-mongo-ci -p 27018:27017 mongo:7.0
cd backend
MONGODB_TEST_URI=mongodb://localhost:27018 DOCKER_API_VERSION=1.44 ./gradlew test --no-daemon -q
docker rm -f gs-mongo-ci
```

Expected: exit 0, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: test both halves, deploy on merge to main"
```

The first real run happens after the owner pushes `main` and adds the three
repository secrets. Record that as an open manual step in the task report.

---

### Task 6: Update the launch checklist

**Files:**
- Modify: `docs/launch-checklist.md`

**Interfaces:**
- Consumes: the file names and the commands from Tasks 1–5.
- Produces: the owner's manual runbook.

- [ ] **Step 1: Update the placeholders block**

After the line `- The SPA runs at https://app.<your-domain>. The API runs at https://api.<your-domain>.` add:

```markdown
- Both hosts share one registrable domain. The session cookie is same-site, so
  `SameSite=Lax` works. Keep this layout.
- The GitHub repository is `xamcross/traficio`. It is public. The default branch is `main`.
```

- [ ] **Step 2: Add a repository step before section 3**

Insert a new section after section 2 and renumber the later sections (3→4, 4→5, 5→6, 6→7, 7→8, 8→9, 9→10, 10→11). Update the "Order summary" line at the end to the new numbers.

```markdown
## 3. Push the repository and set the CI secrets

- [ ] 3.1 Rename the local branch once: `git branch -m master main`.
- [ ] 3.2 Push: `git push -u origin main`. The repository is public. Confirm that no
      secret is in the tree before you push (`git grep -n -i 'sk-ant-'` must be empty).
- [ ] 3.3 In GitHub → Settings → Secrets and variables → Actions, add:
      `FLY_API_TOKEN` (from `fly tokens create deploy -x 999999h`),
      `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (scope: the account, `Pages:Edit` only).
- [ ] 3.4 The workflow `.github/workflows/ci.yml` runs on each push to `main`. It
      deploys the backend and the frontend after the tests pass. Do steps 4 and 8
      once by hand first, so the Fly app and the Pages project exist.
```

- [ ] **Step 3: Update the backend deploy section (new number 4)**

Replace the secrets block in step 4.2 (old 3.2) with:

```
      MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?maxPoolSize=50&minPoolSize=5"
      MONGODB_DB="geostrategy"
      BASE_URL="https://api.<your-domain>"
      APP_URL="https://app.<your-domain>"
      RESEND_API_KEY="re_..."
      EMAIL_FROM="GeoStrategy <noreply@<your-domain>>"
      GOOGLE_CLIENT_ID="..."
      GOOGLE_CLIENT_SECRET="..."
      ANTHROPIC_API_KEY="sk-ant-..."
      FREEMIUS_SECRET_KEY="..."
      FREEMIUS_PRO_PLAN_ID="..."
```

After the "Optional values" paragraph add:

```markdown
      Do not set `COOKIE_DOMAIN`. The cookie is host-only on `api.<your-domain>`, and
      that is enough. If you set it, use `<your-domain>` with no leading dot.
      The machine is always on (`min_machines_running = 1` in `fly.toml`) because the
      job worker runs in-process. Expect about USD 3 per month.
```

Replace old 3.5 with:

```markdown
- [ ] 4.5 Check `https://<fly-app-name>.fly.dev/healthz`. It must return `ok`. The
      first boot can take up to two minutes; the health check grace period covers it.
```

- [ ] **Step 4: Update the frontend section (new number 8)**

Replace old 7.1 with:

```markdown
- [ ] 8.1 Edit `frontend/src/environments/environment.production.ts`:
      - Replace `REPLACE_ME_DOMAIN` with `<your-domain>`.
      - Replace `REPLACE_ME_FREEMIUS_PRODUCT_ID` with the Freemius product id.
      - Replace `REPLACE_ME_FREEMIUS_PUBLIC_KEY` with the Freemius public key.
```

Delete old 7.4 (the Option A / Option B choice). The API origin is fixed at
`https://api.<your-domain>`.

Replace old 7.6 with:

```markdown
- [ ] 8.5 Create the Pages project as a direct-upload project and deploy once by hand,
      from `frontend/`:
      `npx wrangler pages project create geostrategy --production-branch=main`
      `npm run build`
      `npx wrangler pages deploy dist/frontend/browser --project-name=geostrategy --branch=main`
      After this, CI deploys on each merge to `main`.
```

Replace old 7.8 with:

```markdown
- [ ] 8.7 Open `https://app.<your-domain>`. Confirm: the landing page loads; a hard
      navigation to `/login` shows the login page; `/dashboard/` (trailing slash) shows
      the app; `/no-such-page` shows the 404 page with status 404.
```

- [ ] **Step 5: Renumber and check the links**

Renumber every later section and every cross-reference (for example "You need it in step 3.2" → "step 4.2"; "Steps 1–7 must finish before step 8" → "Steps 1–8 must finish before step 9"). Then run:

```bash
grep -n -E '^## [0-9]+\.' docs/launch-checklist.md
grep -n -E 'step [0-9]+\.[0-9]+' docs/launch-checklist.md
```

Expected: section numbers 1 to 11 in order. Every `step N.M` reference points at an existing item.

- [ ] **Step 6: Commit**

```bash
git add docs/launch-checklist.md
git commit -m "docs: launch checklist follows the platform playbook"
```

---

## Playbook coverage check

| Playbook section | Covered by | Note |
|------------------|-----------|------|
| §1 one registrable domain, credentialed CORS allowlist | Existing code (`installCors` uses `APP_URL`), Task 3, docs | Single origin allowlist. Preview origins are not allowed. Add a `CORS_ALLOWED_ORIGINS` list later if previews need the API. |
| §2.1 direct-upload Pages, `_redirects` rules, real 404, `_headers` | Task 4, Task 5 | No prerender (D6). |
| §2.2 fly.toml, heap cap, grace period, health, always-on | Task 1 | Ktor: no `SERVER_FORWARD_HEADERS_STRATEGY`. `BASE_URL` builds the OAuth redirect URI. `secureCookies` derives from `BASE_URL`. |
| §2.3 CI/CD five jobs, concurrency, SHA pins, Node pin, build script | Task 5 | Playwright added (D5). |
| §3 Atlas URI pool cap, test seam, Windows Testcontainers notes | Task 1 (docs), Task 2 | Ktor uses `MONGODB_URI` + `MONGODB_DB`; unchanged. |
| §4 cookie name/flags, `COOKIE_DOMAIN` form, OIDC redirect | Existing code, D3, docs | Session cookie `gs_session` is httpOnly, Lax, Secure in prod. CSRF: this API uses a Lax cookie and JSON bodies; no double-submit token exists. Out of scope; note for a security follow-up. |
| §5 Freemius env, webhook, AdSense | Existing code, docs | AdSense does not apply. |
| §6 environments, secrets parity, SEO files, site identity | Task 3, Task 4, docs | No sitemap or `llms.txt` (no content build). No `site-identity.json` (D8). |
| §7 ordering | Task 6 | |

## Manual owner steps that no task can do

1. Rename `master` → `main`, push to `xamcross/traficio`.
2. Add the three repository secrets on GitHub.
3. Create the Fly app, set the Fly secrets, first `fly deploy`, cert + DNS.
4. Create the Pages project (direct upload), first deploy, custom domain.
5. Google OAuth redirect URI; Freemius webhook URL; Atlas user and network access.
6. Deploy a `--branch=preview` build and test the `_redirects` rules in a real browser.
