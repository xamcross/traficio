#!/usr/bin/env node
// This script checks the preload paths in every built HTML file. It runs
// after flatten-prerendered-routes.mjs, so app/index.html exists.
// Cloudflare Pages copies each <link rel="modulepreload"> and
// <link rel="preload"> of a page into a Link response header. The browser
// resolves a Link header against the page URL, and it ignores
// <base href="/">. On /auth/complete, the relative path "chunk-ABC.js"
// becomes /auth/chunk-ABC.js, and that file does not exist (issue #26).
// Every preload path must start at the site root or be a full URL.
// The script fails loudly and exits non-zero when a rule breaks, in the
// same style as check-redirects.mjs.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const browserDir = path.join(frontendRoot, 'dist/frontend/browser');

// The rel values that Cloudflare Pages copies into a Link header.
const PRELOAD_RELS = ['preload', 'modulepreload'];

// A root path ("/chunk-ABC.js"), a protocol-relative URL, or a URL with a scheme.
const ABSOLUTE_PATH = /^(\/|[a-z][a-z0-9+.-]*:)/i;

// The failure message lists this many bad links, then gives a count of the rest.
const MAX_LISTED = 20;

function fail(message) {
  console.error(`check-preload-paths.mjs: ${message}`);
  process.exit(1);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined) ?? null;
}

function htmlFiles() {
  return readdirSync(browserDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function preloadLinks(file) {
  const tags = readFileSync(file, 'utf8').match(/<link\b[^>]*>/gi) ?? [];
  return tags
    .map((tag) => ({ rels: (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/), href: attribute(tag, 'href'), tag }))
    .filter((link) => link.href !== null && link.rels.some((rel) => PRELOAD_RELS.includes(rel)));
}

function main() {
  if (!existsSync(browserDir)) {
    fail(
      `The directory "${browserDir}" does not exist. Run the Angular build first, so ` +
        'it writes dist/frontend/browser, then run this script again.',
    );
  }
  const files = htmlFiles();
  if (files.length === 0) {
    fail(`The directory "${browserDir}" holds no HTML file. The build did not write any page.`);
  }

  let checked = 0;
  const bad = [];
  for (const file of files) {
    for (const link of preloadLinks(file)) {
      checked++;
      if (!ABSOLUTE_PATH.test(link.href)) {
        bad.push(`  ${path.relative(browserDir, file)}: ${link.tag}`);
      }
    }
  }

  if (bad.length > 0) {
    const shown = bad.slice(0, MAX_LISTED);
    if (bad.length > MAX_LISTED) {
      shown.push(`  ... and ${bad.length - MAX_LISTED} more`);
    }
    fail(
      `${bad.length} preload link(s) use a relative path. Cloudflare Pages copies them into a ` +
        'Link header, and a nested route then requests the file from a wrong path. Set ' +
        `"deployUrl": "/" in angular.json, so the build writes root paths:\n${shown.join('\n')}`,
    );
  }

  console.log(
    `check-preload-paths.mjs: ${checked} preload link(s) checked in ${files.length} HTML file(s). ` +
      'Every path starts at the site root.',
  );
}

main();
