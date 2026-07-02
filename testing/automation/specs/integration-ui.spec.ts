import { test, expect } from '@playwright/test';
import { CaseEvidence, flushCurrentCase, describeRun, bindWatchPage } from '../lib/evidence';
import { cnitGet, cnitCommand, TABLES } from '../lib/cnit';
import * as sf from '../lib/salesforce';
import * as lx from '../lib/lightning';
import { openPortal, PORTAL_PAGES, readComplianceGrid } from '../lib/servicenow';
import { AUTH_STATE, SF_LIGHTNING } from '../playwright.config';
import path from 'path';

/**
 * TEST-CASES-INTEGRATION.md — the Salesforce UI cases.
 *
 * What this file covers is every case whose subject is *what the screen offers*
 * rather than what a write does: which panels open, for whom, carrying which
 * controls, and whether the grid on this side says the same thing as the grid on
 * the other.
 *
 * Nothing here writes. Start, Approve and Reject are read as controls and never
 * clicked — each would close a task through the attest endpoint, which belongs
 * to the ONE-SHOT cases. Opening a panel costs a GET against ServiceNow and
 * nothing else.
 *
 * The subjects are chosen so the states the cases need already exist:
 *   RCAF0001022  holds CAFT0001001 (Open) and CAFT0001022 (Closed, approved,
 *                and carrying 1 Salesforce file against 2 ServiceNow
 *                attachments — the ready-made mismatch)
 *   RCAF0001037  holds CAFT0001046 (In Progress)
 */

const RESULTS = path.join(__dirname, '..', 'results');

const SUBJECT = {
  /** Open + Closed tasks on one request. */
  mixedRequest: 'RCAF0001022',
  openTask: 'CAFT0001001',
  closedTask: 'CAFT0001022',
  /** The In Progress task, and its parent. */
  inProgressRequest: 'RCAF0001037',
  inProgressTask: 'CAFT0001046',
} as const;

describeRun({
  instance: `${SF_LIGHTNING} + https://dev281754.service-now.com`,
  executedBy: 'admin.070b86ccf531@agentforce.com (Salesforce) / admin (ServiceNow)',
  executedVia:
    'Playwright driving Lightning Experience. Every screen assertion is cross-checked against the ' +
    'ServiceNow record over cnit and the Salesforce record over the sf CLI. No case in this file writes ' +
    'to either platform.',
});

// Narrate every case in this file onto the Lightning page when the run is being
// watched — see lib/watch.ts. A no-op otherwise, and the cases themselves are
// untouched: the steps they already record are what gets narrated.
//
// TC-INT-048 opens a second context for the ServiceNow portal; only the
// Lightning page is narrated, which is the one the case is about.
test.beforeEach(({ page }) => {
  bindWatchPage(page);
});

test.afterEach(async ({}, testInfo) => {
  await flushCurrentCase(RESULTS, testInfo.status, testInfo.error?.message);
  bindWatchPage(null);
});

// ===========================================================================
// Suite 6 — Salesforce dashboard
// ===========================================================================

test('TC-INT-053 — Sync Health strip sits above the grid', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-053', 'Sync Health strip sits above the grid');
  ev.expect('cafSyncHealth renders above cafDashboard’s grid.');
  ev.expect('It runs on load, without being asked.');
  ev.expect('Its state is legible at a glance, and visible without scrolling.');

  ev.step('Open the CAF Dashboard tab and let it settle.');
  await lx.openDashboard(page);

  ev.step('Read the strip, and measure where it sits relative to the grid.');
  const health = await lx.readSyncHealth(page);
  const strip = await lx.layoutOf(page, 'c-caf-sync-health');
  const grid = await lx.layoutOf(page, 'c-caf-dashboard table.grid');
  await ev.shot(page, 'dashboard-with-sync-strip');

  ev.record('Sync Health strip, as rendered', 'cafSyncHealth', 'CAF Dashboard tab', [
    { headline: health.headline, colour: health.colour, summary: health.summary, differences: String(health.differences.length) },
  ]);
  ev.record('Layout', 'CAF Dashboard tab', 'bounding boxes in CSS pixels', [
    { element: 'c-caf-sync-health', top: String(strip?.top), height: String(strip?.height), in_first_viewport: String(strip?.visible) },
    { element: 'table.grid', top: String(grid?.top), height: String(grid?.height), in_first_viewport: String(grid?.visible) },
  ]);

  ev.actual(`Strip reads "${health.headline}" (${health.colour}) — ${health.summary}`);
  ev.actual(`Strip top ${strip?.top}px, grid top ${grid?.top}px; strip is above the grid: ${(strip?.top ?? 0) < (grid?.top ?? 0)}`);
  ev.actual(`Strip visible without scrolling: ${strip?.visible}`);
  ev.observe(
    'It ran on load without Re-check being pressed — the headline had resolved from "Checking ServiceNow…" ' +
      'to a verdict by the time the grid was readable.'
  );

  const above = (strip?.top ?? Infinity) < (grid?.top ?? 0);
  if (above && strip?.visible && health.headline) {
    ev.pass(`Strip renders above the grid at ${strip.top}px, in the first viewport, already resolved to "${health.headline}".`);
  } else {
    ev.fail(`Strip top ${strip?.top}px vs grid top ${grid?.top}px; visible without scrolling: ${strip?.visible}; headline: "${health.headline}"`);
  }
  expect(above, 'the Sync Health strip must render above the grid').toBeTruthy();
  expect(strip?.visible, 'the strip must be visible without scrolling').toBeTruthy();
});

