import { test, expect } from '@playwright/test';
import path from 'path';
import { CaseEvidence, flushCurrentCase, describeRun } from '../lib/evidence';
import { cnitGet, cnitCommand, TABLES } from '../lib/cnit';
import * as sf from '../lib/salesforce';
import { SN_INSTANCE } from '../playwright.config';

/**
 * TEST-CASES-INTEGRATION.md suite 9 — transform and data quality.
 *
 * The outbound push is an ETL: extract by GlideRecord, transform in
 * CAFSalesforceSync's three payload builders, load by upsert on
 * ServiceNow_Sys_Id__c. Suite 1 asserts records arrive. This file asserts that
 * what arrived still means the same thing, which a transform layer is exactly
 * what breaks.
 *
 * **Reads both platforms, writes to neither**, so it is re-runnable on any day
 * and needs no sf.integration credential — cnit and the sf CLI are enough. That
 * is why it sits on its own project rather than inside integration-negative.
 *
 * The transform is reimplemented here, deliberately and narrowly. Asserting that
 * Salesforce holds `_toIso(source)` means restating what _toIso does — a
 * tautology if it drifts from the real one. The mitigation is that each function
 * is three lines and is quoted in a comment beside its copy; anything larger
 * would be tested through anonymous Apex against the deployed class instead, as
 * the roll-up cases do.
 */

const RESULTS = path.join(__dirname, '..', 'results');

const SHORT_DESC_MAX = 255;   // _truncate(short_description, 255)
const CONTROL_NAME_MAX = 80;  // _truncate(name, 80)

/** _stateLabel: an integer choice pushed as its label, unmapped values passed through. */
const STATE_LABELS: Record<string, string> = {
  '1': 'Open',
  '2': 'In Progress',
  '3': 'Closed Complete',
  '-1': 'Cancelled',
};

describeRun({
  instance: `${SN_INSTANCE} + Salesforce orgfarm-4938c7f768-dev-ed`,
  executedBy: 'admin (ServiceNow, via cnit OAuth) / admin.070b86ccf531@agentforce.com (Salesforce)',
  executedVia:
    'Playwright runner, no browser and no writes. ServiceNow read over cnit, Salesforce over the sf CLI. ' +
    'Each case compares the transform output held in Salesforce against the source record it was built from.',
});

test.afterEach(({}, testInfo) => {
  flushCurrentCase(RESULTS, testInfo.status, testInfo.error?.message);
});

// --------------------------------------------------------------------- helpers

/**
 * _toIso: 'yyyy-MM-dd HH:mm:ss' UTC -> ISO 8601 with an explicit zone.
 * A literal replacement with no validation, which is itself worth asserting.
 */
function toIso(snDateTime: string | undefined): string | null {
  if (!snDateTime) return null;
  return snDateTime.replace(' ', 'T') + 'Z';
}

const SN_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Salesforce returns 2026-08-08T00:00:00.000+0000; ServiceNow has no millis and uses Z. */
function sameInstant(sfValue: string | null, snIso: string | null): boolean {
  if (!sfValue && !snIso) return true;
  if (!sfValue || !snIso) return false;
  const norm = (v: string) => {
    const t = Date.parse(v);
    return Number.isNaN(t) ? v.trim() : String(t);
  };
  return norm(sfValue) === norm(snIso);
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

function index<T extends Record<string, any>>(rows: T[], key: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (r[key]) m.set(String(r[key]), r);
  return m;
}

/** Report at most N examples — an evidence record naming 400 rows is unreadable. */
function sample(items: string[], n = 6): string {
  return items.slice(0, n).join(' | ') + (items.length > n ? ` … and ${items.length - n} more` : '');
}

// ===========================================================================

test('TC-INT-062 — The control catalogue is reconciled by nothing', async () => {
  const ev = new CaseEvidence('TC-INT-062', 'The control catalogue is reconciled by nothing');
  ev.expect('Active controls in ServiceNow and CAF_Control_Catalog__c are set-for-set identical by sys_id.');
  ev.expect('Every mirrored row for an active control carries Active__c = true.');

  ev.step('Read active controls from ServiceNow and the mirrored catalogue from Salesforce.');
  const snQuery = 'active=true';
  const snCtl = cnitGet(TABLES.control, { query: snQuery, fields: ['number', 'name', 'sys_id', 'active'] });
  const soql =
    'SELECT Name, SN_Number__c, Active__c, ServiceNow_Sys_Id__c FROM CAF_Control_Catalog__c ORDER BY Name';
  const sfCtl = sf.soql(soql);
  ev.record('ServiceNow controls', TABLES.control, cnitCommand(TABLES.control, { query: snQuery }), snCtl);
  ev.record('Salesforce catalogue', sf.OBJECTS.control, sf.soqlCommand(soql), sfCtl as Record<string, string>[]);

  ev.step('Compare as sets of sys_id, and check the active flag on each mirrored row.');
  const snIds = new Set(snCtl.map((c) => c.sys_id));
  const sfActive = (sfCtl as any[]).filter((c) => c.Active__c === true);
  const sfActiveIds = new Set(sfActive.map((c) => String(c.ServiceNow_Sys_Id__c)));

  const missing = [...snIds].filter((id) => !sfActiveIds.has(id));
  const extra = [...sfActiveIds].filter((id) => !snIds.has(id));

  const findings: string[] = [];
  if (missing.length) {
    const names = missing.map((id) => snCtl.find((c) => c.sys_id === id)?.name ?? id);
    findings.push(`Active in ServiceNow, not active in Salesforce: ${sample(names)}`);
  }
  if (extra.length) {
    const names = extra.map((id) => String((sfActive.find((c) => c.ServiceNow_Sys_Id__c === id) as any)?.Name ?? id));
    findings.push(`Active in Salesforce with no active ServiceNow control: ${sample(names)} — an orphan column`);
  }

  ev.actual(
    `ServiceNow ${snCtl.length} active control(s); Salesforce ${sfCtl.length} row(s), ${sfActive.length} active. ` +
      `${missing.length} missing, ${extra.length} orphaned.`
  );
  ev.observe(
    'Sync Health reconciles requests and tasks only, so nothing else on this build would report a catalogue ' +
      'difference — and a catalogue row is a visible dashboard column.'
  );

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass(`${snCtl.length} controls, set-for-set identical by sys_id, all active on both sides.`)
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

