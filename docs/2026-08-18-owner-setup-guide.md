# Owner setup guide — the accounts that only you can create

Date: 2026-08-18. Status of the platform: the app is live at `https://app.traficio.com`,
the API at `https://api.traficio.com`, CI deploys both on each push to `master`.
This guide covers the six steps that need your personal accounts. Do them in this
order. Each step ends with a check. Sentences follow ASD-STE100.

Conventions:

- Run every `fly` command from `backend/`, or add `--app geostrategy-api`.
- Each `fly secrets set` restarts the API machine (about one minute).
- Never paste a secret into a chat, a ticket, or a commit. Set it with the command
  shown, straight from the source page.

---

## Step 1 — Anthropic API key (real assessments)

Why: without `ANTHROPIC_API_KEY` the API uses a canned Claude client. Scores and plans
are deterministic sample data.

1. Open https://console.anthropic.com → **API Keys** → **Create Key**. Name it
   `geostrategy-prod`. Copy it once.
2. Set it:
   ```
   fly secrets set ANTHROPIC_API_KEY="sk-ant-..."
   ```
   Optional: `CLAUDE_MODEL` (default `claude-opus-5`).
3. Check: log in on `https://app.traficio.com`, add a small real site, run a check.
   Then run `fly logs` and look for the two Claude calls. The check should finish in
   one to three minutes. Console → **Usage** shows the spend (about USD 0.30–0.75
   per check).

Note: the key you pasted into the chat on 2026-08-18 is exposed. Set it now if you
want, then revoke it in the console and create a fresh one. Set the fresh one with
the same command.

## Step 2 — Resend (transactional email)

Why: without `RESEND_API_KEY` the API writes each email to `fly logs` instead of
sending it. Users cannot verify an address or reset a password.

1. Create an account at https://resend.com (free tier: 3,000 emails a month).
2. **Domains** → **Add Domain** → `traficio.com`. Region: EU (Ireland). Resend shows
   three DNS records: two `TXT` (SPF, DKIM) and one `MX` for the `send` subdomain
   (or similar names — copy exactly what Resend shows).
3. Add them in Cloudflare: dashboard → `traficio.com` → **DNS** → **Records** →
   **Add record**. Copy the name, type, and value one by one. Set each record to
   **DNS only** (grey cloud), not proxied.
4. Back in Resend click **Verify**. Wait until every record shows "Verified"
   (usually under five minutes).
5. **API Keys** → **Create API Key**. Name `geostrategy-prod`, permission
   "Sending access", domain `traficio.com`. Copy it once.
6. Set both values:
   ```
   fly secrets set RESEND_API_KEY="re_..." EMAIL_FROM="GeoStrategy <noreply@traficio.com>"
   ```
7. Check: on `https://app.traficio.com/signup` register with a real address of yours.
   The verification email must arrive within a minute. Click the link. The account
   shows as verified. Then test "Forgot your password?".

Optional but useful: add a DMARC record so mailbox providers trust the domain.
Cloudflare DNS → `TXT` name `_dmarc`, value `v=DMARC1; p=none; rua=mailto:support@traficio.com`.

## Step 3 — Google OAuth (Continue with Google)

Why: the login and signup pages have a "Continue with Google" button. It fails until
the client exists.

1. Open https://console.cloud.google.com. Create a project `GeoStrategy` (or reuse
   one you own).
2. **APIs & Services** → **OAuth consent screen**:
   - User type **External**. App name `GeoStrategy`. User support email: your address.
   - App domain: homepage `https://app.traficio.com`, privacy policy
     `https://app.traficio.com/privacy`, terms `https://app.traficio.com/terms`.
   - Authorized domain: `traficio.com`. Developer contact: your address.
   - Scopes: none extra (the app only reads the basic profile and the email).
   - **Publish** the app (status "In production"). No verification is needed for
     these scopes.
3. **Credentials** → **Create Credentials** → **OAuth client ID**:
   - Type **Web application**. Name `geostrategy-web`.
   - Authorized JavaScript origins: `https://api.traficio.com`.
   - Authorized redirect URIs: `https://api.traficio.com/v1/auth/google/callback`.
   - Create. Copy the client id and the client secret.
4. Set them:
   ```
   fly secrets set GOOGLE_CLIENT_ID="....apps.googleusercontent.com" GOOGLE_CLIENT_SECRET="GOCSPX-..."
   ```
5. Check: open `https://app.traficio.com/login` in a private window → **Continue
   with Google** → pick your account → you land on the dashboard. If Google shows
   `redirect_uri_mismatch`, the URI in step 3 differs from the one above (compare
   character by character, including `https` and no trailing slash).

## Step 4 — Freemius (billing)

Why: the Pro plan checkout, the webhook that upgrades an account, and the price
label. Until this is set the pricing page shows "not connected" for checkout.

