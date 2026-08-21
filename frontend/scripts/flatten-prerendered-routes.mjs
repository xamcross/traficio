#!/usr/bin/env node
// This script flattens each pre-rendered route to one HTML file.
// Angular writes "<route>/index.html" for a pre-rendered route. Cloudflare
// Pages treats that path as a directory index. It answers the clean URL
// with a 308 redirect to the trailing-slash form. A flat file
// "<route>.html" answers the clean URL with a 200 status instead.
// The script reads the route list from prerendered-routes.json, the same
// file that scripts/sitemap.mjs reads. The two scripts never disagree
// about which routes exist.
//
// The script also copies the client-render shell to a stable directory
// index at "app/index.html". Cloudflare Pages turns a destination like
// "/index.csr.html" into a clean-URL 308 to "/index.csr", because a name
// that contains "index" gets the same normalisation as a real directory
// index. "/app/" is already a directory index, so Pages leaves it alone.
// public/_redirects points every client route at "/app/" for this reason.

import {
  readFileSync,
  existsSync,
  renameSync,
  rmdirSync,
  copyFileSync,
  mkdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const distDir = path.join(frontendRoot, 'dist/frontend');
const browserDir = path.join(distDir, 'browser');
const routesFile = path.join(distDir, 'prerendered-routes.json');
const csrShellFile = path.join(browserDir, 'index.csr.html');
const csrShellCopyDir = path.join(browserDir, 'app');
const csrShellCopyFile = path.join(csrShellCopyDir, 'index.html');

function fail(message) {
  console.error(`flatten-prerendered-routes.mjs: ${message}`);
  process.exit(1);
}

function readRoutes() {
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
    fail(`The file "${routesFile}" lists no routes. There is nothing to flatten.`);
  }
  return routes;
}

function routeDirFor(route) {
  const segments = route.split('/').filter(Boolean);
  return path.join(browserDir, ...segments);
}

function flattenRoute(route) {
  const routeDir = routeDirFor(route);
  const sourceFile = path.join(routeDir, 'index.html');
  const targetFile = `${routeDir}.html`;

  if (!existsSync(sourceFile)) {
    fail(
      `The file "${sourceFile}" does not exist for route "${route}". ` +
        'The Angular build did not pre-render this route as expected.',
    );
  }

  renameSync(sourceFile, targetFile);
  rmdirSync(routeDir);
  console.log(`flatten-prerendered-routes.mjs: ${sourceFile} -> ${targetFile}`);
}

function copyClientRenderShell() {
  if (!existsSync(csrShellFile)) {
    fail(
      `The file "${csrShellFile}" does not exist. Angular did not emit the client-render ` +
        'shell. Check the "outputMode" build option in angular.json.',
    );
  }
  mkdirSync(csrShellCopyDir, { recursive: true });
  copyFileSync(csrShellFile, csrShellCopyFile);
  console.log(`flatten-prerendered-routes.mjs: ${csrShellFile} -> ${csrShellCopyFile}`);
}

function main() {
  if (!existsSync(browserDir)) {
    fail(
      `The directory "${browserDir}" does not exist. Run the Angular build first, so ` +
        'it writes dist/frontend/browser, then run this script again.',
    );
  }

  const routes = readRoutes().filter((route) => route !== '/');
  for (const route of routes) {
    flattenRoute(route);
  }
  copyClientRenderShell();
}

main();
