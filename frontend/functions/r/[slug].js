// Cloudflare Pages Function for /r/<slug>.
//
// This route serves the public, shared version of one assessment result. It runs
// on app.traficio.com. It calls the public API on api.traficio.com, with no
// cookie and no auth header, the same way an anonymous visitor would. The
// output is plain HTML. A crawler that does not run JavaScript reads only
// this markup, so the score, the sub-scores, the summary, and every finding
// must appear here as real text.
//
// _routes.json in the frontend deploy root scopes this Function to /r/* only.
// See .superpowers/design-notes.md for why that file is mandatory.

const API_ORIGIN = 'https://api.traficio.com';

const PALETTE = {
  bg: '#efe7db',
  card: '#ffffff',
  line: '#ecdfcc',
  ink: '#221c15',
  body: '#4c4237',
  muted: '#7a6a58',
  faint: '#a89478',
  accent: '#b4552f',
  accentTint: '#fbeae1',
  olive: '#6b7d4f',
  oliveTint: '#eaf0e0',
  amber: '#8a6a2f',
  amberTint: '#f7eed8',
};

const SEVERITY_LABEL = { high: 'Needs work', medium: 'Worth a look', low: 'Minor', good: 'Good' };
const SEVERITY_TONE = {
  high: { fg: PALETTE.accent, bg: PALETTE.accentTint },
  medium: { fg: PALETTE.amber, bg: PALETTE.amberTint },
  low: { fg: PALETTE.muted, bg: PALETTE.line },
  good: { fg: PALETTE.olive, bg: PALETTE.oliveTint },
};

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes one value for safe use as HTML text or inside an HTML attribute.
 *  The domain and every finding come from a site the assessment owner does
 *  not control. Every value this Function writes into the page goes through
 *  here first. There is no exception. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function severityLabel(severity) {
  return SEVERITY_LABEL[severity] ?? escapeHtml(severity);
}

function severityTone(severity) {
  return SEVERITY_TONE[severity] ?? { fg: PALETTE.body, bg: PALETTE.line };
}

function pageShell(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: ${PALETTE.bg}; color: ${PALETTE.body}; line-height: 1.5; }
  a { color: ${PALETTE.accent}; }
  main { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
  h1, h2 { color: ${PALETTE.ink}; letter-spacing: -0.02em; margin: 0; }
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>`;
}

function notFoundHtml(slug) {
  return pageShell('Result not found · Traficio', `
  <h1>We could not find that result</h1>
  <p>The link for &ldquo;${escapeHtml(slug)}&rdquo; is no longer shared, or it never existed.</p>
  <p><a href="https://app.traficio.com/">Go to Traficio</a></p>
  `);
}

function findingHtml(finding) {
  const tone = severityTone(finding.severity);
  return `<li class="finding">
    <span class="badge" style="color:${tone.fg};background:${tone.bg}">${escapeHtml(severityLabel(finding.severity))}</span>
    <div class="finding-body">
      <strong>${escapeHtml(finding.title)}</strong>
      <span class="area">${escapeHtml(finding.area)}</span>
      <p>${escapeHtml(finding.description)}</p>
    </div>
  </li>`;
}

function resultHtml(data, canonicalUrl) {
  // Every value below is the raw, untrusted value from the API response. Each
  // value passes through escapeHtml() exactly once, at the point it is
  // written into the HTML string. It is never escaped before that point.
  // This keeps a value that is used twice, such as the domain in both the
  // title text and an attribute, from being escaped twice.
  const domain = data.domain ?? '';
  const scores = data.scores ?? { seo: 0, aeo: 0, geo: 0, overall: 0 };
  const notes = data.scoreNotes ?? {};
  const summary = data.summary ?? '';
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const checkedOn = data.completedAt ?? data.createdAt ?? '';

  const title = `${domain} — visibility score ${scores.overall} · Traficio`;
  const description = summary
    ? summary.slice(0, 155)
    : `See how ${domain} scores for AI and search visibility, and the findings behind the score.`;

  const findingsHtml = findings.length
    ? `<ul class="findings">\n${findings.map(findingHtml).join('\n')}\n</ul>`
    : '<p class="muted">No findings to show.</p>';

  const head = `
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<style>
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${PALETTE.faint}; }
  h1 { font-size: 28px; margin-top: 4px; }
  .muted { color: ${PALETTE.muted}; }
  .score-card { background: ${PALETTE.card}; border: 1.5px solid ${PALETTE.line}; border-radius: 14px; padding: 28px 32px; margin: 24px 0; }
  .overall { display: flex; align-items: baseline; gap: 12px; }
  .overall .num { font-size: 56px; font-weight: 700; color: ${PALETTE.ink}; }
  .subscores { display: flex; gap: 24px; margin-top: 20px; flex-wrap: wrap; }
  .subscore { flex: 1; min-width: 140px; }
  .subscore .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: ${PALETTE.muted}; }
  .subscore .val { font-size: 24px; font-weight: 700; color: ${PALETTE.ink}; }
  .subscore .note { font-size: 13px; color: ${PALETTE.muted}; margin-top: 4px; }
  .summary { font-size: 16px; margin: 24px 0; }
  h2 { font-size: 20px; margin-bottom: 8px; }
  ul.findings { list-style: none; margin: 0; padding: 0; }
  .finding { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid ${PALETTE.line}; align-items: flex-start; }
  .badge { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; padding: 4px 9px; border-radius: 4px; white-space: nowrap; }
  .finding-body strong { display: block; color: ${PALETTE.ink}; }
  .finding-body .area { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: ${PALETTE.faint}; }
  .finding-body p { margin: 6px 0 0; font-size: 14px; }
  footer { margin-top: 40px; font-size: 13px; color: ${PALETTE.faint}; }
