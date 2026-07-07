import { test, expect } from '@playwright/test';
import path from 'path';
import { CaseEvidence, flushCurrentCase, describeRun } from '../lib/evidence';
import { cnitGet, cnitCommand, TABLES } from '../lib/cnit';
import * as caf from '../lib/cafapi';
import { SN_INSTANCE } from '../playwright.config';

/**
 * TEST-CASES-INTEGRATION.md — the cases the API is expected to refuse.
 *
 * TC-INT-013/014/015 against `PATCH /caf/task/{sysId}`, TC-INT-032/033/034/035
 * and the refusal half of TC-INT-029 against `POST /caf/task/{sysId}/attest`.
 *
 * **Every call here is write-shaped and every one is expected to be rejected
 * before it writes.** That is the whole assertion: a refusal that leaves a
 * partial write behind is worse than no check at all, so each case re-reads the
 * task afterwards and fails on *any* moved field, not merely on the one it aimed
 * at. `sys_updated_on` and `sys_mod_count` are compared alongside the business
 * fields because a business rule can move a record without changing anything a
 * caller asked for.
 *
 * Separate from `integration-readonly.spec.ts`, and on its own Playwright
 * project, deliberately. That file can be re-run by anyone on any day; this one
 * sends write intent over the wire and so sits behind the write rule in
 * CLAUDE.md. Folding them together would make the safe pass unsafe by
 * association.
 *
 * ### Fixtures are discovered, never hardcoded
 *
 * Each case queries for a task in the state it needs. The instance's task set
 * moves — closing one spawns the next (HANDOFF section 6) — so a pinned sys_id
 * would eventually test a task in the wrong state and pass for the wrong reason.
 * Where no suitable task exists the case records **BLOCKED** rather than writing
 * one into existence, since manufacturing the fixture is exactly the write these
 * cases are designed not to make.
 *
 * ### The check order, which is what the fixtures have to satisfy
 *
 * Read from the deployed resources, not from the design document:
 *
 *   attest:  empty body -> outcome enum -> met_criteria enum -> 404 -> active
 *            -> In Progress -> already-that-outcome -> evidence gate
 *   update:  empty body -> 404 -> allow-list
 *
 * So a closed task can never reach the In Progress message, an Open task can
 * never reach the evidence gate, and the two enum checks are reachable with a
 * sys_id that does not exist at all — which TC-INT-035 uses as its proof.
 */

const RESULTS = path.join(__dirname, '..', 'results');

/**
 * A sys_id no record holds, used where the case wants the API to answer before
 * it ever loads a record. Verified absent at the point of use rather than
 * assumed: a fixture that silently matches a real task would turn a refusal case
 * into a write.
 */
const ABSENT_SYS_ID = 'deadbeefdeadbeefdeadbeefdeadbeef';

/**
 * The fields compared before and after every refused call.
 *
 * `comments` is here because it is the only allow-listed field these cases send
 * whose value is harmless, so it is the one a partial write would land in.
 */
const TASK_FIELDS = [
  'number',
  'sys_id',
  'state',
  'active',
  'approval',
  'met_criteria',
  'comments',
  'actual_start_date',
  'sys_updated_on',
  'sys_mod_count',
];

/** Marker written by no case that passes. If it ever appears on a task, a refusal leaked. */
const CANARY = 'TC-INT-013 canary - this comment must never be stored';

describeRun({
  instance: SN_INSTANCE,
  executedBy: 'sf.integration (ServiceNow Scripted REST API)',
  executedVia:
    'Playwright runner, no browser. Each case calls the inbound API as sf.integration — the same user the ' +
    'named credential uses, because the echo-loop guard keys off it — and re-reads the task over cnit ' +
    'before and after to prove nothing was written.',
});

test.afterEach(({}, testInfo) => {
  flushCurrentCase(RESULTS, testInfo.status, testInfo.error?.message);
});

test.afterAll(async () => {
  await caf.disposeCafApi();
});

// --------------------------------------------------------------------- helpers

/**
 * Is the inbound API answering at all?
 *
 * Every case here distinguishes one refusal from another, and a blanket 401
 * satisfies none of them — so without this the suite reports seven independent
 * failures for a single cause, and each one reads like a defect in the resource
 * it was testing. Checked once, against the read-only snapshot endpoint, and the
 * cases then record BLOCKED rather than FAIL. A case that could not run has not
 * failed, and an evidence pack that says otherwise is lying about coverage.
 */
let reachability: { ok: boolean; detail: string } | null = null;

