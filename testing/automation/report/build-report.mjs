#!/usr/bin/env node
/**
 * Build one self-contained HTML evidence record from a run.
 *
 * The Word generator in ../../evidence-generator produces the formal, branded,
 * one-document-per-case pack. This is the other half of the loop: a single file
 * you can open the second a watched run finishes, and send to somebody without
 * a Python environment, a font, or the screenshots travelling separately.
 *
 * It reads exactly what the specs recorded — results/**\/cases/TC-*.json — and
 * renders it. Nothing here restates what a case is supposed to prove; if it
 * isn't in the JSON, it doesn't appear in the document.
 *
 *   node report/build-report.mjs --in results/demo/cases --out results/demo/evidence-report.html
 *
 * Flags:
 *   --in <dir>       directory of case JSON files   (default results/cases)
 *   --out <file>     HTML file to write             (default <in>/../evidence-report.html)
 *   --title <text>   document title
 *   --since <iso>    only cases written at or after this time — see below
 *   --link-images    reference screenshots by path instead of embedding them
 *   --open           open the finished document in the default browser
 *
 * `--since` exists because results/cases is an archive, not a run. Reporting on
 * the whole directory after executing one case would produce a document
 * covering cases this run did not execute, dated as though it had — which is
 * the one failure mode an evidence record must not have. watch.ps1 stamps the
 * time it started and passes it here.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFile } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--link-images' || a === '--open') out.flags.add(a.slice(2));
    else if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const inDir = path.resolve(ROOT, args.in || path.join('results', 'cases'));
const outFile = path.resolve(
  ROOT,
  args.out || path.join(path.dirname(inDir), 'evidence-report.html')
);
const embed = !args.flags.has('link-images');

if (!fs.existsSync(inDir)) {
  console.error(`[report] No case directory at ${inDir}. Run a suite first.`);
  process.exit(1);
}

// ------------------------------------------------------------------ reading

const since = args.since ? new Date(args.since) : null;
if (since && Number.isNaN(since.valueOf())) {
  console.error(`[report] --since "${args.since}" is not a date.`);
  process.exit(1);
}

const all = fs.readdirSync(inDir).filter((f) => f.endsWith('.json'));
const files = all
  .filter((f) => !since || fs.statSync(path.join(inDir, f)).mtime >= since)
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const excluded = all.length - files.length;

if (!files.length) {
  console.error(
    `[report] ${inDir} holds no case files${since ? ' written since ' + since.toISOString() : ''}.` +
      (excluded ? ` ${excluded} older file(s) were skipped.` : '')
  );
  process.exit(1);
}

const cases = [];
for (const f of files) {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(inDir, f), 'utf8'));
    // The specs write { run, case }. Tolerate a bare case object too, so a
    // hand-written or older file still renders rather than aborting the build.
    cases.push({ run: payload.run || null, c: payload.case || payload });
  } catch (err) {
    console.warn(`[report] skipping ${f}: ${err.message}`);
  }
}

const run = cases.find((x) => x.run)?.run || {};

/**
 * Screen recordings, if the run made any.
 *
 * Playwright names the directory after the test title, not the case id, so
 * these are listed rather than attached to a case — claiming the wrong video
 * belongs to a case would be worse than not offering one.
 */
function findVideos(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findVideos(full, acc);
    else if (entry.name.endsWith('.webm')) acc.push(full);
  }
  return acc;
}
const videos = findVideos(path.join(ROOT, 'test-results'));

// ------------------------------------------------------------------ helpers

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let embeddedBytes = 0;
let missingImages = 0;

