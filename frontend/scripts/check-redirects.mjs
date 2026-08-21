#!/usr/bin/env node
// This script checks public/_redirects after the Angular build, before the
// other postbuild scripts run. It enforces two rules that keep a hard
// navigation working:
// - A pre-rendered route (from prerendered-routes.json) must have no row
//   in _redirects. A row would rewrite the route's real HTML file back to
//   the client-render shell and undo pre-rendering.
// - A client row's destination must never be "/" or "/index.html". Either
//   value serves the landing page's HTML on a route that is not the
//   landing page. Cloudflare Pages also turns "/index.html" into a
//   clean-URL 308, so that destination breaks in a second way too.
// The script fails loudly and exits non-zero when a rule breaks, in the
// same style as flatten-prerendered-routes.mjs and sitemap.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const distDir = path.join(frontendRoot, 'dist/frontend');
const routesFile = path.join(distDir, 'prerendered-routes.json');
const redirectsFile = path.join(frontendRoot, 'public/_redirects');

// Destinations that always serve the landing page's HTML. A client row
// must never point here.
const FORBIDDEN_DESTINATIONS = new Set(['/', '/index.html']);

function fail(message) {
  console.error(`check-redirects.mjs: ${message}`);
  process.exit(1);
}

function readPrerenderedRoutes() {
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
  return new Set(Object.keys(data?.routes ?? {}));
}

function readRedirectRows() {
  if (!existsSync(redirectsFile)) {
    fail(`The file "${redirectsFile}" does not exist. The build has no rewrite rules.`);
  }
  const lines = readFileSync(redirectsFile, 'utf8').split('\n');
  const rows = [];
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 2) {
      fail(
        `Line ${index + 1} of "${redirectsFile}" is not a valid rule: "${rawLine}". ` +
          'A rule needs a source and a destination, separated by whitespace.',
      );
    }
    rows.push({ lineNumber: index + 1, source: parts[0], destination: parts[1], raw: rawLine });
  });
  return rows;
}

function sourceToRoute(source) {
  // A wildcard row like "/assessments/*" rewrites many routes. Strip the
  // wildcard and the trailing slash so the row maps back to a route
  // prefix instead of one exact route.
  return source.replace(/\/\*$/, '').replace(/\/$/, '') || '/';
}

function checkNoRowForPrerenderedRoutes(rows, prerenderedRoutes) {
  const badRows = rows.filter((row) => {
    const route = sourceToRoute(row.source);
    return prerenderedRoutes.has(route);
  });
  if (badRows.length > 0) {
    const list = badRows
      .map((row) => `  line ${row.lineNumber}: "${row.raw.trim()}"`)
      .join('\n');
    fail(
      'The following rows in _redirects target a pre-rendered route. Delete each row, so ' +
        `the route serves its own HTML file instead of the client-render shell:\n${list}`,
    );
  }
}

function checkNoForbiddenDestination(rows) {
  const badRows = rows.filter((row) => FORBIDDEN_DESTINATIONS.has(row.destination));
  if (badRows.length > 0) {
    const list = badRows
      .map((row) => `  line ${row.lineNumber}: "${row.raw.trim()}"`)
      .join('\n');
    fail(
      'The following rows in _redirects rewrite a client route to the landing page. Point ' +
        `each row at the client-render shell instead (for example, /index.csr.html):\n${list}`,
    );
  }
}

function main() {
  const prerenderedRoutes = readPrerenderedRoutes();
  const rows = readRedirectRows();

  checkNoRowForPrerenderedRoutes(rows, prerenderedRoutes);
  checkNoForbiddenDestination(rows);

  console.log(
    `check-redirects.mjs: ${rows.length} row(s) checked against ${prerenderedRoutes.size} ` +
      'pre-rendered route(s). No shadowed route and no landing-page destination.',
  );
}

main();