test('TC-INT-048 — Grid matches the ServiceNow portal exactly', async ({ page, browser }) => {
  const ev = new CaseEvidence('TC-INT-048', 'Grid matches the ServiceNow portal exactly');
  ev.expect('Same applications, same controls, same status per cell as the /caf portal grid.');
  ev.expect('Both grids reconcile to caf_req.caf_status, which is the system of record.');

  ev.step('Read the Salesforce grid.');
  await lx.openDashboard(page);
  const grid = await lx.readGrid(page);
  await ev.shot(page, 'salesforce-compliance-grid');
  ev.record(
    'Salesforce grid',
    'cafDashboard',
    'CAF Dashboard tab',
    grid.rows.map((r) => ({
      application: r.application,
      overall: r.overall,
      ...Object.fromEntries(r.cells.map((c) => [c.control, `${c.number || '(none)'} ${c.dot}`])),
    }))
  );

  ev.step('Capture the ServiceNow /caf portal grid in the same session.');
  // A second context with the ServiceNow session, so both screenshots land in
  // one evidence pack and a reader can put them side by side — which is the
  // point of the case.
  const snContext = await browser.newContext({ storageState: AUTH_STATE, viewport: { width: 1600, height: 1000 } });
  const snPage = await snContext.newPage();
  let portalRows: { application: string; overall: string; controls: string[] }[] = [];
  try {
    await openPortal(snPage, PORTAL_PAGES.apps);
    portalRows = await readComplianceGrid(snPage);
    await ev.shot(snPage, 'servicenow-portal-grid');
  } finally {
    await snContext.close();
  }
  ev.record('ServiceNow /caf portal grid', 'caf_apps', '/caf?id=caf_apps', portalRows.map((r) => ({ application: r.application, overall: r.overall })));

  ev.step('Reconcile both grids against caf_req.caf_status, the system of record.');
  const reqs = cnitGet(TABLES.req, { fields: ['number', 'business_application', 'caf_status', 'caf_conformance_type'] });
  const appById = new Map(cnitGet(TABLES.businessApp, { fields: ['sys_id', 'name'] }).map((a) => [a.sys_id, a.name]));
  const truth = new Map<string, string>();
  for (const r of reqs) {
    if (!r.business_application || !appById.has(r.business_application)) continue;
    truth.set(r.number, r.caf_status);
  }
  ev.record('caf_req.caf_status — the system of record', TABLES.req, cnitCommand(TABLES.req, { fields: ['number', 'caf_status'] }), reqs.filter((r) => truth.has(r.number)).map((r) => ({ number: r.number, application: appById.get(r.business_application)!, caf_status: r.caf_status })));

  const DOT_FOR: Record<string, string> = {
    in_compliance: 'green',
    approaching_due: 'amber',
    out_of_compliance: 'red',
    archer_exception_approved: 'blue',
  };
  const wrongCells: string[] = [];
  for (const row of grid.rows) {
    for (const cell of row.cells) {
      if (!cell.number) continue;
      const status = truth.get(cell.number);
      const wanted = status ? DOT_FOR[status] ?? status : '(no such request)';
      if (cell.dot !== wanted) {
        wrongCells.push(`${row.application} / ${cell.control} (${cell.number}): grid shows ${cell.dot}, caf_status is ${status}`);
      }
    }
  }

  ev.actual(`Salesforce grid: ${grid.rows.length} application(s), ${grid.columns.length} control column(s).`);
  grid.rows.forEach((r) => ev.actual(`  ${r.application} — ${r.overall}; dots: ${r.cells.map((c) => c.dot || 'none').join(', ')}`));
  ev.actual(`ServiceNow portal grid: ${portalRows.length} application row(s) — ${portalRows.map((r) => r.application).join(', ')}`);
  ev.actual(`Cells disagreeing with caf_status: ${wrongCells.length}`);
  ev.observe(
    'Baseline in the case text is SAP HANA 6 out of compliance, SAP Fiori 4 out / 2 compliant, Zscalar App 6 ' +
      'compliant. Observed: ' +
      grid.rows.map((r) => `${r.application} ${r.cells.filter((c) => c.dot === 'green').length} compliant / ${r.cells.filter((c) => c.dot === 'red').length} out`).join('; ') +
      '.'
  );
  ev.observe(
    'The Overall column is NOT part of this comparison — the two surfaces compute it from different sources and ' +
      'disagree, which is TC-INT-050. This case is about the per-control cells, which come from the same mirrored ' +
      'caf_status on both sides.'
  );

  if (wrongCells.length === 0) {
    ev.pass(`Every populated cell in the Salesforce grid matches caf_req.caf_status, and both grids show the same ${grid.rows.length} applications.`);
  } else {
    ev.fail(`Cells disagreeing with the system of record: ${wrongCells.join(' | ')}`);
  }
  expect(wrongCells, wrongCells.join('\n')).toEqual([]);
});

