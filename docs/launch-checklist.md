# GeoStrategy — Manual Launch Checklist

All code for v1 and the "One Thing" redesign is merged to `master`. This document
lists the manual actions that remain before launch, and the current status of each.
Do the open steps in order. Each step tells you where the action happens. Sentences
follow ASD-STE100.

Facts (2026-08-18):

- The domain is `traficio.com`. It is registered and proxied on Cloudflare
  (zone `traficio.com`, account `Xamcross@gmail.com's Account`).
- The SPA runs at `https://app.traficio.com` (Cloudflare Pages project `geostrategy`).
  The API runs at `https://api.traficio.com` (Fly app `geostrategy-api`, region `fra`).
- Both hosts share one registrable domain. The session cookie is same-site, so
  `SameSite=Lax` works. Keep this layout.
- The GitHub repository is `xamcross/traficio`. It is public. The default branch is `master`.
- Legend: `[x]` done, `[ ]` open, `[~]` partly done (the item text says what is left).

---

## 1. Create the external accounts

- [~] 1.1 **MongoDB Atlas.** The account exists (`xamcross@gmail.com`, org
      `6a1d5f0463c3fcd7d61bf4cc`). The M0 cluster does not exist yet. See section 2.
- [ ] 1.2 Create an **Anthropic** API key at console.anthropic.com.
- [ ] 1.3 Create a **Resend** account. Verify the sending domain `traficio.com`
      (Resend gives you DNS records; add them in the Cloudflare zone). Create an API key.
- [ ] 1.4 Create a **Google Cloud** OAuth client (type: Web application). Note the
      client id and the client secret.
- [ ] 1.5 Create a **Freemius** account. Create the product and the Pro plan. Set the
      price in the Freemius dashboard. Note: the product id, the public key, the
      secret key, and the Pro plan id.
- [x] 1.6 **Cloudflare.** The account exists. The zone `traficio.com` is active.
- [x] 1.7 **Fly.io.** The account exists. `flyctl` 0.4.79 is installed and logged in.

## 2. Configure MongoDB Atlas

The Atlas CLI session on this machine is expired. The CLI login needs an interactive
terminal, so an agent cannot do it. Do 2.1 yourself; an agent can then do 2.2–2.4
with the CLI.

- [ ] 2.1 Log in: `atlas auth login` (choose "UserAccount", finish the browser step).
- [ ] 2.2 Create the M0 cluster in the existing project (or a new project
      `geostrategy`): `atlas clusters create geostrategy --tier M0 --provider AWS
      --region EU_CENTRAL_1 --projectId <id>`. Frankfurt is the closest region to
      the Fly region `fra`.
- [ ] 2.3 Create the database user: `atlas dbusers create --username geostrategy
      --role readWrite@geostrategy --password <strong>`. Allow network access
      `0.0.0.0/0` (`atlas accessLists create 0.0.0.0/0 --type cidrBlock`). The
      credential is the gate.
- [ ] 2.4 Read the connection string: `atlas clusters connectionStrings describe
      geostrategy`. Append `/?maxPoolSize=50&minPoolSize=5`. You need it in step 4.2.

## 3. Push the repository and set the CI secrets

- [x] 3.1 `master` is pushed. The default branch is `master`. The secret scan
      (`git grep -n -i -E 'sk-ant-|re_[A-Za-z0-9]{20,}|mongodb\+srv://|GOCSPX-'`)
      is empty.
- [~] 3.2 GitHub → Settings → Secrets and variables → Actions:
      - [x] `FLY_API_TOKEN` (an app-scoped deploy token, valid one year, created 2026-08-17).
      - [x] `CLOUDFLARE_ACCOUNT_ID`.
      - [ ] `CLOUDFLARE_API_TOKEN`. Create it yourself, so the value never passes
        through an agent transcript: Cloudflare dashboard → My Profile → API Tokens →
        Create Token → Create Custom Token. Name `traficio-ci-pages-deploy`.
        Permission: Account → Cloudflare Pages → Edit. Account Resources: your
        account. Create it, copy it once, then run
        `gh secret set CLOUDFLARE_API_TOKEN -R xamcross/traficio` and paste it.
