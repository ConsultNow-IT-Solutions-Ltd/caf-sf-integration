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

