#!/usr/bin/env node
/**
 * Run one test case in a visible browser and produce its Word evidence record.
 *
 *     npm test TC-INT-020
 *     npm test TC-INT-020 TC-INT-051          two cases, one run
 *     npm test TC-INT-036 --slow              slower, for demonstrating
 *     npm test TC-INT-020 --headless          no window, just the document
 *     npm test TC-INT-020 --no-doc            run it, skip the document
 *
 * Three things happen, in order:
 *
 *   1. The case is located. Case ids are not passed to Playwright as a free-text
 *      filter — the id is resolved to the spec file that defines it and the
 *      project that knows how to authenticate for it. A typo therefore fails
 *      here, naming the ids that do exist, rather than succeeding with "0 tests
 *      matched" which reads like a pass.
 *   2. It executes, with the browser on screen and narrated. See lib/watch.ts.
 *   3. The .docx is built from what the run recorded, by the existing generator
 *      in ../evidence-generator — the same one that builds the full pack, so a
 *      single-case document and a pack document are the same document.
 *
 * Nothing here re-implements a test. It is a way in to the cases that already
 * exist in TEST-CASES-SERVICENOW.md and TEST-CASES-INTEGRATION.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTING = path.join(HERE, '..');
const SPECS = path.join(HERE, 'specs');

// ---------------------------------------------------------------------------
// Which project can run which spec.
//
// This is the mapping that makes a case id runnable on its own: `sf-ui` depends
// on the Salesforce frontdoor login, `sn` on the ServiceNow one, `int` and `etl`
// on no browser at all. Handing a case to the wrong project fails as a login
// error, which is a long way from the real cause.
// ---------------------------------------------------------------------------
const PROJECT_FOR_SPEC = {
  'integration-ui.spec.ts': 'sf-ui',
  'probe-lightning.spec.ts': 'sf-ui',
  'servicenow-cases.spec.ts': 'sn',
  'spike-servicenow.spec.ts': 'sn',
  'integration-readonly.spec.ts': 'int',
  'integration-etl.spec.ts': 'etl',
  'integration-negative.spec.ts': 'int-neg',
};

/**
 * Specs that carry write intent over the wire.
 *
 * Every case in the negative suite is *expected* to be refused, but they send
 * write-shaped HTTP to do it, which sits behind the write rule in CLAUDE.md.
 * Running one from a convenience wrapper would make opting into that risk a
 * side effect of a short command.
 */
const NEEDS_CONFIRMATION = new Set(['integration-negative.spec.ts']);

const CASE_ID = /^TC-(?:INT|SN)-\d{3}$/i;

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('-')).map((a) => a.toLowerCase()));
const ids = argv.filter((a) => !a.startsWith('-')).map((a) => a.toUpperCase());

const headless = flags.has('--headless');
const noDoc = flags.has('--no-doc');
const slow = flags.has('--slow');
const iAcceptWrites = flags.has('--i-accept-write-intent');

if (!ids.length) {
  console.error(
    'Usage: npm test <CASE-ID> [more ids] [--slow] [--headless] [--no-doc]\n' +
      '   e.g. npm test TC-INT-020\n\n' +
      'Case ids come from testing/TEST-CASES-INTEGRATION.md and TEST-CASES-SERVICENOW.md.'
  );
  process.exit(2);
}

const malformed = ids.filter((id) => !CASE_ID.test(id));
if (malformed.length) {
  console.error(`Not a case id: ${malformed.join(', ')}. Expected the form TC-INT-020 or TC-SN-006.`);
  process.exit(2);
}

// --------------------------------------------------------------- locate cases