function imageSrc(file) {
  if (!fs.existsSync(file)) {
    missingImages += 1;
    return null;
  }
  if (!embed) return pathToFileURL(file).href;
  const buf = fs.readFileSync(file);
  embeddedBytes += buf.length;
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function duration(c) {
  if (!c.startedAt || !c.finishedAt) return '';
  const ms = new Date(c.finishedAt) - new Date(c.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const VERDICT_CLASS = { PASS: 'pass', FAIL: 'fail', BLOCKED: 'blocked', 'NOT RUN': 'notrun' };
const verdictClass = (v) => VERDICT_CLASS[v] || 'notrun';

/** Render a record dump as a table, or as a plain note when it holds no rows. */
function recordTable(r) {
  const rows = Array.isArray(r.rows) ? r.rows.filter(Boolean) : [];
  const head = `<div class="rec-head"><span class="rec-label">${esc(r.label)}</span>` +
    `<code class="rec-q">${esc(r.table)}${r.query ? ' &middot; ' + esc(r.query) : ''}</code></div>`;

  if (!rows.length) {
    return `<div class="record">${head}<p class="empty">No rows returned — which for several ` +
      `cases is the assertion.</p></div>`;
  }

  const cols = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const th = cols.map((c) => `<th>${esc(c)}</th>`).join('');
  const tr = rows
    .map(
      (row) =>
        `<tr>${cols.map((c) => `<td>${esc(row[c] ?? '')}</td>`).join('')}</tr>`
    )
    .join('');
  return `<div class="record">${head}<div class="scroll"><table class="rec">` +
    `<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div></div>`;
}

function caseSection(entry) {
  const c = entry.c;
  const shots = [];

  const steps = (c.steps || [])
    .map((s) => {
      const imgs = (s.screenshots || [])
        .map((f) => {
          const src = imageSrc(f);
          if (!src) return `<p class="empty">Screenshot missing from disk: ${esc(path.basename(f))}</p>`;
          shots.push(1);
          return `<figure><img src="${src}" alt="${esc(path.basename(f))}" loading="lazy">` +
            `<figcaption>${esc(path.basename(f))}</figcaption></figure>`;
        })
        .join('');
      return `<li><div class="step-text">${esc(s.text)}</div>${imgs}</li>`;
    })
    .join('');

  const list = (items, cls) =>
    items && items.length
      ? `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : '<p class="empty">None recorded.</p>';

  return `
<section class="case" id="${esc(c.id)}">
  <header class="case-head">
    <div>
      <h2>${esc(c.id)}</h2>
      <p class="case-title">${esc(c.title)}</p>
    </div>
    <span class="pill ${verdictClass(c.verdict)}">${esc(c.verdict)}</span>
  </header>

  ${c.verdictReason ? `<p class="reason">${esc(c.verdictReason)}</p>` : ''}

  <div class="grid2">
    <div><h3>Expected</h3>${list(c.expected, 'expect')}</div>
    <div><h3>Observed</h3>${list(c.actual, 'actual')}</div>
  </div>

  <h3>Execution — ${(c.steps || []).length} step${(c.steps || []).length === 1 ? '' : 's'}${
    shots.length ? `, ${shots.length} screenshot${shots.length === 1 ? '' : 's'}` : ''
  }${duration(c) ? ` &middot; ${duration(c)}` : ''}</h3>
  <ol class="steps">${steps || '<li class="empty">No steps recorded.</li>'}</ol>

  ${
    (c.records || []).length
      ? `<h3>Records examined</h3>${(c.records || []).map(recordTable).join('')}`
      : ''
  }

  ${
    (c.observations || []).length
      ? `<h3>Observations</h3>${list(c.observations, 'obs')}`
      : ''
  }
</section>`;
}

// ------------------------------------------------------------------- render

const tally = cases.reduce((acc, { c }) => {
  acc[c.verdict] = (acc[c.verdict] || 0) + 1;
  return acc;
}, {});

const summaryRows = cases
  .map(
    ({ c }) =>
      `<tr><td><a href="#${esc(c.id)}">${esc(c.id)}</a></td><td>${esc(c.title)}</td>` +
      `<td><span class="pill sm ${verdictClass(c.verdict)}">${esc(c.verdict)}</span></td>` +
      `<td class="muted">${esc(c.verdictReason || '')}</td></tr>`
  )
  .join('');

const title = args.title || 'CAF Compliance — test evidence';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #ffffff; --fg: #16202e; --muted: #5d6b7f; --line: #dfe5ee;
    --panel: #f6f8fb; --accent: #1f4f8f;
    --pass-bg: #e3f5eb; --pass-fg: #17693f; --pass-bd: #a8ddc2;
    --fail-bg: #fde9e9; --fail-fg: #a02020; --fail-bd: #f0b4b4;
    --blocked-bg: #fdf2dd; --blocked-fg: #8a5d0b; --blocked-bd: #ebd39a;
    --notrun-bg: #eef1f5; --notrun-fg: #5d6b7f; --notrun-bd: #d3dae4;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0e131b; --fg: #e6ecf5; --muted: #97a5ba; --line: #26313f;
      --panel: #151d28; --accent: #7fb0f0;
      --pass-bg: #10301f; --pass-fg: #6fe0a4; --pass-bd: #235f3e;
      --fail-bg: #331414; --fail-fg: #ff8b8b; --fail-bd: #6d2626;
      --blocked-bg: #33280e; --blocked-fg: #f0c46a; --blocked-bd: #6b5420;
      --notrun-bg: #1b232e; --notrun-fg: #97a5ba; --notrun-bd: #2f3a48;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.6 "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; }

  header.doc { border-bottom: 3px solid var(--accent); padding-bottom: 22px; margin-bottom: 30px; }
  header.doc h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: -0.01em; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 26px; color: var(--muted); font-size: 13.5px; }
  .meta b { color: var(--fg); font-weight: 600; }

  .counts { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 34px; }
  .count {
    border: 1px solid var(--line); border-radius: 10px; padding: 12px 18px;
    background: var(--panel); min-width: 108px;
  }
  .count .n { font-size: 26px; font-weight: 700; line-height: 1.1; }
  .count .l { font-size: 11.5px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); }

  .pill {
    display: inline-block; padding: 4px 13px; border-radius: 999px; font-size: 12px;
    font-weight: 700; letter-spacing: 0.07em; white-space: nowrap;
    background: var(--notrun-bg); color: var(--notrun-fg); border: 1px solid var(--notrun-bd);
  }
  .pill.sm { padding: 2px 10px; font-size: 11px; }
  .pill.pass { background: var(--pass-bg); color: var(--pass-fg); border-color: var(--pass-bd); }
  .pill.fail { background: var(--fail-bg); color: var(--fail-fg); border-color: var(--fail-bd); }
  .pill.blocked { background: var(--blocked-bg); color: var(--blocked-fg); border-color: var(--blocked-bd); }

  h2 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  h3 {
    font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);
    margin: 26px 0 10px; font-weight: 700;
  }

  table.summary { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.summary th {
    text-align: left; font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); border-bottom: 2px solid var(--line); padding: 8px 10px;
  }
  table.summary td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.summary a { color: var(--accent); text-decoration: none; font-weight: 600; }
  table.summary a:hover { text-decoration: underline; }
  .muted { color: var(--muted); font-size: 13px; }

  section.case {
    border: 1px solid var(--line); border-radius: 14px; padding: 26px 28px;
    margin: 34px 0; background: var(--bg); scroll-margin-top: 20px;
  }
  .case-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
    border-bottom: 1px solid var(--line); padding-bottom: 16px;
  }
  .case-title { margin: 4px 0 0; color: var(--muted); font-size: 14.5px; }
  .reason {
    margin: 16px 0 0; padding: 12px 15px; background: var(--panel);
    border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; font-size: 14px;
  }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 34px; }
  @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
  ul.expect, ul.actual, ul.obs { margin: 0; padding-left: 20px; font-size: 14px; }
  ul.expect li, ul.actual li, ul.obs li { margin-bottom: 7px; }
  .empty { color: var(--muted); font-style: italic; font-size: 13.5px; margin: 4px 0; }

  ol.steps { margin: 0; padding-left: 22px; }
  ol.steps > li { margin-bottom: 20px; }
  .step-text { font-weight: 600; margin-bottom: 10px; }
  figure { margin: 12px 0 16px; }
  figure img {
    max-width: 100%; height: auto; display: block;
    border: 1px solid var(--line); border-radius: 8px;
  }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 5px; font-family: ui-monospace, Consolas, monospace; }

  .record { margin: 0 0 20px; }
  .rec-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 7px; }
  .rec-label { font-weight: 600; font-size: 14px; }
  .rec-q { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: var(--muted); }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
  table.rec { border-collapse: collapse; width: 100%; font-size: 12.5px; font-family: ui-monospace, Consolas, monospace; }
  table.rec th {
    background: var(--panel); text-align: left; padding: 7px 11px; white-space: nowrap;
    border-bottom: 1px solid var(--line); font-weight: 700;
  }
  table.rec td { padding: 6px 11px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  table.rec tr:last-child td { border-bottom: 0; }

  .videos { margin-top: 40px; font-size: 14px; }
  .videos li { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; margin-bottom: 4px; }
  .videos a { color: var(--accent); }

  footer.doc { margin-top: 50px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12.5px; }

  @media print {
    section.case { break-inside: avoid-page; border-color: #ccc; }
    body { background: #fff; color: #000; }
  }
</style>
</head>
<body>
<div class="wrap">

<header class="doc">
  <h1>${esc(title)}</h1>
  <div class="meta">
    ${run.instance ? `<span>Instance <b>${esc(run.instance)}</b></span>` : ''}
    ${run.executedBy ? `<span>Executed by <b>${esc(run.executedBy)}</b></span>` : ''}
    <span>Cases <b>${cases.length}</b></span>
  </div>
  ${run.executedVia ? `<p class="muted" style="margin:10px 0 0">${esc(run.executedVia)}</p>` : ''}
</header>

<div class="counts">
  ${['PASS', 'FAIL', 'BLOCKED', 'NOT RUN']
    .filter((v) => tally[v])
    .map(
      (v) =>
        `<div class="count"><div class="n" style="color:var(--${verdictClass(v)}-fg)">${tally[v]}</div>` +
        `<div class="l">${esc(v)}</div></div>`
    )
    .join('')}
</div>

<h3>Summary</h3>
<table class="summary">
  <thead><tr><th>Case</th><th>Title</th><th>Verdict</th><th>Reason</th></tr></thead>
  <tbody>${summaryRows}</tbody>
</table>

${cases.map(caseSection).join('')}

${
  videos.length
    ? `<div class="videos"><h3>Screen recordings</h3><p class="muted">Captured by this run. ` +
      `Named by test title rather than case id, so they are listed rather than attached.</p><ul>` +
      videos
        .map(
          (v) =>
            `<li><a href="${pathToFileURL(v).href}">${esc(path.relative(ROOT, v))}</a></li>`
        )
        .join('') +
      `</ul></div>`
    : ''
}

<footer class="doc">
  Generated from ${esc(path.relative(ROOT, inDir))} — the JSON each case wrote as it ran.
  Nothing in this document is retyped from a specification.
  ${
    excluded
      ? `This document covers the ${cases.length} case(s) executed by this run; ` +
        `${excluded} earlier result(s) in the same directory are not included.`
      : ''
  }
</footer>

</div>
</body>
</html>`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `[report] ${cases.length} case(s) -> ${outFile} (${kb(Buffer.byteLength(html))}` +
    `${embed && embeddedBytes ? `, ${kb(embeddedBytes)} of screenshots embedded` : ''})`
);
for (const v of ['PASS', 'FAIL', 'BLOCKED', 'NOT RUN']) {
  if (tally[v]) console.log(`[report]   ${v}: ${tally[v]}`);
}
if (missingImages) {
  console.warn(`[report] ${missingImages} screenshot(s) named in the results are not on disk.`);
}

if (args.flags.has('open')) {
  // start via cmd, because the HTML has no executable bit and `start` is a shell
  // builtin rather than a program.
  execFile('cmd', ['/c', 'start', '', outFile], (err) => {
    if (err) console.warn(`[report] could not open the document: ${err.message}`);
  });
}