- [x] 3.3 The workflow `.github/workflows/ci.yml` runs on each push to `master`. The
      first run (2026-08-17) passed the tests. Its two deploy jobs failed as expected
      (no Cloudflare token yet; no `MONGODB_URI` yet). After 3.2 and 4.2 are done,
      start the workflow once by hand (Actions → CI → Run workflow) or push a commit.

## 4. Deploy the backend to Fly.io

Work from the `backend/` directory.

- [x] 4.1 The Fly app `geostrategy-api` exists (org `personal`, region `fra`,
      `fly.toml` accepted). The first CI deploy built the image on Fly and started a
      machine. The machine stopped because no `MONGODB_URI` exists yet.
- [ ] 4.2 Set the secrets. Use one `fly secrets set` command with these values:

      MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?maxPoolSize=50&minPoolSize=5"
      MONGODB_DB="geostrategy"
      BASE_URL="https://api.traficio.com"
      APP_URL="https://app.traficio.com"
      RESEND_API_KEY="re_..."
      EMAIL_FROM="GeoStrategy <noreply@traficio.com>"
      GOOGLE_CLIENT_ID="..."
      GOOGLE_CLIENT_SECRET="..."
      ANTHROPIC_API_KEY="sk-ant-..."
      FREEMIUS_SECRET_KEY="..."
      FREEMIUS_PRO_PLAN_ID="..."

      Optional values with safe defaults: `CLAUDE_MODEL` (default `claude-opus-5`),
      `SSE_MAX_MILLIS` (default 900000), `FREEMIUS_SIGNATURE_HEADER` (default
      `X-Signature`), tier limits (`FREE_MAX_SITES=1`, `FREE_ASSESSMENTS_PER_MONTH=1`,
      `PRO_MAX_SITES=5`, `PRO_ASSESSMENTS_PER_MONTH=10`).

      Do not set `COOKIE_DOMAIN`. The cookie is host-only on `api.traficio.com`, and
      that is enough. If you set it, use `traficio.com` with no leading dot.
      The machine is always on (`min_machines_running = 1` in `fly.toml`) because the
      job worker runs in-process. Expect a few US dollars per month. Check the
      current Fly.io price list.
      You can set the secrets in two rounds. `MONGODB_URI`, `BASE_URL`, and `APP_URL`
      are enough for the API to boot. The other keys enable email, Google login,
      assessments, and billing when you add them. Each `fly secrets set` restarts
      the machine.
- [ ] 4.3 Run `fly deploy` (or let CI deploy on the next push to `master`).
- [x] 4.4 The certificate for `api.traficio.com` is issued (Let's Encrypt, verified
      2026-08-18). The `_acme-challenge.api` CNAME and the `_fly-ownership.api` TXT
      records exist in the zone.
- [ ] 4.5 Check `https://api.traficio.com/healthz`. It must return `ok`. The first
      boot can take more than a minute. A failed health check does not stop the
      machine. It only delays the healthy state.

## 5. Configure Cloudflare DNS and protection

- [x] 5.1 SSL/TLS encryption mode is **Full (strict)**. "Always Use HTTPS" is on.
- [x] 5.2 DNS records in the zone `traficio.com` (all created 2026-08-18):
      - `app` CNAME → `geostrategy.pages.dev` (proxied). Pages custom domain
        `app.traficio.com` is active.
      - `api` CNAME → `nw2e8o1.geostrategy-api.fly.dev` (proxied).
      - `_acme-challenge.api` CNAME → `api.traficio.com.nw2e8o1.flydns.net` (DNS only).
      - `_fly-ownership.api` TXT → `app-nw2e8o1`.
      - `@` and `www` A → `192.0.2.1` (proxied placeholders; a redirect rule below
        sends visitors to the app).
      - A Single Redirect rule: `traficio.com/*` and `www.traficio.com/*` →
        `https://app.traficio.com/<path>` (301, query string kept). Verified.
- [ ] 5.3 Check `https://api.traficio.com/healthz` after 4.2. It must return `ok`.
- [ ] 5.4 Add a WAF rate-limiting rule for `api.traficio.com` (Security → WAF →
      Rate limiting rules; the Free plan allows one rule). Cover at minimum:
      `POST /v1/auth/*` and `POST /v1/sites/*/assessments`. These endpoints are
      the abuse targets. An agent cannot do this: the setup token has no WAF scope.