/** Every case id an executable spec defines, and where it lives. */
function index() {
  const found = new Map();
  for (const file of fs.readdirSync(SPECS).filter((f) => f.endsWith('.spec.ts'))) {
    const src = fs.readFileSync(path.join(SPECS, file), 'utf8');
    for (const m of src.matchAll(/^test\(\s*['"`](TC-[A-Z]+-\d{3})/gm)) {
      found.set(m[1].toUpperCase(), file);
    }
  }
  return found;
}

const defined = index();
const missing = ids.filter((id) => !defined.has(id));

if (missing.length) {
  const all = [...defined.keys()].sort();
  console.error(
    `No executable spec defines ${missing.join(', ')}.\n\n` +
      `The ${all.length} cases that are automated today:\n  ` +
      all.join('  ') +
      '\n\nThe rest are specified in the markdown but not yet written as specs, ' +
      'or need a decision before they can run — see testing/README.md.'
  );
  process.exit(1);
}

const specs = [...new Set(ids.map((id) => defined.get(id)))];
if (specs.length > 1) {
  console.error(
    `Those cases live in different spec files (${specs.join(', ')}), which need different logins.\n` +
      'Run them as separate commands.'
  );
  process.exit(1);
}

const spec = specs[0];
const project = PROJECT_FOR_SPEC[spec];
if (!project) {
  console.error(`No project is configured for ${spec}. Add it to PROJECT_FOR_SPEC in run-case.mjs.`);
  process.exit(1);
}

if (NEEDS_CONFIRMATION.has(spec) && !iAcceptWrites) {
  console.error(
    `${ids.join(', ')} lives in ${spec}, which sends write-shaped requests — every one is expected to\n` +
      'be refused, but they are still writes over the wire, and that needs a deliberate decision.\n' +
      'See "Pending" in testing/README.md. Re-run with --i-accept-write-intent once it is taken.'
  );
  process.exit(1);
}

// -------------------------------------------------------------------- execute

// Anchor the grep so TC-INT-02 cannot pull in TC-INT-020..029, and so a case id
// appearing inside another case's title cannot widen the run.
const grep = ids.map((id) => `${id} `).join('|');

const env = { ...process.env };
if (!headless) {
  env.WATCH = '1';
  env.WATCH_PACE = slow ? '1600' : '900';
  env.WATCH_SLOWMO = slow ? '600' : '320';
}

console.log('');
console.log(`  Case      ${ids.join(', ')}`);
console.log(`  Spec      ${spec}  (project ${project})`);
console.log(`  Browser   ${headless ? 'headless' : 'visible, narrated' + (slow ? ', slow' : '')}`);
console.log('');

const run = spawnSync(
  process.execPath,
  [require.resolve('@playwright/test/cli'), 'test', `specs/${spec}`, `--project=${project}`, '--grep', grep],
  { cwd: HERE, env, stdio: 'inherit' }
);

const testExit = run.status ?? 1;

// ------------------------------------------------------------------- document

if (noDoc) {
  process.exit(testExit);
}

// Built whether the case passed or failed. A failed case is evidence too, and a
// document that only appears on success is the one you cannot show anybody.
/**
 * Find a Python that can actually run the generator.
 *
 * Two traps on Windows, and both report as "Python was not found":
 *
 *   - **The Microsoft Store alias.** `%LOCALAPPDATA%\Microsoft\WindowsApps`
 *     ships stub `python.exe` / `python3.exe` that exist, are on PATH, and do
 *     nothing but advertise the Store. A plain `spawnSync('python')` finds one
 *     and reports failure as though Python were absent.
 *   - **A stale shell.** Python is installed per-user, so a terminal opened
 *     before the install has neither it nor its Scripts directory on PATH even
 *     though both are on the PATH held in the registry.
 *
 * So: probe each candidate by running it, accept only one that answers with a
 * version, and fall back to the standard per-user install locations before
 * giving up. PYTHON in the environment overrides the lot.
 */
function findPython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push(process.env.PYTHON);
  candidates.push('python', 'py', 'python3');

  const local = process.env.LOCALAPPDATA;
  const roots = [
    local && path.join(local, 'Programs', 'Python'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Python'),
    'C:\\',
  ].filter(Boolean);

  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && /^Python3\d*$/i.test(e.name)) {
        candidates.push(path.join(root, e.name, 'python.exe'));
      }
    }
  }

  for (const cand of candidates) {
    const probe = spawnSync(cand, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.error) continue;
    const said = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    // The Store stub exits non-zero and says "Python was not found"; a real
    // interpreter prints "Python 3.x.y".
    if (probe.status === 0 && /^Python 3\./m.test(said)) return cand;
  }
  return null;
}

const recorded = ids.filter((id) => fs.existsSync(path.join(HERE, 'results', 'cases', `${id}.json`)));
if (!recorded.length) {
  console.error(
    `\n  The run recorded no result for ${ids.join(', ')}, so there is nothing to document.`
  );
  process.exit(testExit || 1);
}

const generator = path.join(TESTING, 'evidence-generator');
const python = findPython();
let built = false;

if (python) {
  const build = spawnSync(
    python,
    ['generate_evidence.py', '--only', recorded.join(','), '--no-summary'],
    { cwd: generator, env, stdio: 'inherit' }
  );
  built = !build.error && build.status === 0;
}

console.log('');
const docs = recorded
  .map((id) => path.join(TESTING, 'evidence-packs', `${id}.docx`))
  .filter((d) => fs.existsSync(d));

if (built && docs.length) {
  for (const d of docs) console.log(`  Evidence record   ${d}`);
  // Open the first only. Opening several at once buries the one just asked for
  // behind the others.
  spawnSync('cmd', ['/c', 'start', '', docs[0]], { stdio: 'ignore' });
} else if (!python) {
  console.log('  No document was produced: no working Python interpreter was found.');
  console.log('  The results are still on disk and the document can be built at any time.');
  console.log('  Install Python 3, then:  python -m pip install python-docx');
  console.log('  Or point this at an existing one:  set PYTHON=C:\\path\\to\\python.exe');
} else {
  console.log(`  No document was produced. Python is ${python}; check python-docx is installed:`);
  console.log(`    "${python}" -m pip install python-docx`);
}
for (const id of recorded) console.log(`  Screenshots       ${path.join(HERE, 'evidence', id)}`);
if (!headless) console.log(`  Recording         ${path.join(HERE, 'test-results')}`);
console.log('');

process.exit(testExit);
