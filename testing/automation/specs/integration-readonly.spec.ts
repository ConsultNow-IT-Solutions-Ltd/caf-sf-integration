import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { CaseEvidence, flushCurrentCase, describeRun } from '../lib/evidence';
import { cnitGet, cnitCommand, property, TABLES } from '../lib/cnit';
import * as sf from '../lib/salesforce';
import * as caf from '../lib/cafapi';
import { SN_INSTANCE } from '../playwright.config';

/**
 * TEST-CASES-INTEGRATION.md — the cases that read.
 *
 * Every case here observes the live integration without changing either side.
 * That boundary is the organising principle of the file, not an accident of how
 * far the work got: the remaining cases fall into three groups that each need a
 * decision the harness cannot make on its own —
 *
 *   - negative-path API calls, which are refused by design and so write nothing,
 *     but still carry write intent over the wire;
 *   - reversible writes, which need the user's confirmation per CLAUDE.md;
 *   - ONE-SHOT cases, which consume records that cannot be reset, and UI-only
 *     cases, which need a Lightning login this harness does not yet have.
 *
 * Keeping them out of this file means this file can be re-run at any time, on
 * any day, without consuming anything — including the DE API budget in any
 * meaningful quantity.
 */

const RESULTS = path.join(__dirname, '..', 'results');
const REPO = path.join(__dirname, '..', '..', '..');

// Not serial: these cases only read, so none of them can leave state that
// affects the next one, and a serial group would skip nine cases because one
// assertion failed. The suite-wide config already pins a single worker, so the
// order stays deterministic without the coupling.

describeRun({
  instance: `${SN_INSTANCE} + Salesforce orgfarm-4938c7f768-dev-ed`,
  executedBy: 'admin (ServiceNow) / admin.070b86ccf531@agentforce.com (Salesforce)',
  executedVia:
    'Playwright runner, no browser: ServiceNow read over cnit and the Scripted REST API as sf.integration, ' +
    'Salesforce read over the sf CLI and anonymous Apex against the deployed classes. Every case reads both sides.',
});

test.afterEach(({}, testInfo) => {
  flushCurrentCase(RESULTS, testInfo.status, testInfo.error?.message);
});

test.afterAll(async () => {
  await caf.disposeCafApi();
});

/** Set difference, reported as a sorted list so the evidence names the records. */
function only(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

// ===========================================================================
// Suite 1 — Outbound push
// ===========================================================================

test('TC-INT-001 — Full mirror parity by record, not by count', async () => {
  const ev = new CaseEvidence(
    'TC-INT-001',
    'Full mirror parity by record, not by count'
  );
  ev.expect('Requests and tasks are set-for-set identical across both platforms, compared by number.');
  ev.expect('The same holds compared by sys_id / ServiceNow_Sys_Id__c.');
  ev.expect('The symmetric difference is empty in both directions, for both object types.');

  ev.step('Read every CAF Request and CAF Task from ServiceNow.');
  const snReq = cnitGet(TABLES.req, { fields: ['number', 'sys_id'] });
  const snTsk = cnitGet(TABLES.tsk, { fields: ['number', 'sys_id'] });
  ev.record('ServiceNow requests', TABLES.req, cnitCommand(TABLES.req, { fields: ['number', 'sys_id'] }), snReq);
  ev.record('ServiceNow tasks', TABLES.tsk, cnitCommand(TABLES.tsk, { fields: ['number', 'sys_id'] }), snTsk);

  ev.step('Read every mirrored record from Salesforce.');
  const reqSoql = 'SELECT SN_Number__c, ServiceNow_Sys_Id__c FROM CAF_Request__c ORDER BY SN_Number__c';
  const tskSoql = 'SELECT SN_Number__c, ServiceNow_Sys_Id__c FROM CAF_Task__c ORDER BY SN_Number__c';
  const sfReq = sf.soql(reqSoql);
  const sfTsk = sf.soql(tskSoql);
  ev.record('Salesforce requests', sf.OBJECTS.req, sf.soqlCommand(reqSoql), sfReq as Record<string, string>[]);
  ev.record('Salesforce tasks', sf.OBJECTS.tsk, sf.soqlCommand(tskSoql), sfTsk as Record<string, string>[]);

  ev.step('Compare as sets of numbers, then separately as sets of sys_id.');
  const sets = (
    snRows: Record<string, string>[],
    sfRows: Record<string, any>[]
  ) => ({
    snNums: new Set(snRows.map((r) => r.number)),
    sfNums: new Set(sfRows.map((r) => r.SN_Number__c)),
    snIds: new Set(snRows.map((r) => r.sys_id)),
    sfIds: new Set(sfRows.map((r) => r.ServiceNow_Sys_Id__c)),
  });

  const R = sets(snReq, sfReq);
  const T = sets(snTsk, sfTsk);

  const findings: string[] = [];
  for (const [label, s] of [['Request', R], ['Task', T]] as const) {
    const numOnlySn = only(s.snNums, s.sfNums);
    const numOnlySf = only(s.sfNums, s.snNums);
    const idOnlySn = only(s.snIds, s.sfIds);
    const idOnlySf = only(s.sfIds, s.snIds);
    ev.actual(
      `${label}s — ServiceNow ${s.snNums.size}, Salesforce ${s.sfNums.size}. ` +
        `By number: ${numOnlySn.length} ServiceNow-only, ${numOnlySf.length} Salesforce-only. ` +
        `By sys_id: ${idOnlySn.length} ServiceNow-only, ${idOnlySf.length} Salesforce-only.`
    );
    if (numOnlySn.length) findings.push(`${label}s in ServiceNow only (by number): ${numOnlySn.join(', ')}`);
    if (numOnlySf.length) findings.push(`${label}s in Salesforce only (by number): ${numOnlySf.join(', ')}`);
    if (idOnlySn.length) findings.push(`${label}s in ServiceNow only (by sys_id): ${idOnlySn.join(', ')}`);
    if (idOnlySf.length) findings.push(`${label}s in Salesforce only (by sys_id): ${idOnlySf.join(', ')}`);
  }

  findings.forEach((f) => ev.observe(f));
  ev.observe(
    `Baseline for this run: ${snReq.length} requests and ${snTsk.length} tasks in ServiceNow. ` +
      'TEST-CASES-INTEGRATION.md records 19 and 30; HANDOFF section 3 records 19 and 28.'
  );

  if (findings.length === 0) {
    ev.pass('Symmetric difference empty in both directions, by number and by sys_id, for requests and tasks.');
  } else {
    ev.fail(`Parity broken: ${findings.join(' | ')}`);
  }
  expect(findings, findings.join('\n')).toEqual([]);
});

test('TC-INT-006 — No Salesforce Id is ever stored in ServiceNow', async () => {
  const ev = new CaseEvidence('TC-INT-006', 'No Salesforce Id is ever stored in ServiceNow');
  ev.expect('No field on caf_req or caf_tsk holds a Salesforce Id.');
  ev.expect('Correlation is one-directional, which is what makes a Salesforce org rebuild survivable.');

  ev.step('List every dictionary entry on the two mirrored tables.');
  const q = `nameIN${TABLES.req},${TABLES.tsk}^elementISNOTEMPTY`;
  const dict = cnitGet(TABLES.dictionary, {
    query: q,
    fields: ['name', 'element', 'column_label', 'internal_type'],
  });
  ev.record('Dictionary entries on the mirrored tables', TABLES.dictionary, cnitCommand(TABLES.dictionary, { query: q }), dict);

  ev.step('Look for anything that could hold a Salesforce identifier.');
  // Names and labels first, then the shape of the stored values — a field could
  // be innocently named and still be carrying an 18-character Salesforce Id.
  const suspectNames = dict.filter((d) =>
    /salesforce|sfdc|\bsf_|sf_id|external_id|crm/i.test(`${d.element} ${d.column_label}`)
  );
  ev.actual(`${dict.length} field(s) examined; ${suspectNames.length} with a Salesforce-suggestive name or label.`);

  ev.step('Scan the stored values of every string field for Salesforce Id shapes.');
  const sample = [
    ...cnitGet(TABLES.req, { limit: 200 }),
    ...cnitGet(TABLES.tsk, { limit: 200 }),
  ];
  // A Salesforce Id is 15 or 18 characters, starts with a 3-character key
  // prefix and is not a ServiceNow 32-hex sys_id.
  const idLike = new Set<string>();
  for (const row of sample) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== 'string') continue;
      if (/^[a-zA-Z0-9]{18}$/.test(v) && !/^[0-9a-f]{32}$/.test(v)) idLike.add(`${k}=${v}`);
    }
  }
  ev.actual(
    idLike.size === 0
      ? 'No value on any sampled record has the shape of a Salesforce Id.'
      : `Values with Salesforce Id shape: ${[...idLike].slice(0, 10).join(', ')}`
  );

  const clean = suspectNames.length === 0 && idLike.size === 0;
  if (clean) {
    ev.pass('Correlation is one-directional: ServiceNow stores no Salesforce identifier of any kind.');
  } else {
    ev.fail(
      `Possible Salesforce identifier in ServiceNow — fields: ${suspectNames
        .map((s) => s.element)
        .join(', ')}; values: ${[...idLike].slice(0, 5).join(', ')}`
    );
  }
  expect(suspectNames.map((s) => s.element)).toEqual([]);
  expect([...idLike]).toEqual([]);
});