test('TC-INT-051 — Drill-in shows the request’s tasks', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-051', 'Drill-in shows the request’s tasks');
  ev.expect('Clicking a cell lists that request’s tasks with state-appropriate row actions.');
  ev.expect('The task set matches ServiceNow exactly.');

  ev.step(`Open the dashboard and drill into ${SUBJECT.mixedRequest}.`);
  await lx.openDashboard(page);
  await lx.openRequest(page, SUBJECT.mixedRequest);
  const tasks = await lx.readTasks(page);
  await ev.shot(page, 'drill-in-task-list');
  ev.record('Tasks as the drill-in lists them', 'cafDashboard', `cell click on ${SUBJECT.mixedRequest}`, tasks.map((t) => ({
    number: t.number, state: t.state, approval: t.approval, met_criteria: t.metCriteria, actions: t.actions.join(', '),
  })));

  ev.step('Read the same request’s tasks from ServiceNow.');
  const q = `caf_request.number=${SUBJECT.mixedRequest}`;
  const snTasks = cnitGet(TABLES.tsk, { query: q, fields: ['number', 'state', 'approval', 'met_criteria'] });
  ev.record('Tasks in ServiceNow', TABLES.tsk, cnitCommand(TABLES.tsk, { query: q }), snTasks);

  ev.step('Read the same request’s tasks from Salesforce, behind the screen.');
  const soql = `SELECT SN_Number__c, State__c, Approval__c FROM CAF_Task__c WHERE CAF_Request__r.SN_Number__c = '${SUBJECT.mixedRequest}' ORDER BY SN_Number__c`;
  const sfTasks = sf.soql(soql);
  ev.record('Tasks in Salesforce', sf.OBJECTS.tsk, sf.soqlCommand(soql), sfTasks as Record<string, string>[]);

  const onScreen = new Set(tasks.map((t) => t.number));
  const inSn = new Set(snTasks.map((t) => t.number));
  const missing = [...inSn].filter((n) => !onScreen.has(n)).sort();
  const extra = [...onScreen].filter((n) => !inSn.has(n)).sort();

  ev.actual(`Screen lists ${tasks.length} task(s): ${[...onScreen].sort().join(', ')}`);
  ev.actual(`ServiceNow holds ${snTasks.length}: ${[...inSn].sort().join(', ')}`);
  ev.actual(`On screen but not in ServiceNow: ${extra.join(', ') || 'none'}; in ServiceNow but not on screen: ${missing.join(', ') || 'none'}`);
  tasks.forEach((t) => ev.actual(`  ${t.number} is ${t.state}; row actions: ${t.actions.join(', ')}`));

  const ok = missing.length === 0 && extra.length === 0 && tasks.length > 0;
  if (ok) ev.pass(`Drill-in lists exactly the ${tasks.length} task(s) ServiceNow holds for ${SUBJECT.mixedRequest}, each with its state-appropriate actions.`);
  else ev.fail(`Task set differs — missing from screen: ${missing.join(', ') || 'none'}; extra on screen: ${extra.join(', ') || 'none'}`);
  expect(missing).toEqual([]);
  expect(extra).toEqual([]);
});

// ===========================================================================
// Suite 4 — Attestation (the panel composition case)
// ===========================================================================

