// node --test preflight.test.mjs  (npm run preflight:test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig, unquotedHashes, judgeProbe, DEFAULTS } from './preflight.mjs';

const PW_FILE = 'C:\\pw.txt';
const CNIT = 'C:\\cnit.ps1';

/** A configuration that passes cleanly; each test breaks one thing. */
function good(overrides = {}) {
  const files = { [PW_FILE]: 'secret', [CNIT]: '# cnit' };
  return {
    rawEnv: 'SN_INSTANCE=https://dev249570.service-now.com\n',
    env: {
      SN_INSTANCE: 'https://dev249570.service-now.com',
      SN_USER: 'tester',
      SN_PASSWORD: 'x',
      SF_INTEGRATION_PASSWORD_FILE: PW_FILE,
      CNIT_PS1: CNIT,
    },
    exists: (p) => p in files,
    read: (p) => files[p],
    ...overrides,
  };
}

// TC-PRE-001
test('a complete configuration has no errors or warnings', () => {
  const r = checkConfig(good());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

// TC-PRE-002 - the CAF-188 trap
test('an unquoted # in a value is an error naming the line and key', () => {
  const hits = unquotedHashes('A=1\nSF_INTEGRATION_PASSWORD=ab#cd\n');
  assert.deepEqual(hits, [{ line: 2, key: 'SF_INTEGRATION_PASSWORD' }]);

  const r = checkConfig(good({ rawEnv: 'SF_INTEGRATION_PASSWORD=ab#cd\n' }));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /line 1: SF_INTEGRATION_PASSWORD/);
});

// TC-PRE-003
test('a quoted # and a comment line are both fine', () => {
  assert.deepEqual(unquotedHashes("P='ab#cd'\nQ=\"x#y\"\n# a comment\nR=\n"), []);
});

// TC-PRE-004
test('SN_INSTANCE must be an https host with no path', () => {
  const env = (v) => good({ env: { ...good().env, SN_INSTANCE: v } });
  assert.match(checkConfig(env('not a url')).errors[0], /not a URL/);
  assert.match(checkConfig(env('http://dev249570.service-now.com')).errors[0], /https/);
  assert.match(checkConfig(env('https://dev249570.service-now.com/now/nav')).errors[0], /without a path/);
  assert.match(checkConfig(env('https://example.com')).warnings[0], /not a \*\.service-now\.com/);
});

// TC-PRE-005
test('a named password file that does not exist is an error; the default path is only a warning', () => {
  const named = checkConfig(good({ exists: (p) => p === CNIT }));
  assert.ok(named.errors.some((e) => /password file not found/.test(e)));

  const env = { ...good().env };
  delete env.SF_INTEGRATION_PASSWORD_FILE;
  const fallback = checkConfig(good({ env, exists: (p) => p === CNIT }));
  assert.deepEqual(fallback.errors, []);
  assert.ok(fallback.warnings.some((w) => w.includes(DEFAULTS.SF_INTEGRATION_PASSWORD_FILE)));
});

// TC-PRE-006
test('an empty password file is an error', () => {
  const r = checkConfig(good({ read: (p) => (p === PW_FILE ? '  \n' : '') }));
  assert.ok(r.errors.some((e) => /password file is empty/.test(e)));
});

// TC-PRE-007
test('SF_INTEGRATION_PASSWORD takes precedence over the file and is never echoed', () => {
  const env = { ...good().env, SF_INTEGRATION_PASSWORD: 'hunter2' };
  delete env.SF_INTEGRATION_PASSWORD_FILE;
  const r = checkConfig(good({ env, exists: (p) => p === CNIT }));
  assert.deepEqual(r.errors, []);
  const all = [...r.errors, ...r.warnings, ...r.info].join('\n');
  assert.ok(!all.includes('hunter2'));
});

// TC-PRE-008
test('a missing UI login is a warning, not an error', () => {
  const env = { ...good().env };
  delete env.SN_PASSWORD;
  const r = checkConfig(good({ env }));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /SN_USER/.test(w)));
});

// TC-PRE-009
test('a probe 401 is reported as a credential problem, not a refusal', () => {
  assert.equal(judgeProbe(200).ok, true);
  const v = judgeProbe(401);
  assert.equal(v.ok, false);
  assert.match(v.message, /password the harness holds is wrong/);
  assert.match(judgeProbe(403).message, /lacks the role/);
  assert.match(judgeProbe(503).message, /503/);
});