1. Create an account at https://dashboard.freemius.com. Freemius asks for your
   seller details (identity, payout method). Live sales stay blocked until their
   review is done; sandbox works at once.
2. **Add product**: type **SaaS**, name `GeoStrategy`, URL `https://app.traficio.com`.
3. **Plans**: create one plan named `Pro`. Price: match `PRO_PRICE_LABEL` in
   `frontend/src/app/core/config.ts` (default `$9` a month). Billing cycle
   monthly. Enable the checkout.
4. Copy four values from the product:
   - **Settings** → **General**: the **Product ID** and the **Public key**
     (both are public by design; they go into the frontend).
   - **Settings** → **Keys**: the **Secret key** (signs webhooks; goes to Fly).
   - **Plans**: the **Plan ID** of `Pro`.
5. **Settings** → **Webhooks** → add:
   `https://api.traficio.com/v1/billing/freemius/webhook`. Select at least the
   license and subscription events (created, cancelled, expired, updated).
6. Set the backend secrets:
   ```
   fly secrets set FREEMIUS_SECRET_KEY="..." FREEMIUS_PRO_PLAN_ID="..."
   ```
7. Put the two public values into the frontend, commit, push (CI deploys):
   `frontend/src/environments/environment.production.ts` →
   `freemiusProductId: '<Product ID>'`, `freemiusPublicKey: '<Public key>'`.
   Optionally the same in `environment.ts` if you want local checkout tests.
8. Check the webhook contract before you sell anything (launch checklist 7.2–7.3):
   in the Freemius dashboard send a **test event**. Run `fly logs`. The API must
   answer 200 and log a verified signature. If it answers 401, the header name
   differs: set `FREEMIUS_SIGNATURE_HEADER` to the name Freemius uses. If it
   answers 400 or logs a parse error, the payload shape differs — stop and report
   it; that needs a code change.
9. Sandbox purchase: put the product in **Sandbox** mode, open
   `https://app.traficio.com/pricing`, buy Pro. Your email is pre-filled and locked.
   After payment the account flips to Pro within a few seconds (the webhook does
   it). Then cancel or refund in the dashboard and confirm the account returns to
   Free. Turn sandbox off before launch.

## Step 5 — Cloudflare finishing touches

All three are dashboard actions on `traficio.com`; the setup token had no rights for
them.

1. **WAF rate limit** (Security → WAF → Rate limiting rules → Create rule; the Free
   plan gives one rule):
   - Name `api-auth-and-checks`.
   - If incoming requests match: field **Hostname** equals `api.traficio.com` AND
     **URI Path** starts with `/v1/auth/` OR **URI Path** matches
     `^/v1/sites/[^/]+/assessments$` (use the "matches regex" operator if your
     plan shows it; otherwise use two rules over time or the broader
     `starts with /v1/`).
   - Rate: 20 requests per 1 minute per IP. Action **Block** for 1 minute.
   - Deploy. Check: `for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.traficio.com/v1/auth/login -H 'Content-Type: application/json' --data '{}'; done` — the last few must be `429`.
2. **Email Routing** (Email → Email Routing → Get started):
   - Enable routing (Cloudflare adds the MX and SPF records for you; accept).
   - Destination address: your personal inbox. Click the verification link in the
     email Cloudflare sends.
   - Custom address: `support@traficio.com` → that destination.
   - Check: send a mail to `support@traficio.com`; it arrives in your inbox.
   - Note: if Resend (step 2) also needs an MX record on the apex, keep both;
     Resend normally uses a subdomain (`send.traficio.com`), so they do not clash.
3. **Delete the temporary token** `traficio-setup` (My Profile → API Tokens →
   `⋯` → Delete). It was used on 2026-08-18 to configure the zone; nothing needs
   it any more.

## Step 6 — Smoke tests, then launch

Follow section 9 of `docs/launch-checklist.md`: real email flow, password reset,
Google sign-in, one live-key assessment with the progress page open, sandbox
checkout and downgrade. Then delete the probe account `probe+launch@traficio.com`
(Atlas → Browse Collections → `geostrategy.users`), or change its password and
keep it as your test user.

---

## The full secrets set, for reference

```
fly secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  RESEND_API_KEY="re_..." EMAIL_FROM="GeoStrategy <noreply@traficio.com>" \
  GOOGLE_CLIENT_ID="...apps.googleusercontent.com" GOOGLE_CLIENT_SECRET="GOCSPX-..." \
  FREEMIUS_SECRET_KEY="..." FREEMIUS_PRO_PLAN_ID="..."
```

Already set: `MONGODB_URI`, `MONGODB_DB`, `BASE_URL`, `APP_URL`. Do not set
`COOKIE_DOMAIN`. `fly secrets list` shows the names (never the values).
