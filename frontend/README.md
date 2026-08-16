# GeoStrategy frontend

## What this is

This is the GeoStrategy web app. It is an Angular application that lets a user add a site,
run an assessment, and view the resulting plan and report.

## Run in development

1. Run `npm install`.
2. Start the backend first. See `../backend/README.md`.
3. Run `npm start`. This starts the dev server. The dev server proxies `/v1` and `/healthz`
   requests to `localhost:8080` (see `proxy.conf.json`).
4. Open `http://localhost:4200`.

## Test

- Run unit tests: `npm test -- --watch=false`.
- Note: Karma needs a Chrome browser. On a machine without Chrome, set `CHROME_BIN` to another
  Chromium-based browser (for example Edge) before you run the command.
- Run end-to-end tests: `npm run e2e`. This runs the Playwright suite.

## Build

Run `npx ng build`. The build output goes to `dist/frontend/browser`.

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

## Before production

Complete this checklist before you launch.

- Replace `REPLACE_ME_DOMAIN` in `src/environments/environment.production.ts` with the real
  domain.
- Replace `REPLACE_ME_FREEMIUS_PRODUCT_ID` and `REPLACE_ME_FREEMIUS_PUBLIC_KEY` in
  `src/environments/environment.production.ts` with the real Freemius values.
- Replace `REPLACE_ME_CONTACT_EMAIL` (in the legal pages) with the real contact email address.
- Set the Google OAuth redirect URI to the API callback URL. See the backend README for the
  exact path.
- Test checkout in Freemius sandbox mode before you accept real payments.