- [ ] 5.5 Enable **Email Routing** for the zone (Email → Email Routing). Add the
      address `support@traficio.com` → your personal inbox. Verify the destination
      address from the email Cloudflare sends. The legal pages already show
      `support@traficio.com`. Receive-only is enough.
- [ ] 5.6 Delete the temporary API token `traficio-setup` (My Profile → API Tokens).
      An agent used it on 2026-08-18 to configure the zone. It has DNS, Zone
      Settings, Single Redirect, and Pages edit rights on this zone. It is not
      needed after this checklist is done.

## 6. Configure Google OAuth

- [ ] 6.1 In the Google Cloud Console, open your OAuth client.
- [ ] 6.2 Add this authorized redirect URI:
      `https://api.traficio.com/v1/auth/google/callback`.
      Authorized JavaScript origin: `https://api.traficio.com`.

## 7. Configure Freemius

- [ ] 7.1 In the Freemius dashboard, set the webhook URL to:
      `https://api.traficio.com/v1/billing/freemius/webhook`.
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

- [~] 8.1 `frontend/src/environments/environment.production.ts`:
      - [x] `apiBaseUrl` is `https://api.traficio.com`.
      - [ ] Replace `REPLACE_ME_FREEMIUS_PRODUCT_ID` with the Freemius product id.
      - [ ] Replace `REPLACE_ME_FREEMIUS_PUBLIC_KEY` with the Freemius public key.
      Until then the checkout button shows "not connected"; nothing else breaks.
- [ ] 8.1a In the Freemius dashboard, set the Pro price equal to `PRO_PRICE_LABEL` in
      `frontend/src/app/core/config.ts` (default `$9` a month). Keep `FREE_TIER_COPY` and
      `PRO_TIER_COPY` in the same file equal to the tier env values of step 4.2.
- [x] 8.2 The legal pages show the contact address `support@traficio.com`
      (see 5.5 for the mailbox).
- [ ] 8.3 Review the legal pages. The current texts are short v1 stubs. Confirm they
      are acceptable for your jurisdiction, or replace them.
- [ ] 8.4 Commit the edits from 8.1 when the Freemius values exist. Push `master`.
- [x] 8.5 The Pages project `geostrategy` exists (direct upload, production branch
      `master`). The first production deploy was made by hand on 2026-08-18. After
      3.2 is done, CI deploys on each push to `master`.
- [x] 8.6 The custom domain `app.traficio.com` is attached and active. The apex and
      `www` redirect to it (see 5.2).
- [x] 8.7 A preview deployment (`--branch=preview`) was tested in a real browser on
      2026-08-17: all `_redirects` rows serve the SPA with 200; a bad path answers 404.
- [x] 8.8 `https://app.traficio.com` verified 2026-08-18: `/`, `/login`, `/dashboard/`,
      `/assessments/x/report` answer 200 with the SPA; `/no-such-page` answers 404;
      the security headers are present.
- [ ] 8.9 **Plan gate.** As a Free user with a ready check, open `/assessments/<id>/plan`.
      Confirm the redirect to `/pricing?site=<id>` and that the locked list shows task
      titles without steps. (Needs the API, section 4.)

## 9. Smoke tests with real services

Run these once after the API is up (steps 4.2–4.5). They cover the paths that tests
could not cover with mocks and canned clients.

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
- [ ] 9.7 **Session across subdomains.** Log in on `app.traficio.com`. Confirm the
      API calls to `api.traficio.com` carry the session (no 401s).

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

**Order summary:** accounts (1) → Atlas (2) → CI secrets (3) → backend secrets and
deploy (4) → DNS/WAF/email (5) → Google (6) → Freemius (7) → frontend values (8) →
smoke tests (9) → prompt QA (10).
Steps 1–8 must finish before step 9. Step 11 can run in parallel after step 7.

**Shortest path to a working app:** 2.1–2.4 (Atlas) → 4.2 with `MONGODB_URI`,
`BASE_URL`, `APP_URL` → 4.5 (`/healthz` is `ok`) → 3.2 (`CLOUDFLARE_API_TOKEN`) →
register with email and password on `https://app.traficio.com` (the verification
email prints in `fly logs` until Resend is set) → run a check (canned Claude client
until `ANTHROPIC_API_KEY` is set).
