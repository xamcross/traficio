# The steps only you can do

Date: 2026-08-22. This list holds the work an agent cannot finish, because each item needs
your identity, your money, your judgement, or a click in your own inbox. Everything an
agent could do is done. Sentences follow ASD-STE100.

**Where the product stands.** `https://app.traficio.com` serves the app and 10 crawlable
pages. `https://api.traficio.com` serves the API from Fly.io, on a MongoDB Atlas M0. CI
tests and deploys both halves on every push to `master`. A visitor can run a free preview
with no account. A signed-in user can run a full check and publish the result.

**What is not connected yet.** Email, Google sign-in and payment. The app runs without all
three. The gaps are listed below.

Legend: **[D]** a decision only you can make · **[A]** an account only you can open ·
**[£]** costs money · **[C]** a click in your own inbox or console.

---

## Start here: three steps, about 15 minutes

These cost the least and close the most risk.

### 1. Rotate the Anthropic key · [C] · 5 minutes

The key you pasted into the chat on 2026-08-18 sits in a transcript. Treat it as public.

1. Open https://console.anthropic.com → **API Keys**.
2. Create a key named `geostrategy-prod-2`. Copy it.
3. From `backend/`:
   ```
   fly secrets set --app geostrategy-api ANTHROPIC_API_KEY="sk-ant-..."
   ```
4. Back in the console, **revoke the old key**.
5. Check: `https://api.traficio.com/healthz` returns `ok` after the machine restarts.

### 2. Delete the temporary Cloudflare token · [C] · 2 minutes

An agent created the token `traficio-setup` on 2026-08-18 to set up DNS, TLS and the
redirect rule. Its value appeared in a screenshot, so treat it as public. Nothing needs it
now.

1. Open https://dash.cloudflare.com/profile/api-tokens.
2. Find `traficio-setup` → the `⋯` menu → **Delete**.
3. Keep `CLOUDFLARE_API_TOKEN`, the CI token with `Pages:Edit` only. CI needs it.

### 3. Decide the AI training-crawler policy · [D] · 5 minutes · **deadline 15 September 2026**

Cloudflare replaces its AI-blocking control with a three-tier search / agent / training
system on 15 September 2026. If you state nothing, a default may be applied for you.

`frontend/public/robots.txt` already welcomes the **search** crawlers by name:
`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Google-Extended`. Those are what put
you into AI answers, and being found there is the product. That part is settled.

The open question is the **training** crawlers, `GPTBot` and `ClaudeBot`:

| Choice | You get | You give up |
|---|---|---|
| **Allow** (today) | Your guides may inform future models. Nothing to do. | Your writing trains models with no direct return. |
| **Block** | Your content is not used for training. | Nothing in search visibility. |

Blocking the training crawlers does **not** remove you from ChatGPT or Claude answers.
Those use the search bots above, which stay allowed either way. A commented-out block in
`robots.txt` shows exactly how to disallow them: uncomment it, commit, push, and CI deploys.

---

## Connect the missing services

Independent of each other. Any order.

### 4. Google sign-in · [A] · 20 minutes

The login and signup pages show a "Continue with Google" button. It fails until this exists.

1. https://console.cloud.google.com → create a project `GeoStrategy`.
2. **APIs & Services → OAuth consent screen**:
   - User type **External**. App name `GeoStrategy`. Support email: yours.
   - Homepage `https://app.traficio.com`, privacy `https://app.traficio.com/privacy`,
     terms `https://app.traficio.com/terms`.
   - Authorized domain `traficio.com`. Developer contact: yours.
   - No extra scopes. The app reads the basic profile and the email only.
   - **Publish** the app. These scopes need no Google review.
3. **Credentials → Create Credentials → OAuth client ID**, type **Web application**:
   - Authorized JavaScript origin: `https://api.traficio.com`
   - Authorized redirect URI: `https://api.traficio.com/v1/auth/google/callback`
   - Copy the client id and the client secret.
4. From `backend/`:
   ```
   fly secrets set --app geostrategy-api \
     GOOGLE_CLIENT_ID="....apps.googleusercontent.com" \
     GOOGLE_CLIENT_SECRET="GOCSPX-..."
   ```
5. Check: open `https://app.traficio.com/login` in a private window → **Continue with
   Google** → you land on the dashboard. A `redirect_uri_mismatch` means the URI in step 3
   differs from the one above. Compare it character by character.

### 5. Email sending · [A] · 30 minutes · deferred by your decision on 2026-08-18

The API sends no email today. Each verification and reset link goes to `fly logs` instead,
on a line starting `EMAIL (not sent, no RESEND_API_KEY)`. That is workable for your own
testing. It is not workable for real users: they cannot verify an address, and **an
unverified account cannot run a full check**.

