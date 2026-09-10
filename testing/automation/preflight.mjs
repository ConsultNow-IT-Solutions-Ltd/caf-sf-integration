#!/usr/bin/env node
/**
 * Preflight: check the harness configuration before a run spends anything.
 *
 *   node preflight.mjs           check .env and the files it points at
 *   node preflight.mjs --probe   also call GET /caf/snapshot as sf.integration
 *
 * Why this exists: a run of the inbound negative cases once recorded eight
 * BLOCKED verdicts because the sf.integration password given to the harness was
 * wrong (CAF-188). The specs now detect that at run time, but only after the
 * run has started and the evidence folder has been written. Every problem found
 * here is one a run would otherwise discover the slow way.
 *
 * Exit code 0 when there are no errors (warnings allowed), 1 otherwise. Never
 * prints a secret - only whether one is present and where it came from.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULTS = {
  SN_INSTANCE: 'https://dev249570.service-now.com',
  CNIT_PS1: 'C:\\audit\\cnit-instance-tools-main\\cnit.ps1',
  SF_INTEGRATION_PASSWORD_FILE: 'C:\\Users\\patel\\.caf-jwt\\sf-integration-password.txt',
};

const SNAPSHOT_PATH = '/api/x_gskn2_caf_compli/caf/snapshot';

/**
 * Lines in the raw .env whose unquoted value contains `#`. Node's loader ends
 * an unquoted value at `#`, so the variable silently loses everything after it
 * - for a password that means every call answers 401 and looks like a refusal.
 */
export function unquotedHashes(rawEnv) {
  const hits = [];
  rawEnv.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) return;
    const value = m[2].trim();
    if (!value || value.startsWith('#')) return;
    if (/^(['"`]).*\1$/.test(value)) return;
    if (value.includes('#')) hits.push({ line: i + 1, key: m[1] });
  });
  return hits;
}

/**
 * Validate a configuration. Pure apart from the injected `exists` and `read`,
 * so it can be tested without touching the machine it runs on.
 *
 * @param {object}   opts
 * @param {string?}  opts.rawEnv  contents of .env, or null when there is none
 * @param {object}   opts.env     the variables as Node would see them
 * @param {Function} opts.exists  path -> boolean
 * @param {Function} opts.read    path -> string
 * @returns {{ errors: string[], warnings: string[], info: string[] }}
 */
export function checkConfig({ rawEnv, env, exists, read }) {
  const errors = [];
  const warnings = [];
  const info = [];

  if (rawEnv == null) {
    warnings.push('No .env file. Copy .env.example to .env; until then only real environment variables are used.');
  } else {
    for (const { line, key } of unquotedHashes(rawEnv)) {
      errors.push(
        `.env line ${line}: ${key} has an unquoted "#". Node cuts the value off there. ` +
          `Wrap it in single quotes: ${key}='...'`
      );
    }
  }

  // ServiceNow instance
  const instance = env.SN_INSTANCE || DEFAULTS.SN_INSTANCE;
  let url = null;
  try {
    url = new URL(instance);
  } catch {
    errors.push(`SN_INSTANCE is not a URL: "${instance}".`);
  }
  if (url) {
    if (url.protocol !== 'https:') errors.push(`SN_INSTANCE must be https: "${instance}".`);
    if (url.pathname !== '/' && url.pathname !== '') {
      errors.push(`SN_INSTANCE should be the host only, without a path: "${instance}".`);
    }
    if (!/\.service-now\.com$/.test(url.hostname)) {
      warnings.push(`SN_INSTANCE host "${url.hostname}" is not a *.service-now.com instance.`);
    }
    if (!env.SN_INSTANCE) info.push(`SN_INSTANCE not set; using the default ${DEFAULTS.SN_INSTANCE}.`);
  }

  // ServiceNow UI login - only the browser suites need it
  if (!env.SN_USER || !env.SN_PASSWORD) {
    warnings.push('SN_USER / SN_PASSWORD not both set. The browser suites (npm run auth, sn) will not log in.');
  }

  // sf.integration password - the inbound API suites need it
  if (env.SF_INTEGRATION_PASSWORD) {
    if (env.SF_INTEGRATION_PASSWORD !== env.SF_INTEGRATION_PASSWORD.trim()) {
      warnings.push('SF_INTEGRATION_PASSWORD has leading or trailing spaces. The harness trims them; check that is intended.');
    }
    info.push('sf.integration password: from SF_INTEGRATION_PASSWORD.');
  } else {
    const file = env.SF_INTEGRATION_PASSWORD_FILE || DEFAULTS.SF_INTEGRATION_PASSWORD_FILE;
    const named = !!env.SF_INTEGRATION_PASSWORD_FILE;
    if (!exists(file)) {
      (named ? errors : warnings).push(
        `sf.integration password file not found: ${file}. ` +
          'The inbound API suites (int:neg and the write suites) will refuse to start.'
      );
    } else if (!read(file).trim()) {
      errors.push(`sf.integration password file is empty: ${file}.`);
    } else {
      info.push(`sf.integration password: from ${file}.`);
    }
  }

  // cnit toolkit - every read-only ServiceNow query goes through it
  const cnit = env.CNIT_PS1 || DEFAULTS.CNIT_PS1;
  if (!exists(cnit)) {
    (env.CNIT_PS1 ? errors : warnings).push(
      `cnit.ps1 not found at ${cnit}. ServiceNow reads would fail as "not recognized as a cmdlet". Set CNIT_PS1.`
    );
  }

  return { errors, warnings, info };
}

