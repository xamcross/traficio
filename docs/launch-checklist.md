# GeoStrategy — Manual Launch Checklist

All code for v1 is complete and merged to `master`. This document lists the manual
actions that remain before launch. Do the steps in order. Each step tells you where
the action happens. Sentences follow ASD-STE100.

Placeholders in this document:

- `<your-domain>` — your production domain, for example `geostrategy.app`.
- The SPA runs at `https://app.<your-domain>`. The API runs at `https://api.<your-domain>`.

---

## 1. Create the external accounts

Do these first. Later steps need their credentials.

- [ ] 1.1 Create a **MongoDB Atlas** cluster (M0 is enough to start). Choose the same
      region that you will use on Fly.io.
- [ ] 1.2 Create an **Anthropic** account at console.anthropic.com. Create an API key.
- [ ] 1.3 Create a **Resend** account. Verify your sending domain. Create an API key.
- [ ] 1.4 Create a **Google Cloud** OAuth client (type: Web application). Note the
      client id and the client secret.
- [ ] 1.5 Create a **Freemius** account. Create the product and the Pro plan. Set the
      price in the Freemius dashboard. Note: the product id, the public key, the
      secret key, and the Pro plan id.
- [ ] 1.6 Create a **Cloudflare** account. Add `<your-domain>` as a zone.
- [ ] 1.7 Create a **Fly.io** account. Install `flyctl` on your machine.

## 2. Configure MongoDB Atlas

- [ ] 2.1 Create a database user with `readWrite` on the `geostrategy` database.
- [ ] 2.2 Open Network Access. Allow the Fly.io egress IPs. If you do not know them
      yet, allow `0.0.0.0/0` temporarily and use a strong password. Tighten this
      after the first deploy.
- [ ] 2.3 Copy the connection string (`mongodb+srv://...`). You need it in step 3.2.

## 3. Deploy the backend to Fly.io

Work from the `backend/` directory.

- [ ] 3.1 Run `fly launch --no-deploy --copy-config`. Accept the existing `fly.toml`.
      Adjust the app name and the region.
- [ ] 3.2 Set the secrets. Use one `fly secrets set` command with these values:

      MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net"
      MONGODB_DB="geostrategy"
      BASE_URL="https://api.<your-domain>"
      APP_URL="https://app.<your-domain>"
      COOKIE_DOMAIN=".<your-domain>"
      RESEND_API_KEY="re_..."
      EMAIL_FROM="GeoStrategy <noreply@<your-domain>>"
      GOOGLE_CLIENT_ID="..."
      GOOGLE_CLIENT_SECRET="..."
      ANTHROPIC_API_KEY="sk-ant-..."
      FREEMIUS_SECRET_KEY="..."
      FREEMIUS_PRO_PLAN_ID="..."

      Optional values with safe defaults: `CLAUDE_MODEL` (default `claude-opus-5`),
      `SSE_MAX_MILLIS` (default 900000), `FREEMIUS_SIGNATURE_HEADER` (default
      `X-Signature`), tier limits (`FREE_MAX_SITES=1`, `FREE_ASSESSMENTS_PER_MONTH=1`,
      `PRO_MAX_SITES=5`, `PRO_ASSESSMENTS_PER_MONTH=10`).
- [ ] 3.3 Run `fly deploy`.
- [ ] 3.4 Run `fly certs add api.<your-domain>`.
- [ ] 3.5 Check `https://<fly-app-name>.fly.dev/healthz`. It must return `ok`.

## 4. Configure Cloudflare DNS and protection

- [ ] 4.1 Add a CNAME record: `api` → `<fly-app-name>.fly.dev`. Set it to proxied.
- [ ] 4.2 Check `https://api.<your-domain>/healthz`. It must return `ok`.
- [ ] 4.3 Add WAF rate-limiting rules for `api.<your-domain>`. Cover at minimum:
      `POST /v1/auth/*` and `POST /v1/sites/*/assessments`. These endpoints are
      the abuse targets.

## 5. Configure Google OAuth

- [ ] 5.1 In the Google Cloud Console, open your OAuth client.
- [ ] 5.2 Add this authorized redirect URI:
      `https://api.<your-domain>/v1/auth/google/callback`.

## 6. Configure Freemius

- [ ] 6.1 In the Freemius dashboard, set the webhook URL to:
      `https://api.<your-domain>/v1/billing/freemius/webhook`.
- [ ] 6.2 Send a test webhook from the Freemius dashboard. Then read the Fly logs
      (`fly logs`). Confirm the server answers 200 and the signature verifies.
- [ ] 6.3 **Verify the contract.** Compare one real webhook payload and its signature
      header name against the parser's expectations. The test fixtures define the
      current contract. If the header name differs from `X-Signature`, set
      `FREEMIUS_SIGNATURE_HEADER`. If the payload shape differs, stop and report it —
      the parser needs a code change.
      Known accepted limits (documented in `backend/README.md`): the webhook has no
      replay protection, and verification uses the decoded text, not the raw bytes.

