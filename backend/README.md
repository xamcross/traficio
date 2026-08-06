# GeoStrategy backend

## Local development
1. Prereqs: JDK 21, Docker Desktop (for Testcontainers and a local Mongo).
2. Run Mongo locally: `docker run -d -p 27017:27017 --name gs-mongo mongo:7.0`
3. Run tests: `./gradlew test`
4. Run the server: `./gradlew run` (health check: http://localhost:8080/healthz)
5. Note: `build.gradle.kts` pins Docker API version 1.44 for Testcontainers because Docker Engine 29+ rejects the older default (set via `systemProperty("api.version", "1.44")`).

Without `RESEND_API_KEY`, emails are logged to stdout instead of sent —
copy the `token=` value from the log line to complete flows manually.

## Deploy to Fly.io (first time)
1. `fly launch --no-deploy --copy-config` (accept the existing fly.toml; adjust app name/region)
2. Set secrets:
   fly secrets set \
     MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net" \
     MONGODB_DB="geostrategy" \
     BASE_URL="https://api.<your-domain>" \
     APP_URL="https://app.<your-domain>" \
     COOKIE_DOMAIN=".<your-domain>" \
     RESEND_API_KEY="re_..." \
     EMAIL_FROM="GeoStrategy <noreply@<your-domain>>" \
     GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..."
3. `fly deploy`
4. In Cloudflare DNS: CNAME `api` -> `geostrategy-api.fly.dev` (proxied), after
   `fly certs add api.<your-domain>`.
5. Google Cloud Console: add `https://api.<your-domain>/v1/auth/google/callback`
   as an authorized redirect URI on the OAuth client.
6. MongoDB Atlas: allow the Fly.io egress IPs (or 0.0.0.0/0 + strong credentials
   to start), database user with readWrite on `geostrategy`.

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

## Billing (Freemius)

Set these environment variables to enable billing:

- `FREEMIUS_SECRET_KEY` — the store secret. Without it, the webhook answers 503.
- `FREEMIUS_PRO_PLAN_ID` — the Pro plan id. Events for other plans are ignored.
- `FREEMIUS_SIGNATURE_HEADER` — the signature header name. The default is `X-Signature`.

Point the Freemius webhook to `POST /v1/billing/freemius/webhook`.
The server verifies each call with HMAC-SHA256 over the raw body.

Warning: verify the signature header name and the payload shapes against real
Freemius webhooks before production. The test fixtures define the parser's
current contract.

## Before production with a real Anthropic key

1. Set `ANTHROPIC_API_KEY`. The client streams responses to avoid timeouts.
2. The assessment job lease is 900 seconds. Do not lower it for slow sites.
3. Implement a real `FreemiusClient` for license revalidation. The canned
   client only downgrades on expiry dates.
4. Review `SSE_MAX_MILLIS` (default 900000). Clients reconnect after the cap.