test('TC-INT-008 — Blank and null are treated as equal', async () => {
  const ev = new CaseEvidence('TC-INT-008', 'Blank and null are treated as equal');
  ev.expect('Records with an empty mirrored field on one or both sides raise zero differences.');
  ev.expect('This is the single most likely source of false-positive drift.');

  ev.step('Count records that currently have an empty mirrored optional field on at least one side.');
  const snTsk = cnitGet(TABLES.tsk, { fields: ['number', 'approval', 'met_criteria'] });
  const sfTsk = sf.soql(
    'SELECT SN_Number__c, Approval__c, Met_Criteria__c FROM CAF_Task__c ORDER BY SN_Number__c'
  );
  const sfByNum = new Map(sfTsk.map((r) => [r.SN_Number__c, r]));

  const blankPairs = snTsk.filter((t) => {
    const m = sfByNum.get(t.number);
    if (!m) return false;
    const emptySn = !t.approval || !t.met_criteria;
    const emptySf = !m.Approval__c || !m.Met_Criteria__c;
    return emptySn || emptySf;
  });
  ev.record(
    'Tasks with an empty mirrored optional field',
    TABLES.tsk,
    cnitCommand(TABLES.tsk, { fields: ['number', 'approval', 'met_criteria'] }),
    blankPairs.slice(0, 40)
  );
  ev.actual(`${blankPairs.length} of ${snTsk.length} task(s) have at least one empty mirrored optional field.`);

  ev.step('Run the real comparison — CafSyncHealth.check() — and see whether any of them is reported.');
  const run = sf.runApex(`
Map<String,Object> out = new Map<String,Object>();
CafSyncHealth.Report r = CafSyncHealth.check();
List<String> diffs = new List<String>();
for (CafSyncHealth.Difference d : r.differences) {
    diffs.add(d.recordType + ' ' + d.recordNumber + ' | ' + d.kind + ' | SN=' + d.servicenow + ' | SF=' + d.salesforce);
}
out.put('compared', r.comparedCount);
out.put('inSync', r.inSync);
out.put('differences', diffs);
System.debug('${sf.APEX_MARK}' + JSON.serialize(out));
`);
  expect(run.success, `Anonymous Apex failed:\n${run.logs.slice(-2000)}`).toBeTruthy();
  const report = JSON.parse(run.emitted[run.emitted.length - 1]);
  ev.record('CafSyncHealth.check() result', 'CafSyncHealth', 'sf apex run — CafSyncHealth.check()', [
    { compared: String(report.compared), inSync: String(report.inSync), differences: String(report.differences.length) },
  ]);

  const blankDiffs: string[] = (report.differences as string[]).filter((d) => /\(empty\)/.test(d));
  ev.actual(
    blankDiffs.length === 0
      ? `Zero differences attributable to an empty value, across ${blankPairs.length} record(s) that hold one.`
      : `Differences naming "(empty)": ${blankDiffs.join(' | ')}`
  );
  ev.observe(
    'CafSyncHealth.compareField() returns early when both values are blank, so null and empty string are ' +
      'the same value to the comparison. This case confirms the code path on live data rather than by reading it.'
  );

  if (blankDiffs.length === 0) ev.pass('No false-positive drift from blank-versus-null.');
  else ev.fail(`Blank/null reported as drift: ${blankDiffs.join(' | ')}`);
  expect(blankDiffs).toEqual([]);
});

// ===========================================================================
// Suite 2 — Inbound update
// ===========================================================================

test('TC-INT-017 — The inbound user is sf.integration and only sf.integration', async () => {
  const ev = new CaseEvidence(
    'TC-INT-017',
    'The inbound user is sf.integration and only sf.integration'
  );
  ev.expect('Every inbound write shows sys_updated_by = sf.integration.');
  ev.expect('The echo-loop guard keys off this user; any other account silently disables it.');

  ev.step('List the tasks most recently written by sf.integration.');
  const q = 'sys_updated_by=sf.integration^ORDERBYDESCsys_updated_on';
  const rows = cnitGet(TABLES.tsk, {
    query: q,
    fields: ['number', 'sys_updated_by', 'sys_updated_on', 'state', 'approval'],
    limit: 5,
  });
  ev.record('Tasks last written by sf.integration', TABLES.tsk, cnitCommand(TABLES.tsk, { query: q, limit: 5 }), rows);

  ev.step('Confirm the account exists, is active, and holds the integration role rather than admin.');
  const user = cnitGet('sys_user', {
    query: 'user_name=sf.integration',
    fields: ['user_name', 'active', 'locked_out', 'web_service_access_only', 'sys_id'],
  });
  ev.record('The integration account', 'sys_user', cnitCommand('sys_user', { query: 'user_name=sf.integration' }), user);

  ev.step('Confirm the outbound push rules skip writes made by that user.');
  const brSource = fs.readFileSync(
    path.join(REPO, 'servicenow', 'CAF - Push Request to Salesforce.business-rule.js'),
    'utf8'
  );
  const guards = brSource.includes('sf.integration');
  ev.actual(`${rows.length} task(s) carry sys_updated_by = sf.integration; all distinct values: ${[...new Set(rows.map((r) => r.sys_updated_by))].join(', ')}`);
  ev.actual(
    user.length
      ? `Account present: active=${user[0].active}, locked_out=${user[0].locked_out}, web_service_access_only=${user[0].web_service_access_only}`
      : 'Account not found.'
  );
  ev.actual(`Push business rule references sf.integration in its echo guard: ${guards}`);

  const ok = rows.length > 0 && rows.every((r) => r.sys_updated_by === 'sf.integration') && guards;
  if (ok) ev.pass('Inbound writes are attributed to sf.integration and the guard keys off exactly that name.');
  else ev.fail('No inbound writes found, or the guard does not reference sf.integration.');
  expect(ok).toBeTruthy();
});

// ===========================================================================
// Suite 3 — Evidence
// ===========================================================================