</style>`;

  const body = `
  <span class="eyebrow">AI &amp; search visibility report</span>
  <h1>${escapeHtml(domain)}</h1>
  <p class="muted">Checked ${escapeHtml(checkedOn)}</p>

  <section class="score-card">
    <div class="overall"><span class="num">${escapeHtml(scores.overall)}</span><span class="muted">out of 100</span></div>
    <div class="subscores">
      <div class="subscore"><div class="label">SEO</div><div class="val">${escapeHtml(scores.seo)}</div>${notes.seo ? `<div class="note">${escapeHtml(notes.seo)}</div>` : ''}</div>
      <div class="subscore"><div class="label">AEO</div><div class="val">${escapeHtml(scores.aeo)}</div>${notes.aeo ? `<div class="note">${escapeHtml(notes.aeo)}</div>` : ''}</div>
      <div class="subscore"><div class="label">GEO</div><div class="val">${escapeHtml(scores.geo)}</div>${notes.geo ? `<div class="note">${escapeHtml(notes.geo)}</div>` : ''}</div>
    </div>
  </section>

  ${summary ? `<p class="summary">${escapeHtml(summary)}</p>` : ''}

  <h2>What we found</h2>
  ${findingsHtml}

  <footer>Checked with <a href="https://app.traficio.com/">Traficio</a>.</footer>`;

  return pageShell(escapeHtml(title), head + body);
}

export async function onRequestGet(context) {
  const { params, request } = context;
  const slug = params.slug;

  let apiResponse;
  try {
    apiResponse = await fetch(`${API_ORIGIN}/v1/public/results/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
    });
  } catch {
    // The API gave no answer at all, for example a network failure. Treat
    // this the same as "we have nothing to show". Do not leak an internal error.
    return new Response(notFoundHtml(slug), {
      status: 502,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (apiResponse.status === 404) {
    return new Response(notFoundHtml(slug), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (!apiResponse.ok) {
    return new Response(notFoundHtml(slug), {
      status: 502,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  let data;
  try {
    data = await apiResponse.json();
  } catch {
    return new Response(notFoundHtml(slug), {
      status: 502,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const requestUrl = new URL(request.url);
  const canonicalUrl = `${requestUrl.origin}/r/${encodeURIComponent(slug)}`;

  return new Response(resultHtml(data, canonicalUrl), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
