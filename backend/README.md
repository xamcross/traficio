# GeoStrategy backend

Frontend: see `../frontend/README.md` for the web app.

## Local development
1. Prereqs: JDK 21, Docker Desktop (for Testcontainers and a local Mongo).
2. Run Mongo locally: `docker run -d -p 27017:27017 --name gs-mongo mongo:7.0`
3. Run tests: `./gradlew test`
4. Run the server: `./gradlew run` (health check: http://localhost:8080/healthz)
5. Note: `build.gradle.kts` pins Docker API version 1.44 for Testcontainers because Docker Engine 29+ rejects the older default (set via `systemProperty("api.version", "1.44")`).
6. The tests start one shared Testcontainers Mongo. To use a Mongo that already
   runs, set `MONGODB_TEST_URI` (for example `mongodb://localhost:27017`). CI
   uses this seam with a `mongo:7.0` service container.

Without `RESEND_API_KEY`, emails are logged to stdout instead of sent —
copy the `token=` value from the log line to complete flows manually.

## Deploy to Fly.io (first time)

CI deploys the backend after each merge to `master` (see `.github/workflows/ci.yml`).
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
   `<fly-app-name>.fly.dev` (proxied).
5. Check `https://api.<domain>/healthz`. It must return `ok`.
6. Google Cloud Console: add `https://api.<domain>/v1/auth/google/callback` as an
   authorized redirect URI.
7. MongoDB Atlas: a database user with `readWrite` on `geostrategy`. Network
   access `0.0.0.0/0` is the pragmatic M0 choice; the credential is the gate.

The machine is always on (`min_machines_running = 1`). Reason: the job worker and
the billing revalidator run in-process. The cost is a few US dollars per month.
Check the current Fly.io price list.
The JVM heap cap is 300 MB on a 512 MB machine. Raise both together if the
crawler needs more memory.
If `fly logs` shows an out-of-memory kill, set `memory = "1gb"` in `fly.toml`.

## Assessment engine

The engine crawls a site, then asks Claude for an analysis and a plan.
Set these environment variables:

- `ANTHROPIC_API_KEY` — the Anthropic API key. If you do not set it, the app
  uses a canned client. The canned client gives deterministic results and
  makes no network calls. Use it for local development.
- `CLAUDE_MODEL` — the model id. The default is `claude-opus-5`.
- `FREE_MAX_SITES` (default 1), `FREE_ASSESSMENTS_PER_MONTH` (default 1),
  `PRO_MAX_SITES` (default 5), `PRO_ASSESSMENTS_PER_MONTH` (default 10) —
  the tier limits.

How an assessment runs:
1. The user sends `POST /v1/sites/{id}/assessments`.
2. The API checks the email verification, the tier, and the quota.
3. A job goes on the queue. The worker picks it up.
4. The worker crawls the site, calls Claude two times, and stores the plan.
5. The client follows the progress on `GET /v1/assessments/{id}/events` (SSE).

### API contract for the One Thing screens

- The plan is a Pro feature. `GET /v1/assessments/{id}/plan` and `GET /v1/sites/{id}/plan`
  return a locked plan for a Free user: `locked: true`, task titles, impact, effort, and
  `stepCount`, but `steps`, `whyItMatters`, and `doneCheck` are `null`.
  `PATCH /v1/plans/{planId}/tasks/{taskId}` answers 403 `upgrade_required` for a Free user.
- The analysis returns `summary` and `scoreNotes` and can add up to two findings with
  severity `good`. The pipeline gives no `good` finding to the plan call.
- Every `scores` object in the API carries a derived `overall` (round half up of the mean).
- `AssessmentDto` carries `pageCount` (crawled pages; `null` before the crawl) and `changes`.
  `changes` is filled only by the history list `GET /v1/sites/{id}/assessments`. On every other
  assessment response it is `[]`, which means "not computed", not "nothing changed".
  In the history list, a change belongs to the check in whose window the task's `completedAt`
  falls. When a later check verifies a task that the user marked done, the task moves to that
  later check's row.
- `SiteDto` carries `latestAssessment` (id, status, createdAt, completedAt) and
  `latestReadyAssessmentId`. Both are `null` for a site with no check.
- `GET /v1/me/usage` carries `nextCheckAt`: the instant the next check opens when the user is
  at the limit, else `null`.

## Billing (Freemius)

Set these environment variables to enable billing:

- `FREEMIUS_SECRET_KEY` — the store secret. Without it, the webhook answers 503.
- `FREEMIUS_PRO_PLAN_ID` — the Pro plan id. Events for other plans are ignored.
- `FREEMIUS_SIGNATURE_HEADER` — the signature header name. The default is `X-Signature`.

Point the Freemius webhook to `POST /v1/billing/freemius/webhook`.
The server verifies each call with HMAC-SHA256 over the raw body.

Warning: verify the signature header name and the payload shapes against real
Freemius webhooks before production. The test fixtures define the parser's
current contract. The webhook has no replay protection. The signature covers
only the body, and verification uses the decoded text, not the raw bytes.
Review both points before production.

## Before production with a real Anthropic key

1. Set `ANTHROPIC_API_KEY`. The client streams responses to avoid timeouts.
2. The assessment job lease is 900 seconds. Do not lower it for slow sites.
3. Implement a real `FreemiusClient` for license revalidation. The canned
   client only downgrades on expiry dates.
4. Review `SSE_MAX_MILLIS` (default 900000). Clients reconnect after the cap.