/**
 * Turn a snapshot probe's status into a verdict. A 401 here is the CAF-188
 * case: the integration is fine, the harness's credential is not.
 */
export function judgeProbe(status) {
  if (status === 200) return { ok: true, message: 'GET /caf/snapshot answered 200 as sf.integration.' };
  if (status === 401) {
    return {
      ok: false,
      message:
        'GET /caf/snapshot answered 401 as sf.integration. The password the harness holds is wrong, or was ' +
        'cut short at a "#". Every inbound case would record BLOCKED. Check it against the ServiceNow_CAF ' +
        'named credential before running.',
    };
  }
  if (status === 403) {
    return { ok: false, message: 'GET /caf/snapshot answered 403. sf.integration authenticated but lacks the role for the API.' };
  }
  return { ok: false, message: `GET /caf/snapshot answered ${status}. Check the instance is awake and the app is installed.` };
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return null;
  try {
    process.loadEnvFile(file);
  } catch {
    /* reported through the raw-text checks */
  }
  return fs.readFileSync(file, 'utf8');
}

function readPassword(env) {
  if (env.SF_INTEGRATION_PASSWORD) return env.SF_INTEGRATION_PASSWORD.trim();
  const file = env.SF_INTEGRATION_PASSWORD_FILE || DEFAULTS.SF_INTEGRATION_PASSWORD_FILE;
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
}

async function probe(env) {
  const base = (env.SN_INSTANCE || DEFAULTS.SN_INSTANCE).replace(/\/$/, '');
  const password = readPassword(env);
  if (!password) return { ok: false, message: 'Probe skipped: no sf.integration password.' };
  try {
    const res = await fetch(base + SNAPSHOT_PATH, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`sf.integration:${password}`).toString('base64'),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
    });
    return judgeProbe(res.status);
  } catch (err) {
    return { ok: false, message: `Probe could not reach ${base}: ${err.message}` };
  }
}

async function main() {
  const rawEnv = loadEnv(path.join(HERE, '.env'));
  const result = checkConfig({
    rawEnv,
    env: process.env,
    exists: (p) => fs.existsSync(p),
    read: (p) => fs.readFileSync(p, 'utf8'),
  });

  if (process.argv.includes('--probe')) {
    const p = await probe(process.env);
    (p.ok ? result.info : result.errors).push(p.message);
  }

  for (const m of result.info) console.log(`  ok    ${m}`);
  for (const m of result.warnings) console.log(`  warn  ${m}`);
  for (const m of result.errors) console.log(`  ERROR ${m}`);
  console.log(
    `\nPreflight: ${result.errors.length} error(s), ${result.warnings.length} warning(s).` +
      (result.errors.length ? ' Fix the errors before running.' : '')
  );
  process.exitCode = result.errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