test('TC-INT-023 — Evidence list on an unknown task returns 404', async () => {
  const ev = new CaseEvidence('TC-INT-023', 'Evidence list on an unknown task returns 404');
  ev.expect('HTTP 404 from GET /caf/task/{sysId}/evidence for a sys_id that does not exist.');

  const fake = '00000000000000000000000000000000';
  ev.step(`GET /api/x_gskn2_caf_compli/caf/task/${fake}/evidence as sf.integration.`);
  const res = await caf.listEvidence(fake);
  ev.record('Response', 'GET /caf/task/{sysId}/evidence', `sysId=${fake}`, [
    { status: String(res.status), body: res.text.slice(0, 400) },
  ]);
  ev.actual(`HTTP ${res.status} — ${res.text.slice(0, 200)}`);
  ev.observe('Read-only endpoint; the call writes nothing on either platform.');

  if (res.status === 404) ev.pass('Unknown task refused with 404, as specified.');
  else ev.fail(`Expected HTTP 404, got HTTP ${res.status}.`);
  expect(res.status).toBe(404);
});

// ===========================================================================
// Suite 4 — Attestation
// ===========================================================================

test('TC-INT-037 — There is no named approver', async () => {
  const ev = new CaseEvidence('TC-INT-037', 'There is no named approver');
  ev.expect('sysapproval_approver holds no CAF records.');
  ev.expect('No approver identity is stored on the task beyond sys_updated_by.');

  ev.step('Read every approval record and resolve which belong to CAF tasks.');
  const approvers = cnitGet(TABLES.approver, {
    fields: ['sys_id', 'document_id', 'source_table', 'approver', 'state', 'sys_created_by', 'sys_created_on'],
  });
  const cafTaskIds = new Set(cnitGet(TABLES.tsk, { fields: ['sys_id', 'number'] }).map((t) => t.sys_id));
  const numberById = new Map(cnitGet(TABLES.tsk, { fields: ['sys_id', 'number'] }).map((t) => [t.sys_id, t.number]));
  const cafApprovals = approvers.filter(
    (a) => cafTaskIds.has(a.document_id) || /x_gskn2_caf_compli/.test(a.source_table || '')
  );
  ev.record('All approval records', TABLES.approver, cnitCommand(TABLES.approver), approvers);
  ev.record(
    'Approval records belonging to CAF tasks',
    TABLES.approver,
    'filtered client-side by document_id against caf_tsk.sys_id',
    cafApprovals.map((a) => ({ ...a, caf_task: numberById.get(a.document_id) ?? '(unresolved)' }))
  );

  ev.step('Check whether an approver identity is stored on the task itself.');
  const tasks = cnitGet(TABLES.tsk, { fields: ['number', 'approval', 'sys_updated_by'] });
  const approvedTasks = tasks.filter((t) => t.approval === 'approved' || t.approval === 'rejected');
  ev.record('Tasks with a recorded outcome', TABLES.tsk, cnitCommand(TABLES.tsk, { fields: ['number', 'approval', 'sys_updated_by'] }), approvedTasks);

  ev.actual(`${approvers.length} approval record(s) exist in total; ${cafApprovals.length} belong to CAF tasks.`);
  ev.actual(
    `${approvedTasks.length} task(s) carry an approved/rejected outcome; the only identity on them is ` +
      `sys_updated_by = ${[...new Set(approvedTasks.map((t) => t.sys_updated_by))].join(', ') || '(none)'}.`
  );
  ev.observe(
    'HANDOFF section 6 states sysapproval_approver holds no CAF records at all. TC-SN-059 found one, on ' +
      'CAFT0001002, created by the flow. This case re-reads that from the live instance.'
  );
  ev.observe(
    'The finding this case exists to make stands either way: whoever presses the button in Salesforce is the ' +
      'approver, and the audit trail records only sf.integration. For a compliance product that is the weakest ' +
      'point in the evidence chain — HANDOFF open item 2.'
  );

  if (cafApprovals.length === 0) {
    ev.pass('No approver record and no approver identity: the finding is confirmed exactly as written.');
  } else {
    ev.fail(
      `Expected zero CAF approval records; found ${cafApprovals.length} — ` +
        cafApprovals
          .map((a) => `${numberById.get(a.document_id) ?? a.document_id} (created by ${a.sys_created_by})`)
          .join(', ') +
        '. The absence of a named approver still holds: none of these names a human approver of an attestation.'
    );
  }
  expect(
    cafApprovals.map((a) => numberById.get(a.document_id) ?? a.document_id),
    'sysapproval_approver should hold no CAF records'
  ).toEqual([]);
});

// ===========================================================================
// Suite 5 — Sync Health and drift
// ===========================================================================

test('TC-INT-038 — Clean state reports zero differences', async () => {
  const ev = new CaseEvidence('TC-INT-038', 'Clean state reports zero differences');
  ev.expect('Zero differences reported.');
  ev.expect('The number compared equals requests + tasks.');

  ev.step('Run CafSyncHealth.check() — the deployed class the LWC calls, not a reimplementation of it.');
  const run = sf.runApex(`
CafSyncHealth.Report r = CafSyncHealth.check();
Map<String,Object> out = new Map<String,Object>();
List<String> diffs = new List<String>();
for (CafSyncHealth.Difference d : r.differences) {
    diffs.add(d.recordType + ' ' + d.recordNumber + ' | ' + d.kind + ' | SN=' + d.servicenow + ' | SF=' + d.salesforce);
}
out.put('inSync', r.inSync);
out.put('snRequests', r.snRequests);
out.put('snTasks', r.snTasks);
out.put('sfRequests', r.sfRequests);
out.put('sfTasks', r.sfTasks);
out.put('compared', r.comparedCount);
out.put('differences', diffs);
System.debug('${sf.APEX_MARK}' + JSON.serialize(out));
`);
  expect(run.success, `Anonymous Apex failed:\n${run.logs.slice(-2000)}`).toBeTruthy();
  const r = JSON.parse(run.emitted[run.emitted.length - 1]);

  ev.record('CafSyncHealth.check()', 'CafSyncHealth', 'sf apex run --file <CafSyncHealth.check()>', [
    {
      inSync: String(r.inSync),
      snRequests: String(r.snRequests),
      snTasks: String(r.snTasks),
      sfRequests: String(r.sfRequests),
      sfTasks: String(r.sfTasks),
      comparedCount: String(r.compared),
      differences: String(r.differences.length),
    },
  ]);
  if (r.differences.length) {
    ev.record(
      'Differences reported',
      'CafSyncHealth.Difference',
      'sf apex run',
      (r.differences as string[]).map((d: string) => ({ difference: d }))
    );
  }

  ev.actual(`inSync = ${r.inSync}; ${r.compared} record(s) compared; ${r.differences.length} difference(s).`);
  ev.actual(`ServiceNow ${r.snRequests} requests / ${r.snTasks} tasks; Salesforce ${r.sfRequests} / ${r.sfTasks}.`);
  ev.observe(
    `comparedCount is snRequests + snTasks = ${r.snRequests + r.snTasks}; the case's baseline figure of 49 was ` +
      'captured on 2026-08-07 and moves whenever the engine spawns a task.'
  );

  expect(r.compared).toBe(r.snRequests + r.snTasks);
  if (r.inSync) ev.pass(`Green: ${r.compared} records compared, zero differences.`);
  else ev.fail(`${r.differences.length} difference(s): ${(r.differences as string[]).join(' | ')}`);
  expect(r.differences).toEqual([]);
});