Do this before you accept real users. The code supports Resend. Another provider needs one
small `EmailSender` class in the backend.

1. Create an account at https://resend.com. The free tier covers 3,000 emails a month.
2. **Domains → Add Domain** → `traficio.com`, region **Europe (Ireland)**.
3. Resend shows three DNS records: one `MX` and two `TXT` (SPF and DKIM). In Cloudflare →
   `traficio.com` → **DNS → Records → Add record**, copy each exactly. Set each to **DNS
   only** (grey cloud), not proxied.
4. Back in Resend, click **Verify DNS Records**. Wait until every row reads "Verified".
5. **API Keys → Create API Key**: name `geostrategy-prod`, permission **Sending access**,
   domain `traficio.com`. Copy it once.
6. From `backend/`:
   ```
   fly secrets set --app geostrategy-api \
     RESEND_API_KEY="re_..." \
     EMAIL_FROM="GeoStrategy <noreply@traficio.com>"
   ```
   No mailbox is needed. Resend sends from any address on a verified domain.
7. Check: register at `https://app.traficio.com/signup` with a real address. The email must
   arrive within a minute. Click the link. Then test **Forgot your password?**.

Optional: add a DMARC record so mailbox providers trust the domain. Cloudflare DNS →
`TXT`, name `_dmarc`, value `v=DMARC1; p=none; rua=mailto:support@traficio.com`.

### 6. A support mailbox · [C] · 10 minutes

Your legal pages show `support@traficio.com`. Nothing receives it today.

1. Cloudflare → `traficio.com` → **Email → Email Routing → Get started**. Accept the DNS
   records it offers to add.
2. Destination address: your personal inbox. **Click the verification link Cloudflare
   emails you.**
3. Custom address: `support@traficio.com` → that destination.
4. Check: send a mail to `support@traficio.com` and confirm it arrives.

If you also do step 5, keep both. Resend uses a `send.` subdomain, so they do not clash.

### 7. Payment · [A] · about an hour, plus their review

Until this is done the pricing page shows the checkout as unavailable. Everything else works.

1. Create an account at https://dashboard.freemius.com. Freemius is the merchant of record:
   they are the seller, they handle VAT, and they pay out. They ask for seller identity and
   a payout method, and **live sales stay blocked until their review clears**. Sandbox
   works immediately.
2. **Add product**: type **SaaS**, name `GeoStrategy`, URL `https://app.traficio.com`.
3. **Plans**: one plan named `Pro`, price **$9 a month**, to match `PRO_PRICE_LABEL` in
   `frontend/src/app/core/config.ts`. Enable the checkout.
4. Copy four values:
   - **Settings → General**: the **Product ID** and the **Public key**. Both are public by
     design and belong in the frontend.
   - **Settings → Keys**: the **Secret key**. This signs webhooks and belongs on Fly.
   - **Plans**: the **Plan ID** of `Pro`.
5. **Settings → Webhooks** → add `https://api.traficio.com/v1/billing/freemius/webhook`.
   Select the license and subscription events: created, cancelled, expired, updated.
6. From `backend/`:
   ```
   fly secrets set --app geostrategy-api \
     FREEMIUS_SECRET_KEY="..." FREEMIUS_PRO_PLAN_ID="..."
   ```
7. Put the two public values into
   `frontend/src/environments/environment.production.ts`, over
   `REPLACE_ME_FREEMIUS_PRODUCT_ID` and `REPLACE_ME_FREEMIUS_PUBLIC_KEY`. Commit and push.
   CI deploys.
8. **Verify the webhook contract before you sell anything.** Send a test event from the
   Freemius dashboard, then read `fly logs`:
   - **200 with a verified signature** → good.
   - **401** → the signature header uses another name. Set `FREEMIUS_SIGNATURE_HEADER` to
     the name Freemius sends.
   - **400, or a parse error in the log** → the payload shape differs from the test
     fixtures. Stop and report it. The parser needs a code change; do not guess at it.
   Two accepted limits are written down in `backend/README.md`: the webhook has no replay
   protection, and it verifies the decoded text rather than the raw bytes. Review both
   before you take real money.
9. Sandbox run: put the product in **Sandbox** mode, buy Pro from the pricing page, and
   confirm the account turns Pro within seconds. Then cancel or refund it, and confirm the
   account returns to Free and the extra sites become read-only. Turn sandbox off before
   launch.

---

## Decisions waiting on you

### 8. Move the marketing pages to the apex? · [D]

