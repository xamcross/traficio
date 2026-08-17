# GeoStrategy — Manual Launch Checklist

All code for v1 is complete and merged to `master`. This document lists the manual
actions that remain before launch. Do the steps in order. Each step tells you where
the action happens. Sentences follow ASD-STE100.

Placeholders in this document:

- `<your-domain>` — your production domain, for example `geostrategy.app`.
- The SPA runs at `https://app.<your-domain>`. The API runs at `https://api.<your-domain>`.
- Both hosts share one registrable domain. The session cookie is same-site, so
  `SameSite=Lax` works. Keep this layout.
- The GitHub repository is `xamcross/traficio`. It is public. The default branch is `master`.

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
- [ ] 2.3 Copy the connection string (`mongodb+srv://...`). You need it in step 4.2.

## 3. Push the repository and set the CI secrets

- [ ] 3.1 Push the current `master`: `git push origin master`. Confirm the default
      branch is `master`: GitHub → Settings → General → Default branch. The
      repository is public and already holds `master`. Confirm that no secret is
      in the tree before you push
      (`git grep -n -i -E 'sk-ant-|re_[A-Za-z0-9]{20,}|mongodb\+srv://|GOCSPX-'`
      must be empty).
- [ ] 3.2 In GitHub → Settings → Secrets and variables → Actions, add:
      `FLY_API_TOKEN` (from `fly tokens create deploy -x 999999h`),
      `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (scope: the account, `Pages:Edit` only).
- [ ] 3.3 The workflow `.github/workflows/ci.yml` runs on each push to `master`. It
      deploys the backend and the frontend after the tests pass. Do steps 4 and 8
      by hand first. That creates the Fly app and the Pages project that CI
      needs. The first run's two deploy jobs fail until steps 4 and 8 are done.
      That is expected. After steps 4 and 8, start the workflow once by hand
      (Actions → CI → Run workflow).

## 4. Deploy the backend to Fly.io

Work from the `backend/` directory.

- [ ] 4.1 Run `fly launch --no-deploy --copy-config`. Accept the existing `fly.toml`.
      Adjust the app name and the region.
- [ ] 4.2 Set the secrets. Use one `fly secrets set` command with these values:

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

      Optional values with safe defaults: `CLAUDE_MODEL` (default `claude-opus-5`),
      `SSE_MAX_MILLIS` (default 900000), `FREEMIUS_SIGNATURE_HEADER` (default
      `X-Signature`), tier limits (`FREE_MAX_SITES=1`, `FREE_ASSESSMENTS_PER_MONTH=1`,
      `PRO_MAX_SITES=5`, `PRO_ASSESSMENTS_PER_MONTH=10`).

      Do not set `COOKIE_DOMAIN`. The cookie is host-only on `api.<your-domain>`, and
      that is enough. If you set it, use `<your-domain>` with no leading dot.
      The machine is always on (`min_machines_running = 1` in `fly.toml`) because the
      job worker runs in-process. Expect a few US dollars per month. Check the
      current Fly.io price list.
- [ ] 4.3 Run `fly deploy`.
- [ ] 4.4 Run `fly certs add api.<your-domain>`. Then run `fly certs show
      api.<your-domain>`. Add the `_acme-challenge` CNAME that it prints to
      Cloudflare DNS. Set that record to DNS only. Wait for the status `Ready`.
- [ ] 4.5 Check `https://<fly-app-name>.fly.dev/healthz`. It must return `ok`. The
      first boot can take more than a minute. A failed health check does not stop
      the machine. It only delays the healthy state.

## 5. Configure Cloudflare DNS and protection

- [ ] 5.1 Set the SSL/TLS encryption mode of the zone to **Full (strict)**. Do this
      before you proxy any record.
- [ ] 5.2 Add a CNAME record: `api` → `<fly-app-name>.fly.dev`. Set it to proxied.
- [ ] 5.3 Check `https://api.<your-domain>/healthz`. It must return `ok`.
- [ ] 5.4 Add WAF rate-limiting rules for `api.<your-domain>`. Cover at minimum:
      `POST /v1/auth/*` and `POST /v1/sites/*/assessments`. These endpoints are
      the abuse targets.

## 6. Configure Google OAuth

- [ ] 6.1 In the Google Cloud Console, open your OAuth client.
- [ ] 6.2 Add this authorized redirect URI:
      `https://api.<your-domain>/v1/auth/google/callback`.

## 7. Configure Freemius

- [ ] 7.1 In the Freemius dashboard, set the webhook URL to:
      `https://api.<your-domain>/v1/billing/freemius/webhook`.
- [ ] 7.2 Send a test webhook from the Freemius dashboard. Then read the Fly logs
      (`fly logs`). Confirm the server answers 200 and the signature verifies.
- [ ] 7.3 **Verify the contract.** Compare one real webhook payload and its signature
      header name against the parser's expectations. The test fixtures define the
      current contract. If the header name differs from `X-Signature`, set
      `FREEMIUS_SIGNATURE_HEADER`. If the payload shape differs, stop and report it —
      the parser needs a code change.
      Known accepted limits (documented in `backend/README.md`): the webhook has no
      replay protection, and verification uses the decoded text, not the raw bytes.