## 7. Configure and deploy the frontend

- [ ] 7.1 Edit `frontend/src/app/core/config.ts`:
      - Replace `REPLACE_ME_FREEMIUS_PRODUCT_ID` with the Freemius product id.
      - Replace `REPLACE_ME_FREEMIUS_PUBLIC_KEY` with the Freemius public key.
- [ ] 7.2 Replace `REPLACE_ME_CONTACT_EMAIL` in
      `frontend/src/app/features/legal/terms.ts` and
      `frontend/src/app/features/legal/privacy.ts` with your contact address.
- [ ] 7.3 Review the legal pages. The current texts are short v1 stubs. Confirm they
      are acceptable for your jurisdiction, or replace them.
- [ ] 7.4 Choose the API connection option (see `frontend/README.md`):
      - Option A (same origin): route `app.<your-domain>/v1/*` to the API with a
        Cloudflare Worker or Origin Rule. Keep `API_BASE = ''`.
      - Option B (separate subdomain): set `API_BASE = 'https://api.<your-domain>'`
        in `config.ts`. `APP_URL` and `COOKIE_DOMAIN` are already set in step 3.2.
- [ ] 7.5 Commit the edits from 7.1–7.4.
- [ ] 7.6 Create a Cloudflare Pages project from the repository:
      - Root directory: `frontend`
      - Build command: `npx ng build`
      - Output directory: `dist/frontend/browser`
- [ ] 7.7 Add the custom domain `app.<your-domain>` to the Pages project.
- [ ] 7.8 Open `https://app.<your-domain>`. Confirm the landing page loads and deep
      links work (the `_redirects` file serves the app on all routes).

## 8. Smoke tests with real services

Run these once after deploy. They cover the paths that tests could not cover
with mocks and canned clients.

- [ ] 8.1 **Email flow.** Register with a real address. Confirm the verification
      email arrives. Click the link. Confirm the account verifies.
- [ ] 8.2 **Password reset.** Request a reset. Click the emailed link
      (`/reset-password?token=...`). Confirm the new password works.
- [ ] 8.3 **Google sign-in.** Log in with Google. Confirm you land on the dashboard.
- [ ] 8.4 **Live-key assessment (streaming smoke test).** Add a real site. Run one
      assessment with the real `ANTHROPIC_API_KEY`. Watch `fly logs`. Confirm: the
      crawl completes, both Claude calls stream and finish, scores and a plan
      appear, and the recorded cost on the assessment document is plausible
      (~$0.30–0.75). This is the first real test of the streaming client with
      structured outputs.
- [ ] 8.5 **Checkout in sandbox.** Put Freemius in sandbox mode. Buy Pro from the
      pricing page. Confirm: the overlay opens with your email pre-filled, the
      webhook upgrades the account to Pro, and the account page shows the Pro
      limits and the "Manage subscription" link.
- [ ] 8.6 **Downgrade path.** Cancel or refund the sandbox purchase. Confirm the
      account returns to Free and extra sites become read-only.
- [ ] 8.7 **Session across subdomains** (Option B only): log in on `app.` and
      confirm API calls to `api.` carry the session (no 401s).

## 9. Prompt quality check (from the spec, manual)

- [ ] 9.1 Assemble an evaluation set of about 10 real sites. Vary the platform
      (WordPress, Wix, Shopify, custom) and the quality.
- [ ] 9.2 Run an assessment for each site. Review each report and plan.
- [ ] 9.3 Check: the scores are sane, the findings match the site, and a beginner
      can follow every task step. Repeat this check before any future prompt change.

## 10. Outstanding engineering work (needs your input, then code)

These are not dashboard actions. They are small code tasks that wait on real
account data or a decision. Ask for them when you are ready.

- [ ] 10.1 **Real `FreemiusClient`.** The daily license revalidator currently uses a
      canned client. It downgrades only on stored expiry dates. A real client needs
      the Freemius API credentials from step 1.5 and one endpoint call
      (license validation). Small task; do it before you rely on revalidation.
- [ ] 10.2 **Deferred code minors.** A hygiene pass is ledgered in
      `.superpowers/sdd/2026-08-06-angular-frontend/progress.md` and
      `.superpowers/sdd/2026-08-06-billing-hardening/progress.md`
      (keyboard access for task expand, shared error helper, global 401 redirect,
      severity-badge styling, site ordering, and similar). None block launch.

---

**Order summary:** accounts (1) → Atlas (2) → backend deploy (3) → DNS/WAF (4) →
Google (5) → Freemius (6) → frontend deploy (7) → smoke tests (8) → prompt QA (9).
Steps 1–7 must finish before step 8. Step 10 can run in parallel after step 6.