test('TC-INT-046 — Snapshot is read-only', async () => {
  const ev = new CaseEvidence('TC-INT-046', 'Snapshot is read-only');
  ev.expect('Returns number, status, state, description and sys_updated_on for every request and task.');
  ev.expect('No sys_updated_on anywhere in the scope moves as a result of a snapshot call.');

  ev.step('Record sys_updated_on for every request and task before the call.');
  const before = [
    ...cnitGet(TABLES.req, { fields: ['number', 'sys_updated_on'] }),
    ...cnitGet(TABLES.tsk, { fields: ['number', 'sys_updated_on'] }),
  ];
  const beforeMap = new Map(before.map((r) => [r.number, r.sys_updated_on]));

  ev.step('GET /api/x_gskn2_caf_compli/caf/snapshot.');
  const res = await caf.snapshot();
  expect(res.status, `Snapshot returned HTTP ${res.status}: ${res.text.slice(0, 300)}`).toBe(200);
  const requests = res.body?.requests ?? [];
  const tasks = res.body?.tasks ?? [];
  ev.record('Snapshot payload shape', 'GET /caf/snapshot', 'first request row', requests.slice(0, 1));
  ev.record('Snapshot payload shape', 'GET /caf/snapshot', 'first task row', tasks.slice(0, 1));

  ev.step('Re-read sys_updated_on for every record and compare.');
  const after = [
    ...cnitGet(TABLES.req, { fields: ['number', 'sys_updated_on'] }),
    ...cnitGet(TABLES.tsk, { fields: ['number', 'sys_updated_on'] }),
  ];
  const moved = after.filter((r) => beforeMap.get(r.number) !== r.sys_updated_on);
  ev.record('Records whose sys_updated_on moved across the snapshot call', 'caf_req + caf_tsk', 'before/after comparison', moved);

  const reqFields = Object.keys(requests[0] ?? {});
  const tskFields = Object.keys(tasks[0] ?? {});
  // The resource returns the last-updated stamp as `updated_on`, not
  // `sys_updated_on` — HANDOFF section 5 and the case text both name the
  // platform field rather than the payload key. Assert against what the
  // resource actually emits and record the discrepancy as documentation.
  const missingReq = ['number', 'caf_status', 'state', 'short_description', 'updated_on'].filter(
    (f) => !reqFields.includes(f)
  );
  const missingTsk = ['number', 'state', 'approval', 'met_criteria', 'short_description', 'updated_on'].filter(
    (f) => !tskFields.includes(f)
  );

  ev.actual(`HTTP ${res.status}; ${requests.length} request(s) and ${tasks.length} task(s) returned in ${res.ms} ms.`);
  ev.actual(`Request fields: ${reqFields.join(', ')}`);
  ev.actual(`Task fields: ${tskFields.join(', ')}`);
  ev.actual(`${moved.length} record(s) changed sys_updated_on across the call.`);
  ev.observe(
    'Naming discrepancy, documentation only: HANDOFF section 5 and this case both describe the payload as ' +
      'carrying sys_updated_on. The resource emits it as `updated_on`. Nothing consumes it today — CafSyncHealth ' +
      'compares status, state and description and never reads the stamp — so the mismatch is latent, and would ' +
      'surface as a silently-null timestamp in whatever reads it first.'
  );

  const ok = moved.length === 0 && missingReq.length === 0 && missingTsk.length === 0;
  if (ok) ev.pass('The snapshot returns the documented fields for every record and modifies nothing.');
  else ev.fail(`Missing request fields: ${missingReq.join(', ') || 'none'}; missing task fields: ${missingTsk.join(', ') || 'none'}; ${moved.length} record(s) moved.`);
  expect(moved).toEqual([]);
  expect(missingReq).toEqual([]);
  expect(missingTsk).toEqual([]);
});

