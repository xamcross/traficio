#!/usr/bin/env node
// This script builds sitemap.xml after the Angular build.
// It reads the production origin from environment.production.ts, so the
// origin has one source of truth. It reads the list of pre-rendered routes
// from prerendered-routes.json, so a future public route appears in the
// sitemap without a change to this file. It then filters the list against
// a denylist of private path prefixes, as a defensive check.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const envFile = path.join(frontendRoot, 'src/environments/environment.production.ts');
const distDir = path.join(frontendRoot, 'dist/frontend');
const browserDir = path.join(distDir, 'browser');
const routesFile = path.join(distDir, 'prerendered-routes.json');
const outputFile = path.join(browserDir, 'sitemap.xml');

// A route under one of these prefixes is private or transactional.
// The sitemap must never list it, even if it appears in prerendered-routes.json.
const PRIVATE_PREFIXES = [
  '/login',
  '/signup',
  '/dashboard',
  '/account',
  '/assessments',
  '/sites',
  '/verify-email',
  '/reset-password',
  '/auth',
];

function fail(message) {
  console.error(`sitemap.mjs: ${message}`);
  process.exit(1);
}

function readSiteOrigin() {
  if (!existsSync(envFile)) {
    fail(
      `The file "${envFile}" does not exist. The script cannot read siteOrigin. ` +
        'Check that environment.production.ts is still at this path.',
    );
  }
  const contents = readFileSync(envFile, 'utf8');
  const match = contents.match(/siteOrigin\s*:\s*['"]([^'"]+)['"]/);
  if (!match) {
    fail(
      `The file "${envFile}" has no "siteOrigin" field with a quoted string value. ` +
        'The script cannot build absolute sitemap URLs without it. Add a line like ' +
        `siteOrigin: 'https://app.traficio.com' to environment.production.ts.`,
    );
  }
  const origin = match[1].replace(/\/+$/, '');
  if (!origin) {
    fail(`The "siteOrigin" value in "${envFile}" is empty.`);
  }
  return origin;
}

function readPublicRoutes() {
  if (!existsSync(routesFile)) {
    fail(
      `The file "${routesFile}" does not exist. Run the Angular build first, so it ` +
        'writes prerendered-routes.json, then run this script again.',
    );
  }
  let data;
  try {
    data = JSON.parse(readFileSync(routesFile, 'utf8'));
  } catch (error) {
    fail(`The file "${routesFile}" is not valid JSON. ${error.message}`);
  }
  const routes = Object.keys(data?.routes ?? {});
  if (routes.length === 0) {
    fail(`The file "${routesFile}" lists no routes. The sitemap would be empty.`);
  }

  const isPrivate = (route) =>
    PRIVATE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));

  const publicRoutes = routes.filter((route) => !isPrivate(route));
  const droppedRoutes = routes.filter((route) => isPrivate(route));
  if (droppedRoutes.length > 0) {
    console.warn(
      `sitemap.mjs: dropped private routes from prerendered-routes.json: ${droppedRoutes.join(', ')}`,
    );
  }
  if (publicRoutes.length === 0) {
    fail('No public routes remain after the private-route filter. The sitemap would be empty.');
  }
  return publicRoutes.sort();
}

function toLoc(origin, route) {
  return route === '/' ? `${origin}/` : `${origin}${route}`;
}

function buildSitemap(origin, routes, lastmod) {
  const urlEntries = routes
    .map((route) => `  <url>\n    <loc>${toLoc(origin, route)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`)
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urlEntries}\n` +
    '</urlset>\n'
  );
}

function main() {
  if (!existsSync(browserDir)) {
    fail(
      `The directory "${browserDir}" does not exist. Run the Angular build first, so ` +
        'it writes dist/frontend/browser, then run this script again.',
    );
  }
  const origin = readSiteOrigin();
  const routes = readPublicRoutes();
  const lastmod = new Date().toISOString().slice(0, 10);
  const xml = buildSitemap(origin, routes, lastmod);
  writeFileSync(outputFile, xml, 'utf8');

  console.log(`sitemap.mjs: wrote ${outputFile}`);
  for (const route of routes) {
    console.log(`sitemap.mjs:   ${toLoc(origin, route)}`);
  }
}

main();