async function apiReachable(): Promise<{ ok: boolean; detail: string }> {
  if (reachability) return reachability;
  const res = await caf.snapshot();
  reachability =
    res.status === 200
      ? { ok: true, detail: 'GET /caf/snapshot answered 200 as sf.integration.' }
      : {
          ok: false,
          detail:
            `GET /caf/snapshot answered ${res.status} as sf.integration — "${caf.errorMessage(res)}". ` +
            'Every case in this file authenticates the same way, so none of them can reach the branch it tests.',
        };
  return reachability;
}

/** Record the blocked verdict and stop the case. Returns false when unreachable. */
async function requireApi(ev: CaseEvidence): Promise<boolean> {
  const state = await apiReachable();
  if (state.ok) return true;
  ev.observe(state.detail);
  ev.blocked(
    `${state.detail} Diagnose the credential before reading anything into this run — a 401 is indistinguishable ` +
      'from a working refusal at the status-code level, and treating it as one would certify a check that never ran.'
  );
  test.skip(true, 'Inbound API unreachable as sf.integration');
  return false;
}

/**
 * A GlideRecord boolean reads back as '1'/'0' while the Table API's JSON says
 * 'true'/'false'. Accepting both mirrors `isTrue()` in the attest resource —
 * comparing against one form alone is the bug that once refused every
 * attestation on this instance (TC-INT-033's regression value).
 */