## 8. Configure and deploy the frontend

- [ ] 8.1 Edit `frontend/src/environments/environment.production.ts`:
      - Replace `REPLACE_ME_DOMAIN` with `<your-domain>`.
      - Replace `REPLACE_ME_FREEMIUS_PRODUCT_ID` with the Freemius product id.
      - Replace `REPLACE_ME_FREEMIUS_PUBLIC_KEY` with the Freemius public key.
- [ ] 8.2 Replace `REPLACE_ME_CONTACT_EMAIL` in
      `frontend/src/app/features/legal/terms.ts` and
      `frontend/src/app/features/legal/privacy.ts` with your contact address.
- [ ] 8.3 Review the legal pages. The current texts are short v1 stubs. Confirm they
      are acceptable for your jurisdiction, or replace them.
- [ ] 8.4 Commit the edits from 8.1–8.3.
- [ ] 8.5 Create the Pages project as a direct-upload project. Then deploy once by
      hand from `frontend/`:
      `npx wrangler pages project create geostrategy --production-branch=master`
      `npm run build`
      `npx wrangler pages deploy dist/frontend/browser --project-name=geostrategy --branch=master`
      After this, CI deploys on each merge to `master`.
- [ ] 8.6 Add the custom domain `app.<your-domain>` to the Pages project. Add a
      Cloudflare redirect rule: `<your-domain>/*` → `https://app.<your-domain>/$1`
      (301), so the bare domain reaches the app.
- [ ] 8.7 (optional) Deploy a preview first. Then test the `_redirects` rows in a
      real browser. See `frontend/README.md`, section "Test a change to
      `_redirects`".
- [ ] 8.8 Open `https://app.<your-domain>`. Confirm: the landing page loads; a hard
      navigation to `/login` shows the login page; `/dashboard/` (trailing slash) shows
      the app; `/no-such-page` shows the 404 page with status 404.

## 9. Smoke tests with real services

Run these once after deploy. They cover the paths that tests could not cover
with mocks and canned clients.

- [ ] 9.1 **Email flow.** Register with a real address. Confirm the verification
      email arrives. Click the link. Confirm the account verifies.
- [ ] 9.2 **Password reset.** Request a reset. Click the emailed link
      (`/reset-password?token=...`). Confirm the new password works.
- [ ] 9.3 **Google sign-in.** Log in with Google. Confirm you land on the dashboard.
- [ ] 9.4 **Live-key assessment (streaming smoke test).** Add a real site. Run one
      assessment with the real `ANTHROPIC_API_KEY`. Watch `fly logs`. Confirm: the
      crawl completes, both Claude calls stream and finish, scores and a plan
      appear, and the recorded cost on the assessment document is plausible
      (~$0.30–0.75). This is the first real test of the streaming client with
      structured outputs. Open the progress page in the browser. Confirm the
      live updates arrive through the Cloudflare proxy.
- [ ] 9.5 **Checkout in sandbox.** Put Freemius in sandbox mode. Buy Pro from the
      pricing page. Confirm: the overlay opens with your email pre-filled, the
      webhook upgrades the account to Pro, and the account page shows the Pro
      limits and the "Manage subscription" link.
- [ ] 9.6 **Downgrade path.** Cancel or refund the sandbox purchase. Confirm the
      account returns to Free and extra sites become read-only.
- [ ] 9.7 **Session across subdomains.** Log in on `app.<your-domain>`. Confirm the
      API calls to `api.<your-domain>` carry the session (no 401s).

## 10. Prompt quality check (from the spec, manual)

- [ ] 10.1 Assemble an evaluation set of about 10 real sites. Vary the platform
      (WordPress, Wix, Shopify, custom) and the quality.
- [ ] 10.2 Run an assessment for each site. Review each report and plan.
- [ ] 10.3 Check: the scores are sane, the findings match the site, and a beginner
      can follow every task step. Repeat this check before any future prompt change.

## 11. Outstanding engineering work (needs your input, then code)

These are not dashboard actions. They are small code tasks that wait on real
account data or a decision. Ask for them when you are ready.

- [ ] 11.1 **Real `FreemiusClient`.** The daily license revalidator currently uses a
      canned client. It downgrades only on stored expiry dates. A real client needs
      the Freemius API credentials from step 1.5 and one endpoint call
      (license validation). Small task; do it before you rely on revalidation.
- [ ] 11.2 **Deferred code minors.** A hygiene pass is ledgered in
      `.superpowers/sdd/2026-08-06-angular-frontend/progress.md` and
      `.superpowers/sdd/2026-08-06-billing-hardening/progress.md`
      (keyboard access for task expand, shared error helper, global 401 redirect,
      severity-badge styling, site ordering, and similar). None block launch.

---

**Order summary:** accounts (1) → Atlas (2) → push & CI secrets (3) → backend deploy
(4) → DNS/WAF (5) → Google (6) → Freemius (7) → frontend deploy (8) → smoke tests (9)
→ prompt QA (10).
Steps 1–8 must finish before step 9. Step 11 can run in parallel after step 7.