Today `traficio.com` redirects to `app.traficio.com`. Every link you earn therefore builds
authority on the subdomain, while the shorter and stronger address holds nothing.

**Recommendation: yes, and soon.** A subdomain does not inherit apex authority
automatically. You have only just submitted the sitemap, so almost nothing is indexed yet.
This is the cheapest it will ever be. Later it means redirecting authority you already paid
for.

**Why an agent did not simply do it.** It changes the public address of your product, which
is a branding call as much as a technical one, and the size of the SEO gain is real but
contested. It also touches DNS, the Pages custom domain, the redirect rule, the `APP_URL`
secret that drives CORS and the OAuth return, and every canonical link. Each part is small.
Together they can take the site down if one is wrong.

Say the word and an agent can do all of it: attach the apex to the Pages project, reverse
the redirect so `www` and `app` point at the apex, change one constant (`siteOrigin`),
update `APP_URL` on Fly, and check every URL before and after.

### 9. Review the legal pages · [D]

`frontend/src/app/features/legal/terms.ts` and `privacy.ts` are short v1 stubs. They carry
the right contact address and describe what the product does. Nobody has checked them
against your jurisdiction. Confirm they are acceptable, or replace the text.

---

## Tests that need a real service or real money

### 10. The live-key assessment · [£] about $0.50 · 15 minutes

This is the one path never exercised with a real key, and it has been a known
pre-production risk since the assessment engine was built: the streaming client, the
structured outputs and the 900-second job lease have only ever run against a canned client.

1. Register at `https://app.traficio.com/signup` with an address you control.
2. Until step 5 is done, take the verification link from `fly logs`. Find the line
   `EMAIL (not sent, no RESEND_API_KEY)` and copy the `token=` URL out of it. Open it.
3. Add a real site. Run a check.
4. Watch `fly logs`. Confirm the crawl finishes, both Claude calls stream and complete,
   scores and a plan appear, and the recorded cost is about $0.30 to $0.75.
5. Keep the progress page open in a browser while it runs. Confirm the live updates arrive
   through the Cloudflare proxy. That exercises the SSE path end to end.
6. On the finished result, turn on **Share this result**, then open the `/r/<slug>` URL in a
   private window. Confirm the page shows the score and the findings as real text. **This is
   the last unverified piece of the public-results feature.**

### 11. The remaining smoke tests · [C]

Once the matching service is connected:

- **Email and password reset** (needs step 5): register, verify, reset, log in again.
- **Google sign-in** (needs step 4): sign in with Google and land on the dashboard.
- **Checkout and downgrade** (needs step 7): a sandbox purchase turns the account Pro, and
  a cancellation returns it to Free with the extra sites read-only.

### 12. Prompt quality · [D] · a few hours

Assemble about 10 real sites across platforms (WordPress, Wix, Shopify, custom) and quality
levels. Run a check on each. Read every report and plan. Check that the scores are sane,
that the findings match the site, and that a beginner could follow every step. Repeat this
before any future prompt change. No automated test replaces this judgement.

---

## Housekeeping

### 13. Delete the test data · [C] · 5 minutes

An agent created a probe account while it verified the deploy. It is real data in your
production database, so you remove it rather than an agent.

1. Atlas → the `GeoStrategy` project → **Browse Collections** → database `geostrategy`.
2. In `users`, find `probe+launch@traficio.com`. Delete that document.
3. In `sites`, delete the `example.com` document that carries the same user id.
4. Or keep it as your own test account and change its password.

### 14. Watch the first crawl · [C] · 10 minutes, in about a week

You have submitted the sitemap. In a few days open Google Search Console → **Pages** and
confirm the 10 URLs move from "Discovered" to "Indexed". A page that stays out carries a
reason in that report. A `site:traficio.com` search should also start to return pages.

---

## For reference: what is already done

Listed so you can see the boundary. None of it needs your attention.

- The domain, DNS, TLS at Full (strict), the `www` and apex redirect, and the Pages project.
- The Fly app, the Atlas database, and the secrets that make the API run.
- CI: it tests and deploys both halves on every push to `master`.
- Pre-rendered HTML on all 10 public pages, with per-page titles, descriptions, canonical
  links and Open Graph tags, plus a generated `sitemap.xml`.
- The guides section, the landing FAQ, and the depth on the landing and pricing pages.
- The ungated preview, its limit of 3 per hour, its SSRF guard and its concurrency cap.
- Public shareable results, and the Pages Function that renders them as crawlable HTML.
- The WAF rate-limit rule `api-abuse-endpoints`.
- The rule that stops `/v1/preview` answering on the bare Fly hostname.
- `robots.txt` naming the AI search crawlers, and structured data on the landing page.