function isTrue(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function readTasks(query?: string): Record<string, string>[] {
  const rows = cnitGet(TABLES.tsk, { query, fields: TASK_FIELDS });
  // Deterministic pick across re-runs: cnit returns insertion order, so without
  // this a second run can select a different task and a comparison against the
  // first run's evidence reads as drift.
  return rows.sort((a, b) => (a.number || '').localeCompare(b.number || ''));
}

function readTask(sysId: string): Record<string, string> | null {
  // `cnit get -SysId` is ignored and returns the whole table; -Query is the
  // working route (HANDOFF section 8).
  const rows = readTasks(`sys_id=${sysId}`);
  return rows.length ? rows[0] : null;
}

function attachmentCount(sysId: string): number {
  return cnitGet(TABLES.attachment, {
    query: `table_name=${TABLES.tsk}^table_sys_id=${sysId}`,
    fields: ['file_name', 'sys_id'],
  }).length;
}

/** Every field that moved between two reads of the same task. Empty is the pass. */
function moved(before: Record<string, string>, after: Record<string, string>): string[] {
  return TASK_FIELDS.filter((f) => (before[f] ?? '') !== (after[f] ?? '')).map(
    (f) => `${f}: "${before[f] ?? ''}" -> "${after[f] ?? ''}"`
  );
}

/**
 * Record both reads in the evidence and return what changed.
 *
 * The pack's rule is two proofs per case; for a refusal the second proof is the
 * record standing still, so it is captured even when the HTTP status alone would
 * settle the verdict.
 */
function proveUnmoved(
  ev: CaseEvidence,
  label: string,
  before: Record<string, string>,
  after: Record<string, string>
): string[] {
  const q = `sys_id=${before.sys_id}`;
  ev.record(`${label} — before`, TABLES.tsk, cnitCommand(TABLES.tsk, { query: q, fields: TASK_FIELDS }), [before]);
  ev.record(`${label} — after`, TABLES.tsk, cnitCommand(TABLES.tsk, { query: q, fields: TASK_FIELDS }), [after]);
  const diff = moved(before, after);
  ev.actual(
    diff.length === 0
      ? `${before.number}: every compared field unmoved, sys_mod_count still ${after.sys_mod_count}.`
      : `${before.number}: ${diff.length} field(s) moved — ${diff.join('; ')}`
  );
  return diff;
}

// ===========================================================================
// Suite 2 — Inbound update: PATCH /caf/task/{sysId}
// ===========================================================================

test('TC-INT-013 — A non-allow-listed field fails the whole call', async () => {
  const ev = new CaseEvidence('TC-INT-013', 'A non-allow-listed field fails the whole call');
  ev.expect('HTTP 400, body naming the refused field: "Fields not writable from Salesforce: <field>".');
  ev.expect('The allow-listed field in the same body is not applied either — the call is refused whole.');
  ev.expect('Re-reading the task shows nothing changed and sys_updated_on unmoved.');
  ev.expect('Each of number, active, business_application, actual_start_date, caf_request and sys_id is refused.');
  if (!(await requireApi(ev))) return;

  ev.step('Select an Open, active task, so that a leaked `state` write would be visible rather than a no-op.');
  const candidates = readTasks('active=true^state=1');
  if (candidates.length === 0) {
    ev.blocked('No Open active task on the instance; a leaked state write would be indistinguishable from a no-op.');
    test.skip(true, 'No Open active task available');
    return;
  }
  const target = candidates[0];
  ev.observe(`Target ${target.number} (${target.sys_id}), state=${target.state}, active=${target.active}.`);

  // The canary runs first and carries `comments` rather than `state`. If
  // whole-call refusal is broken, this discovers it by leaving a stray comment
  // instead of by starting a task and moving its parent request. Only once the
  // refusal is proven harmless does the case send the documented `state` body.
  ev.step('Canary: PATCH with a benign allow-listed field plus a non-writable one.');
  let before = readTask(target.sys_id)!;
  const canary = await caf.patchTask(target.sys_id, { comments: CANARY, number: 'HACKED' });
  let after = readTask(target.sys_id)!;
  ev.actual(`Canary responded HTTP ${canary.status} in ${canary.ms}ms: ${canary.text.slice(0, 200)}`);
  const canaryDiff = proveUnmoved(ev, 'Canary', before, after);

  if (canary.status !== 400 || canaryDiff.length > 0) {
    ev.fail(
      `Whole-call refusal is not holding: HTTP ${canary.status}, ${canaryDiff.length} field(s) moved. ` +
        'The documented state-bearing sub-cases were not sent, because they would write.'
    );
    expect(canary.status, canary.text).toBe(400);
    expect(canaryDiff, canaryDiff.join('\n')).toEqual([]);
    return;
  }
  ev.observe('Canary refused cleanly, so the state-bearing sub-cases below cannot write either.');

  ev.step('Send the documented body and each sub-case, every one pairing state=2 with a refused field.');
  const subCases: { field: string; body: Record<string, string> }[] = [
    { field: 'number', body: { state: '2', number: 'HACKED' } },
    { field: 'active', body: { state: '2', active: 'false' } },
    { field: 'business_application', body: { state: '2', business_application: ABSENT_SYS_ID } },
    { field: 'actual_start_date', body: { state: '2', actual_start_date: '2020-01-01 00:00:00' } },
    { field: 'caf_request', body: { state: '2', caf_request: ABSENT_SYS_ID } },
    { field: 'sys_id', body: { state: '2', sys_id: ABSENT_SYS_ID } },
  ];

  const findings: string[] = [];
  for (const sub of subCases) {
    before = readTask(target.sys_id)!;
    const res = await caf.patchTask(target.sys_id, sub.body);
    after = readTask(target.sys_id)!;

    ev.actual(`${sub.field}: HTTP ${res.status} — ${res.text.slice(0, 200)}`);
    const diff = proveUnmoved(ev, `Sub-case ${sub.field}`, before, after);

    if (res.status !== 400) findings.push(`${sub.field}: expected 400, got ${res.status}`);
    const message = caf.errorMessage(res);
    if (!message.includes(sub.field)) {
      findings.push(`${sub.field}: the error does not name the refused field — "${message}"`);
    }
    if (!message.includes('Fields not writable from Salesforce')) {
      findings.push(`${sub.field}: unexpected error wording — "${message}"`);
    }
    if (diff.length) findings.push(`${sub.field}: the task changed — ${diff.join('; ')}`);
  }

  ev.step('Confirm the canary comment reached no task anywhere on the instance.');
  const leaked = readTasks(`comments=${CANARY}`);
  if (leaked.length) findings.push(`Canary comment stored on ${leaked.map((t) => t.number).join(', ')}`);

  findings.forEach((f) => ev.observe(f));
  if (findings.length === 0) {
    ev.pass('All six non-writable fields refused with 400, the allow-listed field in each body unapplied, task unmoved.');
  } else {
    ev.fail(findings.join(' | '));
  }
  expect(findings, findings.join('\n')).toEqual([]);
});

test('TC-INT-014 — Unknown sys_id returns 404', async () => {
  const ev = new CaseEvidence('TC-INT-014', 'Unknown sys_id returns 404');
  ev.expect(`HTTP 404, body "CAF Task not found: ${ABSENT_SYS_ID}".`);
  ev.expect('The 404 is decided before the allow-list, so a body of writable fields still writes nothing.');
  if (!(await requireApi(ev))) return;

  ev.step('Confirm the sys_id matches no CAF Task, so the case cannot accidentally address a real record.');
  const existing = readTasks(`sys_id=${ABSENT_SYS_ID}`);
  ev.record('Task lookup', TABLES.tsk, cnitCommand(TABLES.tsk, { query: `sys_id=${ABSENT_SYS_ID}` }), existing);
  expect(existing, 'The fixture sys_id must not exist').toHaveLength(0);

  ev.step('PATCH the unknown sys_id with an otherwise entirely valid, allow-listed body.');
  const res = await caf.patchTask(ABSENT_SYS_ID, { state: '2', comments: CANARY });
  ev.actual(`HTTP ${res.status} in ${res.ms}ms — ${res.text.slice(0, 200)}`);

  const message = caf.errorMessage(res);
  const findings: string[] = [];
  if (res.status !== 404) findings.push(`Expected 404, got ${res.status}`);
  if (!message.includes(`CAF Task not found: ${ABSENT_SYS_ID}`)) {
    findings.push(`Unexpected message — "${message}"`);
  }

  ev.step('Confirm no task anywhere picked up the body.');
  const leaked = readTasks(`comments=${CANARY}`);
  if (leaked.length) findings.push(`Body applied to ${leaked.map((t) => t.number).join(', ')}`);
  ev.actual(leaked.length === 0 ? 'No task on the instance holds the canary comment.' : 'Canary comment found.');

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass('404 with the sys_id named in the message; the valid body wrote nowhere.')
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

test('TC-INT-015 — Empty body returns 400', async () => {
  const ev = new CaseEvidence('TC-INT-015', 'Empty body returns 400');
  ev.expect('HTTP 400, body "Empty request body".');
  ev.expect('Decided before the record is loaded, so the task is untouched.');
  if (!(await requireApi(ev))) return;

  ev.step('Select any task to address, and read it.');
  const candidates = readTasks();
  expect(candidates.length, 'The instance holds no CAF Tasks').toBeGreaterThan(0);
  const target = candidates[0];
  const before = readTask(target.sys_id)!;

  // Genuinely no body, not `{}`. The resource tests `request.body ?
  // request.body.data : null`, and `{}` is truthy — it passes that check, loads
  // the record, applies nothing, and still reaches gr.update() and the two
  // reconcile upserts. That is a no-op write rather than a refusal, so sending
  // it here would exercise the wrong branch and cost two Salesforce API calls.
  ev.step('PATCH with no request body at all.');
  const res = await caf.patchTask(target.sys_id, undefined);
  const after = readTask(target.sys_id)!;
  ev.actual(`HTTP ${res.status} in ${res.ms}ms — ${res.text.slice(0, 200)}`);
  ev.observe(
    'Sent with no body rather than {}. An empty object is truthy, so it passes the resource\'s emptiness ' +
      'check, reaches gr.update() and fires the two reconcile upserts — a no-op write, not a refusal. ' +
      'Worth stating in the report: "empty body" and "empty JSON object" are different requests here.'
  );

  const diff = proveUnmoved(ev, 'TC-INT-015', before, after);
  const message = caf.errorMessage(res);
  const findings: string[] = [];
  if (res.status !== 400) findings.push(`Expected 400, got ${res.status}`);
  if (!message.includes('Empty request body')) findings.push(`Unexpected message — "${message}"`);
  if (diff.length) findings.push(`Task changed — ${diff.join('; ')}`);

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass('400 "Empty request body"; the addressed task is unmoved.')
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

// ===========================================================================
// Suite 4 — Attestation: POST /caf/task/{sysId}/attest
// ===========================================================================

test('TC-INT-029 — The evidence gate refuses an attestation with nothing behind it', async () => {
  const ev = new CaseEvidence('TC-INT-029', 'The evidence gate (refusal half)');
  ev.expect('HTTP 428, "Attach at least one evidence file to <number> before attesting."');
  ev.expect('Nothing written: approval still requested, state still In Progress, task still active.');
  if (!(await requireApi(ev))) return;

  // The gate is the *last* check in the resource, so the fixture has to clear
  // every earlier one: active, In Progress, and not already carrying the outcome
  // being sent. A task failing any of those returns a different 409 and the gate
  // is never reached — which would pass a weaker assertion for the wrong reason.
  ev.step('Find an active, In Progress task that holds no sys_attachment.');
  const inProgress = readTasks('active=true^state=2').filter((t) => isTrue(t.active));
  const withoutEvidence = inProgress.filter((t) => attachmentCount(t.sys_id) === 0);
  ev.record(
    'Active In Progress tasks',
    TABLES.tsk,
    cnitCommand(TABLES.tsk, { query: 'active=true^state=2', fields: TASK_FIELDS }),
    inProgress
  );
  ev.observe(
    `${inProgress.length} active In Progress task(s); ${withoutEvidence.length} of them hold no ServiceNow attachment.`
  );

  if (withoutEvidence.length === 0) {
    ev.blocked(
      'No evidence-free In Progress task exists. Creating one means starting a task and its parent request — ' +
        'a write, and the thing this case exists not to do. HANDOFF section 6 records CAFT0001001 as the ' +
        'intended starting point; it is Open, so it must be started before this gate is reachable.'
    );
    test.skip(true, 'No evidence-free In Progress task available');
    return;
  }

  const target = withoutEvidence[0];
  const outcome = target.approval === 'approved' ? 'rejected' : 'approved';
  ev.observe(
    `Target ${target.number} (${target.sys_id}), approval=${target.approval || 'empty'}. ` +
      `Attesting "${outcome}" so the already-that-outcome check, which runs before the gate, cannot intercept.`
  );

  ev.step('Attest it with a fully valid body. The only thing missing is the evidence.');
  const before = readTask(target.sys_id)!;
  const res = await caf.attest(target.sys_id, { outcome, met_criteria: 'yes', comments: CANARY });
  const after = readTask(target.sys_id)!;
  ev.actual(`HTTP ${res.status} in ${res.ms}ms — ${res.text.slice(0, 200)}`);

  const diff = proveUnmoved(ev, 'TC-INT-029', before, after);
  const message = caf.errorMessage(res);
  const findings: string[] = [];
  if (res.status !== 428) findings.push(`Expected 428, got ${res.status}`);
  if (!message.includes('Attach at least one evidence file')) findings.push(`Unexpected message — "${message}"`);
  if (!message.includes(target.number)) findings.push(`The message does not name the task — "${message}"`);
  if (diff.length) findings.push(`Task changed — ${diff.join('; ')}`);
  if (after.approval === outcome) findings.push(`approval was set to ${outcome} despite the refusal`);

  ev.observe(
    'Corollary worth recording in the report, not testable here: the same task closes successfully through ' +
      'the /caf portal, because CAF - attachment mandatory for def tasks is deliberately inactive. The gate ' +
      'binds callers of this endpoint and nobody else.'
  );

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass(`428 naming ${target.number}; approval still "${after.approval}", state still ${after.state}.`)
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

test('TC-INT-032 — Attesting a task that is not In Progress', async () => {
  const ev = new CaseEvidence('TC-INT-032', 'Attesting a task that is not In Progress');
  ev.expect('HTTP 409, "<number> must be In Progress before it can be attested. Start the task first."');
  ev.expect('Nothing written.');
  if (!(await requireApi(ev))) return;

  // Active, but not state 2. The active check runs first, so a closed task would
  // answer with the inactive message and TC-INT-033's branch would be tested
  // twice while this one went unexercised.
  ev.step('Find an active task that is not In Progress.');
  const candidates = readTasks('active=true^state!=2').filter((t) => isTrue(t.active) && t.state !== '2');
  ev.record(
    'Active tasks not In Progress',
    TABLES.tsk,
    cnitCommand(TABLES.tsk, { query: 'active=true^state!=2', fields: TASK_FIELDS }),
    candidates
  );

  if (candidates.length === 0) {
    ev.blocked('Every active task is already In Progress; this branch is unreachable without a write.');
    test.skip(true, 'No active non-In-Progress task available');
    return;
  }

  const target = candidates[0];
  ev.observe(`Target ${target.number} (${target.sys_id}), state=${target.state}, active=${target.active}.`);

  ev.step('Attest it.');
  const before = readTask(target.sys_id)!;
  const res = await caf.attest(target.sys_id, { outcome: 'approved', met_criteria: 'yes' });
  const after = readTask(target.sys_id)!;
  ev.actual(`HTTP ${res.status} in ${res.ms}ms — ${res.text.slice(0, 200)}`);

  const diff = proveUnmoved(ev, 'TC-INT-032', before, after);
  const message = caf.errorMessage(res);
  const findings: string[] = [];
  if (res.status !== 409) findings.push(`Expected 409, got ${res.status}`);
  if (!message.includes('must be In Progress before it can be attested')) {
    findings.push(`Unexpected message — "${message}"`);
  }
  if (!message.includes(target.number)) findings.push(`The message does not name the task — "${message}"`);
  if (diff.length) findings.push(`Task changed — ${diff.join('; ')}`);

  ev.observe(
    'The check lives in the endpoint rather than in CAF - Task - prevent state change, which evaluates ' +
      'before the approval rule sets state=3 and so would not catch this route.'
  );

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass(`409 naming ${target.number}; state still ${after.state}, approval still "${after.approval}".`)
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

