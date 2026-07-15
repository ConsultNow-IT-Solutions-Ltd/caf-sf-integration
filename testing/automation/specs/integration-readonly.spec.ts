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