test('TC-INT-047 — Drift detection is automatic, repair never is', async () => {
  const ev = new CaseEvidence('TC-INT-047', 'Drift detection is automatic, repair never is');
  ev.expect('No code path repairs without a human pressing Re-sync next to a named difference.');
  ev.expect('Sync Health has no schedule — a known limitation, HANDOFF open item 5.');

  ev.step('Confirm check() never calls resync().');
  const cls = fs.readFileSync(path.join(REPO, 'salesforce', 'force-app', 'classes', 'CafSyncHealth.cls'), 'utf8');
  const checkBody = cls.slice(cls.indexOf('public static Report check()'), cls.indexOf('public static String resync'));
  const checkCallsResync = /resync\s*\(/.test(checkBody);

  ev.step('Confirm the LWC only reaches resync from a user gesture.');
  const lwc = fs.readFileSync(path.join(REPO, 'salesforce', 'force-app', 'lwc', 'cafSyncHealth', 'cafSyncHealth.js'), 'utf8');
  const html = fs.readFileSync(path.join(REPO, 'salesforce', 'force-app', 'lwc', 'cafSyncHealth', 'cafSyncHealth.html'), 'utf8');
  const resyncHandlers = (lwc.match(/^\s*(?:async\s+)?(handle\w*[Rr]esync\w*)\s*\(/gm) ?? []).map((s) => s.trim());
  const boundToClick = /onclick=\{handle\w*[Rr]esync\w*\}/.test(html);

  ev.step('Confirm nothing in the org runs Sync Health on a schedule.');
  const cronSoql =
    "SELECT CronJobDetail.Name, CronJobDetail.JobType, CronExpression, State FROM CronTrigger WHERE State != 'DELETED'";
  const crons = sf.soql(cronSoql).map((c) => ({
    name: c.CronJobDetail?.Name ?? '(unnamed)',
    jobType: c.CronJobDetail?.JobType ?? '',
    cronExpression: c.CronExpression,
    state: c.State,
  }));
  ev.record('Scheduled jobs in the Salesforce org', 'CronTrigger', sf.soqlCommand(cronSoql), crons);
  // The org carries three Developer Edition platform jobs of its own. What
  // matters is not that the schedule table is empty but that nothing in it runs
  // CAF code — an org-furniture job is not a Sync Health schedule.
  const cafScheduled = crons.filter((c) => /caf|sync|resync/i.test(c.name));

  ev.actual(`CafSyncHealth.check() calls resync(): ${checkCallsResync}`);
  ev.actual(`Re-sync handlers in the LWC: ${resyncHandlers.join(', ') || 'none'}; bound to onclick in the template: ${boundToClick}`);
  ev.actual(
    `${crons.length} scheduled job(s) in the org — ${crons.map((c) => c.name).join('; ')}. ` +
      `${cafScheduled.length} of them relate to CAF or to sync.`
  );
  ev.observe(
    'The three scheduled jobs are Developer Edition org furniture (Program Milestone Computation, Program Status ' +
      'Update, Metalytics Data Loader). None is CAF code and none touches the integration.'
  );
  ev.observe(
    'Sync Health runs when someone opens the dashboard or presses Re-check. There is no nightly comparison and ' +
      'nothing emails or posts on drift — report as a known limitation, not a defect. HANDOFF open item 5.'
  );

  const ok = !checkCallsResync && boundToClick && cafScheduled.length === 0;
  if (ok) {
    ev.pass(
      'Repair is reachable only from a button next to a named difference, and nothing schedules it. Detection is ' +
        'equally unscheduled — the known limitation this case also records.'
    );
  } else {
    ev.fail(
      `check() calls resync: ${checkCallsResync}; resync bound to a click: ${boundToClick}; ` +
        `CAF-related scheduled jobs: ${cafScheduled.map((c) => c.name).join(', ') || 'none'}`
    );
  }
  expect(checkCallsResync).toBeFalsy();
  expect(boundToClick).toBeTruthy();
  expect(cafScheduled).toEqual([]);
});

// ===========================================================================
// Suite 6 — Salesforce dashboard
// ===========================================================================

test('TC-INT-044 — Only State__c is editable in the Salesforce mirror', async () => {
  const ev = new CaseEvidence('TC-INT-044', 'Only State__c is editable in the Salesforce mirror');
  ev.expect('Every mirrored field except State__c is Readonly on the CAF Task layout.');
  ev.expect('State__c is editable solely to make the drift demo possible.');

  ev.step('Read the CAF Task page layout and its per-field behavior.');
  const layoutPath = path.join(REPO, 'salesforce', 'force-app', 'layouts', 'CAF_Task__c-CAF Task Layout.layout');
  const layout = fs.readFileSync(layoutPath, 'utf8');
  const items = [...layout.matchAll(/<layoutItems>[\s\S]*?<\/layoutItems>/g)].map((m) => m[0]);
  const behaviours = items
    .map((i) => ({
      field: (i.match(/<field>(.*?)<\/field>/) ?? [])[1] ?? '(none)',
      behavior: (i.match(/<behavior>(.*?)<\/behavior>/) ?? [])[1] ?? '(none)',
    }))
    .filter((b) => b.field !== '(none)');
  ev.record('CAF Task layout — field behaviour', 'CAF_Task__c layout', layoutPath, behaviours);

  ev.step('Cross-check against what the org itself reports as updateable.');
  const desc = sf.describe(sf.OBJECTS.tsk);
  const custom = (desc.fields as any[])
    .filter((f) => f.custom)
    .map((f) => ({ name: f.name, updateable: String(f.updateable), type: f.type }));
  ev.record('CAF_Task__c custom fields, per describe', sf.OBJECTS.tsk, `sf sobject describe --sobject ${sf.OBJECTS.tsk}`, custom);

  ev.step('Establish which fields the sync actually mirrors — the set the case is about.');
  // Read the mirrored set from the sync script rather than assuming it, so this
  // assertion follows the payload if the payload changes. buildTaskPayload's
  // keys *are* the mirrored fields; Name is one of them, which is easy to miss
  // because it is a standard field.
  const sync = fs.readFileSync(path.join(REPO, 'servicenow', 'CAFSalesforceSync.script-include.js'), 'utf8');
  const taskPayload = sync.slice(sync.indexOf('buildTaskPayload'), sync.indexOf('_push:') >= 0 ? sync.indexOf('_push:') : sync.length);
  const mirrored = new Set(
    [...taskPayload.matchAll(/^\s{8,}(\w+):\s/gm)].map((m) => m[1]).filter((f) => f !== 'CAF_Request__r')
  );
  ev.record(
    'Fields CAFSalesforceSync.buildTaskPayload() writes',
    'CAFSalesforceSync',
    'servicenow/CAFSalesforceSync.script-include.js',
    [...mirrored].map((f) => ({ mirrored_field: f }))
  );

  const editableMirrored = behaviours.filter(
    (b) => (b.behavior === 'Edit' || b.behavior === 'Required') && mirrored.has(b.field)
  );
  const editableOther = behaviours.filter(
    (b) => (b.behavior === 'Edit' || b.behavior === 'Required') && !mirrored.has(b.field)
  );
  const onLayout = new Set(behaviours.map((b) => b.field));
  const absentFromLayout = custom.filter((f) => !onLayout.has(f.name)).map((f) => f.name);

  ev.actual(`Mirrored fields (from the push payload): ${[...mirrored].join(', ')}`);
  ev.actual(`Editable on the layout AND mirrored: ${editableMirrored.map((e) => `${e.field} (${e.behavior})`).join(', ') || 'none'}`);
  ev.actual(`Editable on the layout but not mirrored: ${editableOther.map((e) => e.field).join(', ') || 'none'}`);
  ev.actual(`Readonly on the layout: ${behaviours.filter((b) => b.behavior === 'Readonly').map((b) => b.field).join(', ') || 'none'}`);
  ev.actual(`Custom fields absent from the layout entirely: ${absentFromLayout.join(', ') || 'none'}`);
  ev.observe(
    'The layout trap: a field missing from the layout shows a lock icon and refuses inline edit even when FLS ' +
      'grants Edit and describe reports updateable=true. "Deliberately Readonly" and "accidentally absent" look ' +
      'identical to a user, which is why this case reads the layout rather than only the describe.'
  );

  const unexpected = editableMirrored.filter((e) => e.field !== 'State__c');
  if (unexpected.length === 0 && absentFromLayout.length === 0) {
    ev.pass('State__c is the only mirrored field editable on the layout, and no custom field is silently absent from it.');
  } else if (unexpected.length === 0) {
    ev.fail(
      `State__c is correctly the only editable mirrored field, but ${absentFromLayout.length} custom field(s) are ` +
        `absent from the layout and will read as locked for the wrong reason: ${absentFromLayout.join(', ')}`
    );
  } else {
    ev.observe(
      `Finding: ${unexpected
        .map((u) => u.field)
        .join(', ')} is written on every push by CAFSalesforceSync — buildTaskPayload sets Name to the ServiceNow ` +
        'number — and is editable on the layout, so a user can change it in Salesforce. CafSyncHealth compares ' +
        'Status, State, Approval, Criteria met and Description, and never compares Name, so drift introduced this ' +
        'way is invisible to the Sync Health strip until the next push happens to overwrite it. Either make it ' +
        'Readonly or add it to the comparison.'
    );
    ev.fail(
      `Expected State__c alone to be editable among mirrored fields; the layout also allows editing ` +
        `${unexpected.map((u) => `${u.field} (${u.behavior})`).join(', ')}.`
    );
  }
  expect(unexpected.map((u) => u.field)).toEqual([]);
});

test('TC-INT-049 — Columns are derived from data, not hard-coded (Part A: the two column sources)', async () => {
  const ev = new CaseEvidence(
    'TC-INT-049',
    'Columns are derived from data, not hard-coded'
  );
  ev.expect('The ServiceNow grid draws columns from caf_conformance_type where active=true.');
  ev.expect('The Salesforce LWC draws columns from the CAF_Request__c data it holds; no control object is mirrored.');
  ev.expect('A control with no requests gets a column in ServiceNow and none in Salesforce.');

  ev.step('List the active CAF Controls — the ServiceNow column source.');
  const controls = cnitGet(TABLES.control, { query: 'active=true^ORDERBYname', fields: ['name', 'active', 'sys_id'] });
  ev.record('Active CAF Controls', TABLES.control, cnitCommand(TABLES.control, { query: 'active=true^ORDERBYname' }), controls);

  ev.step('List the distinct controls present in the mirrored request data — the Salesforce column source.');
  const sfControls = sf.soql(
    'SELECT CAF_Control__c FROM CAF_Request__c WHERE CAF_Control__c != null AND Business_Application__c != null GROUP BY CAF_Control__c'
  );
  const sfNames = sfControls.map((r) => r.CAF_Control__c).sort();
  ev.record('Controls represented in Salesforce request data', sf.OBJECTS.req, 'GROUP BY CAF_Control__c', sfControls as Record<string, string>[]);

  const snNames = controls.map((c) => c.name).sort();
  const snOnly = only(new Set(snNames), new Set(sfNames));
  const sfOnly = only(new Set(sfNames), new Set(snNames));

  ev.actual(`ServiceNow column set (${snNames.length}): ${snNames.join(', ')}`);
  ev.actual(`Salesforce column set (${sfNames.length}): ${sfNames.join(', ')}`);
  ev.actual(`Columns ServiceNow would show and Salesforce would not: ${snOnly.join(', ') || 'none'}`);
  ev.actual(`Columns Salesforce would show and ServiceNow would not: ${sfOnly.join(', ') || 'none'}`);
  ev.observe(
    'Neither LWC nor widget hard-codes a column list: cafDashboard.build() collects distinct CAF_Control__c from ' +
      'the returned rows and sorts them, so a new control needs no code change on either side.'
  );
  ev.observe(
    'The two sources legitimately disagree, and Sync Health will not report it — no mirrored record disagrees, ' +
      'because the control table is not mirrored. Anyone comparing the two grid screenshots without this note ' +
      'will raise the difference as a defect.'
  );
  ev.observe(
    'Part B — introducing a request against a control not currently represented, and confirming a column appears ' +
      'with no code change — is ONE-SHOT and needs a write to ServiceNow. Not executed in this pass.'
  );

  if (snOnly.length === 0 && sfOnly.length === 0) {
    ev.pass(
      'Both grids currently derive the same column set from data. The divergence the case documents is latent, ' +
        'not present: every active control happens to have at least one request. Part B not executed (ONE-SHOT).'
    );
  } else {
    ev.pass(
      `Divergence confirmed on live data: ${snOnly.length} control(s) get a ServiceNow column and no Salesforce ` +
        `column (${snOnly.join(', ')}). Expected behaviour, documented in the case. Part B not executed (ONE-SHOT).`
    );
  }
});

test('TC-INT-050 — Compliant only when every control is compliant', async () => {
  const ev = new CaseEvidence('TC-INT-050', 'Compliant only when every control is compliant');
  ev.expect('The Salesforce roll-up matches the ServiceNow widget exactly.');
  ev.expect('An application reads Compliant only when every one of its controls is in_compliance.');

  ev.step('Run the deployed CafDashboardController.getRequests() and apply the LWC roll-up to its output.');
  // The roll-up lives in cafDashboard.build(): controls are the distinct
  // CAF_Control__c across all rows, and allGreen is compliant === controls.length.
  // Reproducing that here, over the real controller's real output, is what makes
  // the comparison against ServiceNow meaningful.
  const rows = sf.soql(
    'SELECT SN_Number__c, Business_Application__c, CAF_Control__c, CAF_Status__c FROM CAF_Request__c ' +
      'WHERE Business_Application__c != null AND CAF_Control__c != null ORDER BY Business_Application__c, CAF_Control__c'
  );
  ev.record('CafDashboardController.getRequests() output', sf.OBJECTS.req, 'same SOQL as the controller', rows as Record<string, string>[]);

  const controls = [...new Set(rows.map((r) => r.CAF_Control__c))].sort();
  const byApp = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (!byApp.has(r.Business_Application__c)) byApp.set(r.Business_Application__c, new Map());
    byApp.get(r.Business_Application__c)!.set(r.CAF_Control__c, r.CAF_Status__c);
  }
  const lwcRows = [...byApp.entries()]
    .map(([app, cells]) => {
      const compliant = controls.filter((c) => cells.get(c) === 'in_compliance').length;
      return {
        application: app,
        compliant_controls: String(compliant),
        total_columns: String(controls.length),
        lwc_label: compliant === controls.length ? 'Compliant' : `${compliant} of ${controls.length}`,
      };
    })
    .sort((a, b) => a.application.localeCompare(b.application));
  ev.record('What the Salesforce LWC renders', 'cafDashboard', 'build() roll-up applied to the controller output', lwcRows);

  ev.step('Read what ServiceNow holds for the same applications.');
  // Keyed by sys_id throughout, never by name: two business applications are
  // named "SAP HANA" — one carrying the data, one sitting at not_ini — so a
  // name lookup silently reads the compliance status of the wrong record. That
  // is a documented data hazard in this instance, and it is exactly the kind of
  // mistake that would make this case report a defect that is not there.
  const allApps = cnitGet(TABLES.businessApp, { fields: ['sys_id', 'name', 'u_caf_compliance_status'] });
  const appById = new Map(allApps.map((a) => [a.sys_id, a]));
  ev.record(
    'ServiceNow business applications carrying a CAF compliance status',
    TABLES.businessApp,
    cnitCommand(TABLES.businessApp, { fields: ['sys_id', 'name', 'u_caf_compliance_status'] }),
    allApps.filter((a) => a.u_caf_compliance_status)
  );

  const snReqs = cnitGet(TABLES.req, { fields: ['number', 'business_application', 'caf_status'] });
  const snByAppId = new Map<string, string[]>();
  for (const r of snReqs) {
    if (!r.business_application || !appById.has(r.business_application)) continue;
    if (!snByAppId.has(r.business_application)) snByAppId.set(r.business_application, []);
    snByAppId.get(r.business_application)!.push(r.caf_status);
  }
  const snRollup = [...snByAppId.entries()]
    .map(([sysId, statuses]) => ({
      application: appById.get(sysId)!.name,
      sys_id: sysId,
      in_compliance: String(statuses.filter((s) => s === 'in_compliance').length),
      total_requests: String(statuses.length),
      u_caf_compliance_status: appById.get(sysId)!.u_caf_compliance_status || '(empty)',
    }))
    .sort((a, b) => a.application.localeCompare(b.application));
  ev.record('ServiceNow roll-up versus the stored status field', TABLES.req, 'caf_status grouped by business_application sys_id', snRollup);
  ev.observe(
    'Every business-application lookup in this case is keyed by sys_id. Two applications are named "SAP HANA" — ' +
      `${[...appById.values()].filter((a) => a.name === 'SAP HANA').map((a) => `${a.sys_id} (${a.u_caf_compliance_status || 'empty'})`).join(', ')} ` +
      '— so a lookup by name reads a status belonging to the other record.'
  );

  ev.step('Compare the two verdicts application by application.');
  const disagreements: string[] = [];
  for (const row of lwcRows) {
    const sn = snRollup.find((s) => s.application === row.application);
    if (!sn) continue;
    const snSaysCompliant = sn.u_caf_compliance_status === 'compliant';
    const lwcSaysCompliant = row.lwc_label === 'Compliant';
    if (snSaysCompliant !== lwcSaysCompliant) {
      disagreements.push(
        `${row.application}: ServiceNow u_caf_compliance_status = "${sn.u_caf_compliance_status}", ` +
          `Salesforce LWC renders "${row.lwc_label}" (${sn.in_compliance} of ${sn.total_requests} requests in compliance)`
      );
    }
    ev.actual(
      `${row.application} — LWC "${row.lwc_label}"; ServiceNow stored status "${sn.u_caf_compliance_status}"; ` +
        `${sn.in_compliance} of ${sn.total_requests} request(s) in compliance.`
    );
  }

  ev.observe(
    'The LWC computes its own roll-up in cafDashboard.build() from the mirrored CAF_Status__c values. It never ' +
      'reads u_caf_compliance_status, which is the field TC-SN-017 found wrong — so the two surfaces are ' +
      'answering from different data, not from one shared answer.'
  );
  ev.observe(
    'Separate observation worth raising on its own: allGreen compares against controls.length, the count of ' +
      'columns across the whole grid rather than the count of controls that application actually has a request ' +
      'for. An application with fewer requests than there are columns can therefore never read Compliant, ' +
      'regardless of its own compliance.'
  );

  if (disagreements.length === 0) {
    ev.pass('Both surfaces give the same verdict for every application.');
  } else {
    ev.fail(
      'The two platforms visibly disagree about identical data — the split-brain outcome the case calls the ' +
        'worse of the two. ' +
        disagreements.join(' | ') +
        '. The LWC is giving the arithmetically correct answer and ServiceNow the wrong one; the defect is in ' +
        'the ServiceNow business rule CAF - update BA when req compliant, not in the mirror.'
    );
  }
  expect(disagreements, disagreements.join('\n')).toEqual([]);
});

test('TC-INT-054 — The orphan request appears in neither grid', async () => {
  const ev = new CaseEvidence('TC-INT-054', 'The orphan request appears in neither grid');
  ev.expect('RCAF0001001 is present in both tables and absent from both grids.');
  ev.expect('Both sides filter it out identically; a one-sided filter would be drift Sync Health cannot catch.');

  ev.step('Confirm the record exists in ServiceNow with no business application and no control.');
  const snRow = cnitGet(TABLES.req, {
    query: 'number=RCAF0001001',
    fields: ['number', 'sys_id', 'business_application', 'caf_conformance_type', 'caf_status'],
  });
  ev.record('The orphan in ServiceNow', TABLES.req, cnitCommand(TABLES.req, { query: 'number=RCAF0001001' }), snRow);

  ev.step('Confirm it is mirrored into Salesforce.');
  const sfAll = sf.soql(
    "SELECT SN_Number__c, Business_Application__c, CAF_Control__c FROM CAF_Request__c WHERE SN_Number__c = 'RCAF0001001'"
  );
  ev.record('The orphan in Salesforce', sf.OBJECTS.req, "SN_Number__c = 'RCAF0001001'", sfAll as Record<string, string>[]);

  ev.step('Confirm the Salesforce grid query excludes it.');
  const sfGrid = sf.soql(
    'SELECT SN_Number__c FROM CAF_Request__c WHERE Business_Application__c != null AND CAF_Control__c != null'
  );
  const inSfGrid = sfGrid.some((r) => r.SN_Number__c === 'RCAF0001001');
  ev.record('Requests the Salesforce grid draws', sf.OBJECTS.req, 'CafDashboardController.getRequests() filter', sfGrid as Record<string, string>[]);

  ev.actual(
    snRow.length
      ? `Present in ServiceNow: business_application = "${snRow[0].business_application || '(empty)'}", caf_conformance_type = "${snRow[0].caf_conformance_type || '(empty)'}"`
      : 'Not found in ServiceNow.'
  );
  ev.actual(sfAll.length ? 'Present in Salesforce as a mirrored record.' : 'Not mirrored into Salesforce.');
  ev.actual(`Appears in the Salesforce grid: ${inSfGrid}. Grid draws ${sfGrid.length} of ${sfAll.length ? 'the mirrored' : ''} request(s).`);
  ev.observe(
    'The ServiceNow side of this was executed separately as TC-SN-067, which found the orphan correctly excluded ' +
      'from the /caf grid. This case adds the Salesforce half and the cross-platform assertion.'
  );

  const ok = snRow.length > 0 && sfAll.length > 0 && !inSfGrid;
  if (ok) ev.pass('Present in both stores, drawn by neither grid — both sides filter identically.');
  else ev.fail(`ServiceNow rows: ${snRow.length}; Salesforce rows: ${sfAll.length}; in Salesforce grid: ${inSfGrid}`);
  expect(inSfGrid).toBeFalsy();
});

test('TC-INT-055 — LWCs are droppable on an Experience Cloud page', async () => {
  const ev = new CaseEvidence('TC-INT-055', 'LWCs are droppable on an Experience Cloud page');
  ev.expect('cafEvidence and cafAttestation carry the lightningCommunity__Page target.');
  ev.expect('Blocked, not failed: there is no Experience Cloud site to drop them on.');

  ev.step('Read the component metadata for both LWCs.');
  const targets: Record<string, string>[] = [];
  for (const name of ['cafEvidence', 'cafAttestation', 'cafDashboard', 'cafSyncHealth']) {
    const meta = fs.readFileSync(
      path.join(REPO, 'salesforce', 'force-app', 'lwc', name, `${name}.js-meta.xml`),
      'utf8'
    );
    targets.push({
      component: name,
      exposed: (meta.match(/<isExposed>(.*?)<\/isExposed>/) ?? [])[1] ?? '(none)',
      targets: [...meta.matchAll(/<target>(.*?)<\/target>/g)].map((m) => m[1]).join(', '),
    });
  }
  ev.record('LWC targets', 'js-meta.xml', 'force-app/lwc/*/*.js-meta.xml', targets);

  ev.step('Check whether the org has an Experience Cloud site at all.');
  let networks: Record<string, any>[] = [];
  let networkError = '';
  try {
    networks = sf.soql('SELECT Name, Status FROM Network');
  } catch (e: any) {
    // No Experience Cloud in the org means the Network object is not queryable,
    // which is itself the answer this case wants.
    networkError = String(e.message ?? e).split('\n')[0];
  }
  ev.record('Experience Cloud sites', 'Network', sf.soqlCommand('SELECT Name, Status FROM Network'), networks as Record<string, string>[]);

  const evidenceOk = targets.find((t) => t.component === 'cafEvidence')?.targets.includes('lightningCommunity__Page');
  const attestOk = targets.find((t) => t.component === 'cafAttestation')?.targets.includes('lightningCommunity__Page');

  ev.actual(`cafEvidence carries lightningCommunity__Page: ${evidenceOk}`);
  ev.actual(`cafAttestation carries lightningCommunity__Page: ${attestOk}`);
  ev.actual(
    networkError
      ? `No Experience Cloud in this org — querying Network failed: ${networkError}`
      : `${networks.length} Experience Cloud site(s) in the org.`
  );
  ev.observe(
    'HANDOFF open item 1, and the remainder of the licensing argument for the whole split: the components are ' +
      'ready for a site that does not exist. The org Experience licence count is still unverified.'
  );

  expect(evidenceOk, 'cafEvidence must carry lightningCommunity__Page').toBeTruthy();
  expect(attestOk, 'cafAttestation must carry lightningCommunity__Page').toBeTruthy();
  ev.blocked(
    'Both components carry the target and would appear in the palette, but there is no Experience Cloud site in ' +
      'the org to place them on, so the case cannot be completed. Blocked, not failed.'
  );
});

// ===========================================================================
// Suite 8 — Configuration, auth and limits
// ===========================================================================

test('TC-INT-059 — Named credential and Client Credentials auth', async () => {
  const ev = new CaseEvidence('TC-INT-059', 'Named credential and Client Credentials auth');
  ev.expect('The named credential is called ServiceNow_CAF exactly.');
  ev.expect('No credential has leaked into force-app/namedCredentials/.');
  ev.expect('The client secret property is encrypted (password2).');
  ev.expect('Inbound authenticates as sf.integration; outbound obtains a token via Client Credentials.');

  ev.step('List the named credentials in the org.');
  const creds = sf.namedCredentials();
  ev.record('Named credentials', 'NamedCredential', 'Tooling API', creds as Record<string, string>[]);
  const target = creds.find((c) => c.DeveloperName === 'ServiceNow_CAF');

  ev.step('Confirm every Apex reference uses that exact name.');
  const classDir = path.join(REPO, 'salesforce', 'force-app', 'classes');
  const refs: Record<string, string>[] = [];
  for (const f of fs.readdirSync(classDir).filter((f) => f.endsWith('.cls'))) {
    const src = fs.readFileSync(path.join(classDir, f), 'utf8');
    for (const m of src.matchAll(/callout:(\w+)/g)) refs.push({ file: f, reference: m[1] });
  }
  ev.record('callout: references in Apex', 'force-app/classes', 'grep callout:', refs);

  ev.step('Confirm no credential has been committed to source.');
  const ncDir = path.join(REPO, 'salesforce', 'force-app', 'namedCredentials');
  const ncInSource = fs.existsSync(ncDir) ? fs.readdirSync(ncDir) : [];

  ev.step('Read the ServiceNow-side integration properties and their storage types.');
  const props = cnitGet(TABLES.properties, {
    query: 'nameSTARTSWITHx_gskn2_caf_compli.sf.',
    fields: ['name', 'type', 'is_private', 'read_roles'],
  });
  ev.record('Integration properties', TABLES.properties, cnitCommand(TABLES.properties, { query: 'nameSTARTSWITHx_gskn2_caf_compli.sf.' }), props);
  const secret = props.find((p) => /secret/i.test(p.name));

  ev.step('Confirm the sync script requests a token by Client Credentials rather than JWT.');
  const sync = fs.readFileSync(path.join(REPO, 'servicenow', 'CAFSalesforceSync.script-include.js'), 'utf8');
  const grantType = (sync.match(/grant_type=([a-z_]+)/) ?? sync.match(/grant_type['"]?\s*[:=]\s*['"]([a-z_]+)/) ?? [])[1] ?? '(not found)';

  ev.actual(target ? `Named credential present: ${target.DeveloperName}, endpoint ${target.Endpoint}, principal ${target.PrincipalType}` : 'ServiceNow_CAF not found in the org.');
  ev.actual(`Apex references: ${[...new Set(refs.map((r) => r.reference))].join(', ') || 'none'}`);
  ev.actual(`Files in force-app/namedCredentials/: ${ncInSource.length ? ncInSource.join(', ') : 'the directory does not exist'}`);
  ev.actual(`Client secret property: ${secret ? `${secret.name}, type = ${secret.type}` : 'not found'}`);
  ev.actual(`Outbound grant type in CAFSalesforceSync: ${grantType}`);
  ev.observe(
    'Deviation to record in the TDD delta: Client Credentials rather than JWT bearer, because ServiceNow\'s ' +
      'jwt_provider table has no iss/sub/aud fields. JWT remains the better production answer.'
  );
  ev.observe(
    'The named credential is created by hand and deliberately not in source: Salesforce will not deploy one ' +
      'without a password, and that password must not sit in a client-facing directory.'
  );

  const problems: string[] = [];
  if (!target) problems.push('ServiceNow_CAF named credential not found');
  if (refs.some((r) => r.reference !== 'ServiceNow_CAF')) problems.push(`Apex references a different name: ${refs.map((r) => r.reference).join(', ')}`);
  if (ncInSource.length) problems.push(`credential metadata present in source: ${ncInSource.join(', ')}`);
  if (secret && secret.type !== 'password2') problems.push(`client secret stored as type "${secret.type}" rather than password2`);

  if (problems.length === 0) ev.pass('Named credential, Apex references, source hygiene and secret storage all as specified.');
  else ev.fail(problems.join('; '));
  expect(problems).toEqual([]);
});

test('TC-INT-060 — API budget consumption', async () => {
  const ev = new CaseEvidence('TC-INT-060', 'API budget consumption per journey');
  ev.expect('Roughly 45 calls for one full end-to-end journey, about 1% of the daily budget.');
  ev.expect('No unexplained jump that would indicate an echo loop or a retry storm.');

  ev.step('Read the org limits — the same figure Setup shows as "API Requests, Last 24 Hours".');
  const l = sf.limits();
  const api = l.DailyApiRequests;
  ev.record('Org limits', 'Limits', 'sf org list limits --target-org caf-sf', [
    { limit: 'DailyApiRequests', max: String(api.max), remaining: String(api.remaining), used: String(api.max - api.remaining) },
    { limit: 'DataStorageMB', max: String(l.DataStorageMB.max), remaining: String(l.DataStorageMB.remaining), used: String(l.DataStorageMB.max - l.DataStorageMB.remaining) },
    { limit: 'FileStorageMB', max: String(l.FileStorageMB.max), remaining: String(l.FileStorageMB.remaining), used: String(l.FileStorageMB.max - l.FileStorageMB.remaining) },
  ]);

  ev.actual(`DailyApiRequests: ${api.max - api.remaining} used of ${api.max}; ${api.remaining} remaining.`);
  ev.actual(`Storage: ${l.DataStorageMB.max - l.DataStorageMB.remaining} of ${l.DataStorageMB.max} MB data, ${l.FileStorageMB.max - l.FileStorageMB.remaining} of ${l.FileStorageMB.max} MB files.`);
  ev.actual(`This read-only pass has itself made ${sf.sfCallsMade()} sf calls so far.`);
  ev.observe(
    `Documentation correction: HANDOFF section 1 and both test-case files state a ~5,000 call daily budget. The ` +
      `org reports ${api.max}. Every budget calculation in the pack is therefore conservative by a factor of ` +
      `${(api.max / 5000).toFixed(1)}, which is the safe direction to be wrong in, but the figure should be corrected.`
  );
  ev.observe(
    'The per-journey figure of ~45 calls cannot be measured in this pass: it requires executing one full ' +
      'end-to-end journey, which is a ONE-SHOT write case (TC-INT-027 and TC-INT-031). Measured here: the ' +
      'read-only pass costs well under 1% of the budget and can be re-run freely.'
  );

  // The alarm this case is really for: a number that has no explanation.
  const used = api.max - api.remaining;
  if (used < api.max * 0.5) {
    ev.pass(
      `Budget healthy: ${used} of ${api.max} used, no sign of an echo loop or retry storm. Per-journey ` +
        'consumption not measured — needs a ONE-SHOT journey.'
    );
  } else {
    ev.fail(`${used} of ${api.max} calls consumed — investigate before running anything further.`);
  }
  expect(used).toBeLessThan(api.max * 0.5);
});

test('TC-INT-061 — No Apex test coverage exists', async () => {
  const ev = new CaseEvidence('TC-INT-061', 'No Apex test coverage exists');
  ev.expect('Coverage on CafSyncHealth, CafEvidenceService and CafAttestationService is zero.');
  ev.expect('Reported as a release gate, not a defect: Salesforce requires 75% to deploy to production.');

  ev.step('List the Apex classes in the org.');
  const classes = sf.apexClasses();
  ev.record('Apex classes', 'ApexClass', 'Tooling API', classes as Record<string, string>[]);

  ev.step('Look for any test class belonging to this org rather than to an installed package.');
  const tests = sf.apexTestClasses();
  ev.record(
    'Unmanaged classes carrying @isTest',
    'ApexClass',
    'Tooling API, NamespacePrefix = null, SymbolTable modifiers contain isTest',
    tests.map((t) => ({ Name: t.Name })) as Record<string, string>[]
  );
  const packaged = classes.filter((c) => c.NamespacePrefix);

  ev.step('Read the stored coverage figures.');
  let coverage: Record<string, any>[] = [];
  try {
    coverage = sf.codeCoverage();
  } catch (e: any) {
    ev.observe(`ApexCodeCoverageAggregate not readable: ${String(e.message ?? e).split('\n')[0]}`);
  }
  ev.record(
    'Stored code coverage',
    'ApexCodeCoverageAggregate',
    'Tooling API',
    coverage.map((c) => ({
      class: c.ApexClassOrTrigger?.Name ?? '(unnamed)',
      covered: String(c.NumLinesCovered),
      uncovered: String(c.NumLinesUncovered),
    }))
  );

  const targetClasses = ['CafSyncHealth', 'CafEvidenceService', 'CafAttestationService'];
  const covered = coverage.filter((c) => targetClasses.includes(c.ApexClassOrTrigger?.Name));

  ev.actual(
    `${classes.length} Apex class(es) in the org: ${classes.filter((c) => !c.NamespacePrefix).map((c) => c.Name).join(', ')} ` +
      `(plus ${packaged.length} packaged: ${packaged.map((c) => `${c.NamespacePrefix}.${c.Name}`).join(', ')}).`
  );
  ev.actual(`${tests.length} unmanaged test class(es)${tests.length ? `: ${tests.map((t) => t.Name).join(', ')}` : ' — none'}.`);
  ev.actual(
    covered.length === 0
      ? `No coverage recorded for ${targetClasses.join(', ')} — zero, as expected.`
      : covered.map((c) => `${c.ApexClassOrTrigger.Name}: ${c.NumLinesCovered} covered / ${c.NumLinesUncovered} uncovered`).join('; ')
  );
  ev.observe(
    'The org ships four `devedapp` classes of its own, two of them named *Test. They are packaged, cover nothing ' +
      'in this project, and do not count toward the org-wide figure the same way — filtering on the name alone ' +
      'would report test coverage that does not exist. Note also that CafAttestationService contains the ' +
      'substring "test", so a name-based filter claims the class under test is its own test.'
  );
  ev.observe(
    'Fine for a Developer Edition org, blocking for any move toward production: Salesforce requires 75% org-wide ' +
      'coverage to deploy. This belongs in the test summary as a release risk, not in the defect list. ' +
      'HANDOFF open item 5.'
  );

  const noCoverage = tests.length === 0 && covered.every((c) => Number(c.NumLinesCovered ?? 0) === 0);
  if (noCoverage) {
    ev.pass('Zero test classes and zero coverage on all three service classes — confirmed as a release gate.');
  } else {
    ev.fail(`Expected zero coverage; found test classes ${tests.map((t) => t.Name).join(', ')} and coverage on ${covered.length} class(es).`);
  }
  expect(noCoverage).toBeTruthy();
});
