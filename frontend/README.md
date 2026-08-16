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
