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

1. Set the build command to `npx ng build`.
2. Set the output directory to `dist/frontend/browser`.
3. Set the root directory to `frontend`.
4. The build copies `public/_redirects` into the output. This file sends all routes to
   `index.html`, so client-side routing works on refresh and on direct links.

## Connect to the API in production

Choose one of two options.

**Option A: same origin.** Add a Cloudflare Origin Rule or Worker that routes
`app.<domain>/v1/*` to the API. Keep `API_BASE = ''` in `src/app/core/config.ts`. The app then
calls the API on its own origin, the same way the dev proxy does.

**Option B: separate API subdomain.** Set `API_BASE` in `src/app/core/config.ts` to
`https://api.<domain>`. On the backend, set `APP_URL` to the app origin. Set `COOKIE_DOMAIN` to
`.<domain>` so the session cookie works across both subdomains.

## Before production

Complete this checklist before you launch.

- Replace `REPLACE_ME_FREEMIUS_PRODUCT_ID` in `src/app/core/config.ts` with the real Freemius
  product id.
- Replace `REPLACE_ME_FREEMIUS_PUBLIC_KEY` in `src/app/core/config.ts` with the real Freemius
  public key.
- Replace `REPLACE_ME_CONTACT_EMAIL` (in the legal pages) with the real contact email address.
- Set the Google OAuth redirect URI to the API callback URL. See the backend README for the
  exact path.
- Test checkout in Freemius sandbox mode before you accept real payments.
