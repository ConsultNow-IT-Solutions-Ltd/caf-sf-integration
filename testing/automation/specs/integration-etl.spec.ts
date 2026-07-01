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

test('TC-INT-063 — The External Id is unique and always populated', async () => {
  const ev = new CaseEvidence('TC-INT-063', 'The External Id is unique and always populated');
  ev.expect('No duplicate ServiceNow_Sys_Id__c on any mirrored object.');
  ev.expect('No blank ServiceNow_Sys_Id__c on any mirrored object.');

  const findings: string[] = [];
  for (const obj of [sf.OBJECTS.req, sf.OBJECTS.tsk, sf.OBJECTS.control]) {
    ev.step(`Read every ${obj} row with its External Id.`);
    const soql = `SELECT SN_Number__c, ServiceNow_Sys_Id__c FROM ${obj} ORDER BY SN_Number__c`;
    const rows = sf.soql(soql);
    ev.record(obj, obj, sf.soqlCommand(soql), rows as Record<string, string>[]);

    const seen = new Map<string, string[]>();
    const empty: string[] = [];
    for (const r of rows as any[]) {
      const id = r.ServiceNow_Sys_Id__c;
      if (blank(id)) {
        empty.push(String(r.SN_Number__c ?? '(no number)'));
        continue;
      }
      seen.set(String(id), [...(seen.get(String(id)) ?? []), String(r.SN_Number__c ?? '?')]);
    }
    const dupes = [...seen.entries()].filter(([, numbers]) => numbers.length > 1);

    ev.actual(`${obj}: ${rows.length} row(s), ${dupes.length} duplicate key(s), ${empty.length} blank.`);
    if (dupes.length) {
      findings.push(`${obj}: duplicate External Id — ${sample(dupes.map(([id, n]) => `${id} on ${n.join(', ')}`))}`);
    }
    if (empty.length) findings.push(`${obj}: blank External Id on ${sample(empty)}`);
  }

  ev.observe(
    'Upsert guarantees uniqueness only for rows it created. A row inserted by hand or by Data Loader breaks ' +
      'correlation silently, and every later push then updates the wrong one of the pair.'
  );

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass('Every mirrored row on all three objects carries a unique, populated External Id.')
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

test('TC-INT-064 — Truncation headroom, and the drift it would cause', async () => {
  const ev = new CaseEvidence('TC-INT-064', 'Truncation headroom, and the drift it would cause');
  ev.expect(`No caf_req or caf_tsk short_description exceeds ${SHORT_DESC_MAX} characters.`);
  ev.expect(`No control name exceeds ${CONTROL_NAME_MAX} characters.`);
  ev.expect('Therefore nothing is being truncated, and no permanent Sync Health drift exists.');

  const findings: string[] = [];
  const checks: { label: string; table: string; field: string; max: number }[] = [
    { label: 'CAF Request short_description', table: TABLES.req, field: 'short_description', max: SHORT_DESC_MAX },
    { label: 'CAF Task short_description', table: TABLES.tsk, field: 'short_description', max: SHORT_DESC_MAX },
    { label: 'Control name', table: TABLES.control, field: 'name', max: CONTROL_NAME_MAX },
  ];

  for (const c of checks) {
    ev.step(`Measure ${c.label} against the transform's ${c.max}-character limit.`);
    const rows = cnitGet(c.table, { fields: ['number', c.field] });
    const lengths = rows.map((r) => ({ number: r.number, len: (r[c.field] ?? '').length }));
    const longest = lengths.reduce((a, b) => (b.len > a.len ? b : a), { number: '-', len: 0 });
    const over = lengths.filter((l) => l.len > c.max);

    ev.record(c.label, c.table, cnitCommand(c.table, { fields: ['number', c.field] }),
      lengths.map((l) => ({ number: l.number, length: String(l.len) })));
    ev.actual(
      `${c.label}: longest is ${longest.len} of ${c.max} on ${longest.number} — ` +
        `${c.max - longest.len} characters of headroom. ${over.length} over the limit.`
    );
    if (over.length) {
      findings.push(
        `${c.label}: ${over.length} record(s) exceed ${c.max} and are being silently truncated — ` +
          sample(over.map((o) => `${o.number} (${o.len})`))
      );
    }
  }

  ev.observe(
    'If one ever does exceed the limit, Sync Health compares the raw ServiceNow value against the truncated ' +
      'Salesforce copy and reports drift permanently — Re-sync re-truncates to the identical value, so the ' +
      'difference can never clear. This case is an early warning and stops being one the day it fails.'
  );

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass('Every source value is inside its limit; no truncation is occurring.')
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

test('TC-INT-065 — Date conversion fidelity', async () => {
  const ev = new CaseEvidence('TC-INT-065', 'Date conversion fidelity');
  ev.expect('Planned_Completion_Date__c equals _toIso(planned_completion_date) for every mirrored record.');
  ev.expect('An empty source is empty in the mirror — not epoch, not today.');
  ev.expect('Every source value matches the yyyy-MM-dd HH:mm:ss shape _toIso assumes.');

  ev.step('Establish the Salesforce field type — a date silently drops the time a datetime would keep.');
  const desc = sf.describe(sf.OBJECTS.req);
  const field = (desc.fields ?? []).find((f: any) => f.name === 'Planned_Completion_Date__c');
  const fieldType = field?.type ?? 'unknown';
  ev.actual(`CAF_Request__c.Planned_Completion_Date__c is of type "${fieldType}".`);
  if (fieldType === 'date') {
    ev.observe(
      'The field is a date, not a datetime, so the time component is discarded on load. For a source ' +
        'timestamp near midnight UTC this moves the due date by a day for anyone reading it in another zone.'
    );
  }

  const findings: string[] = [];
  for (const [label, table, object] of [
    ['Requests', TABLES.req, sf.OBJECTS.req],
    ['Tasks', TABLES.tsk, sf.OBJECTS.tsk],
  ] as const) {
    ev.step(`Compare ${label.toLowerCase()} field by field.`);
    const snRows = cnitGet(table, { fields: ['number', 'sys_id', 'planned_completion_date'] });
    const soql =
      `SELECT SN_Number__c, ServiceNow_Sys_Id__c, Planned_Completion_Date__c FROM ${object} ORDER BY SN_Number__c`;
    const sfRows = sf.soql(soql);
    ev.record(`${label} — Salesforce`, object, sf.soqlCommand(soql), sfRows as Record<string, string>[]);

    const byId = index(sfRows as any[], 'ServiceNow_Sys_Id__c');
    let compared = 0;
    const mismatched: string[] = [];
    const malformed: string[] = [];

    for (const sn of snRows) {
      const mirror = byId.get(sn.sys_id);
      if (!mirror) continue;
      compared += 1;
      const source = sn.planned_completion_date;
      if (source && !SN_DATETIME.test(source)) {
        malformed.push(`${sn.number} holds "${source}"`);
      }
      const expected = toIso(source);
      const actual = mirror.Planned_Completion_Date__c ?? null;
      if (blank(source) && !blank(actual)) {
        mismatched.push(`${sn.number}: source empty, mirror holds "${actual}"`);
      } else if (!blank(source) && !sameInstant(actual, expected)) {
        mismatched.push(`${sn.number}: expected ${expected}, mirror holds ${actual ?? 'null'}`);
      }
    }

    ev.actual(`${label}: ${compared} compared, ${mismatched.length} differing, ${malformed.length} malformed source.`);
    if (mismatched.length) findings.push(`${label} date drift — ${sample(mismatched)}`);
    if (malformed.length) {
      findings.push(
        `${label}: source value not in yyyy-MM-dd HH:mm:ss — ${sample(malformed)}. _toIso does no validation, ` +
          'so anything else is passed to Salesforce malformed'
      );
    }
  }

  ev.observe('CafSyncHealth does not compare this field, so any drift found here is invisible on the instance today.');

  findings.forEach((f) => ev.observe(f));
  findings.length === 0
    ? ev.pass('Every mirrored date matches the transform applied to its source.')
    : ev.fail(findings.join(' | '));
  expect(findings, findings.join('\n')).toEqual([]);
});

