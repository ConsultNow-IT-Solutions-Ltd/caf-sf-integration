import { test, expect } from '@playwright/test';
import path from 'path';
import {
  TABLES,
  tableApi,
  sysIdForNumber,
  openForm,
  openPortal,
  PORTAL_PAGES,
  readComplianceGrid,
  isFieldReadOnly,
  isFieldMandatory,
} from '../lib/servicenow';
import { CaseEvidence, flushCurrentCase, bindWatchPage } from '../lib/evidence';

const RESULTS_DIR = path.join(__dirname, '..', 'results');

/**
 * Executable ServiceNow test cases — the read-only subset.
 *
 * Every case here observes rather than mutates, so the file can be re-run
 * against the demo instance without consuming a ONE-SHOT record or leaving
 * residue. The state-transition cases need a dedicated test business
 * application first; see the test-data rules in TEST-CASES-SERVICENOW.md.
 *
 * Each case writes structured evidence, which the Python generator turns into
 * one Word document per case.
 */

// Narrate every case in this file onto the browser when the run is being
// watched. A no-op otherwise, and the cases themselves are untouched — the
// steps they already record are what gets narrated.
test.beforeEach(({ page }) => {
  bindWatchPage(page);
});

test.afterEach(async ({}, testInfo) => {
  await flushCurrentCase(RESULTS_DIR, testInfo.status, testInfo.error?.message);
  bindWatchPage(null);
});

test('TC-SN-001 — caf_conformance_type on a request references a relationship, not a control', async ({ page }) => {
  const ev = new CaseEvidence(
    'TC-SN-001',
    'caf_conformance_type on a request references a relationship, not a control'
  );
  ev.expect('The dictionary reference is x_gskn2_caf_compli_caf_relationship, despite the field name and the "CAF control name" label.');
  ev.expect('A request\'s caf_conformance_type value resolves in the relationship table and NOT in the control table.');

  ev.step('Read the dictionary entry for caf_req.caf_conformance_type.');
  const [dict] = await tableApi(page, 'sys_dictionary', {
    query: `name=${TABLES.req}^element=caf_conformance_type`,
    fields: ['name', 'element', 'column_label', 'reference', 'internal_type'],
    limit: 1,
  });
  ev.record('Dictionary entry', 'sys_dictionary', `name=${TABLES.req}^element=caf_conformance_type`, [dict]);
  ev.actual(`reference = ${dict.reference}; column_label = "${dict.column_label}"`);

  ev.step('Take a live request and attempt to resolve its caf_conformance_type in the control table.');
  const [req] = await tableApi(page, TABLES.req, {
    query: 'number=RCAF0001022',
    fields: ['number', 'caf_conformance_type'],
    limit: 1,
  });
  const asControl = await tableApi(page, TABLES.control, {
    query: `sys_id=${req.caf_conformance_type}`,
    fields: ['sys_id', 'name'],
    limit: 1,
  });
  ev.record('Lookup in the CONTROL table', TABLES.control, `sys_id=${req.caf_conformance_type}`, asControl);

  ev.step('Resolve the same value in the relationship table.');
  const asRelationship = await tableApi(page, TABLES.relationship, {
    query: `sys_id=${req.caf_conformance_type}`,
    fields: ['sys_id', 'caf_conformance_type', 'tier', 'crown_jewels', 'frequency'],
    limit: 1,
  });
  ev.record('Lookup in the RELATIONSHIP table', TABLES.relationship, `sys_id=${req.caf_conformance_type}`, asRelationship);

  ev.actual(`Control-table lookup returned ${asControl.length} row(s); relationship-table lookup returned ${asRelationship.length} row(s).`);

  expect(dict.reference).toBe(TABLES.relationship);
  expect(asControl.length).toBe(0);
  expect(asRelationship.length).toBe(1);

  ev.observe(
    'The field is named and labelled after the control table but points at the relationship table. ' +
      'A query written from the design document\'s data model returns zero rows and reads as missing data.'
  );
  ev.pass('Behaviour confirmed. Raise as a documentation defect against the design document, not as a code change — renaming the field would break the task-creation flow.');
});

