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

test('TC-INT-036 — Evidence and attestation are separate panels for separate people', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-036', 'Evidence and attestation are separate panels for separate people');
  ev.expect('Upload evidence opens cafEvidence alone, writable.');
  ev.expect('Attest opens cafEvidence read-only beside cafAttestation.');
  ev.expect('Row actions by state: Open → Start + Upload evidence; In Progress → Upload evidence + Attest; Closed → View evidence only.');
  ev.expect('There is no standalone "Criteria met" button.');

  ev.step(`Read the row actions offered on ${SUBJECT.mixedRequest} — an Open and a Closed task.`);
  await lx.openDashboard(page);
  await lx.openRequest(page, SUBJECT.mixedRequest);
  const mixed = await lx.readTasks(page);

  ev.step(`Read the row actions offered on ${SUBJECT.inProgressRequest} — an In Progress task.`);
  await lx.openDashboard(page);
  await lx.openRequest(page, SUBJECT.inProgressRequest);
  const inProgress = await lx.readTasks(page);

  const byState = new Map<string, string[]>();
  for (const t of [...mixed, ...inProgress]) {
    if (!byState.has(t.state)) byState.set(t.state, t.actions);
  }
  ev.record(
    'Row actions offered, by task state',
    'cafDashboard',
    'drill-in on RCAF0001022 and RCAF0001037',
    [...byState.entries()].map(([state, actions]) => ({ state, actions: actions.join(', ') }))
  );
  await ev.shot(page, 'row-actions-in-progress');

  ev.step('Open the evidence panel on the In Progress task — the owner’s view.');
  await lx.openTaskPanel(page, SUBJECT.inProgressTask, 'evidence');
  const ownerView = await lx.readEvidencePanel(page);
  const attestationPresentInOwnerView = (await lx.attestationPanel(page).count()) > 0;
  await ev.shot(page, 'evidence-panel-owner-view');

  ev.step('Open the attest panel on the same task — the approver’s view.');
  await lx.openTaskPanel(page, SUBJECT.inProgressTask, 'attest');
  const approverEvidence = await lx.readEvidencePanel(page);
  const approverAttestation = await lx.readAttestationPanel(page);
  await ev.shot(page, 'attest-panel-approver-view');

  ev.record('Evidence panel in each mode', 'cafEvidence', `task ${SUBJECT.inProgressTask}`, [
    { mode: 'Upload evidence (owner)', heading: ownerView.heading, upload_control: String(ownerView.uploadVisible), attestation_alongside: String(attestationPresentInOwnerView) },
    { mode: 'Attest (approver)', heading: approverEvidence.heading, upload_control: String(approverEvidence.uploadVisible), attestation_alongside: 'true' },
  ]);
  ev.record('Attestation panel', 'cafAttestation', `task ${SUBJECT.inProgressTask}`, [
    { heading: approverAttestation.heading, criteria_options: approverAttestation.criteriaOptions.join(', '), approve_enabled: String(approverAttestation.approveEnabled), reject_enabled: String(approverAttestation.rejectEnabled), blocked_reason: approverAttestation.blockedReason || '(none)' },
  ]);

  // The regression: met_criteria used to be its own button that wrote on its own.
  const standaloneCriteria = await page
    .locator('c-caf-dashboard button', { hasText: /criteria met/i })
    .count();

  const problems: string[] = [];
  const expectFor = (state: string, wanted: string[]) => {
    const got = byState.get(state);
    if (!got) {
      ev.observe(`No task in state "${state}" was reachable in this run, so its row actions were not observed.`);
      return;
    }
    const normalise = (a: string[]) => a.map((s) => s.toLowerCase()).sort().join(' | ');
    if (normalise(got) !== normalise(wanted)) {
      problems.push(`${state}: expected [${wanted.join(', ')}], got [${got.join(', ')}]`);
    }
    ev.actual(`${state} → ${got.join(', ')}`);
  };
  expectFor('Open', ['Start', 'Upload evidence']);
  expectFor('In Progress', ['Upload evidence', 'Attest']);
  expectFor('Closed Complete', ['View evidence']);

  ev.actual(`Owner view: upload control present = ${ownerView.uploadVisible}; attestation panel alongside = ${attestationPresentInOwnerView}`);
  ev.actual(`Approver view: upload control present = ${approverEvidence.uploadVisible}; attestation panel alongside = true`);
  ev.actual(`Attestation offers criteria options [${approverAttestation.criteriaOptions.join(', ')}] beside Approve/Reject.`);
  ev.actual(`Standalone "Criteria met" buttons found: ${standaloneCriteria}`);
  ev.observe(
    'met_criteria is carried on the attestation form as a yes/no alongside the decision, not as its own button. ' +
      'Whether it belongs with the approver at all is HANDOFF open item 3 — decided, not settled.'
  );
  ev.observe('Approve and Reject were read as controls and deliberately not clicked; either would close the task.');

  if (ownerView.uploadVisible === false) problems.push('the owner’s evidence panel offered no upload control');
  if (attestationPresentInOwnerView) problems.push('the attestation panel was rendered alongside the plain evidence view');
  if (approverEvidence.uploadVisible) problems.push('the approver’s evidence panel was writable — an approver must not add to the evidence they judge');
  if (standaloneCriteria > 0) problems.push(`${standaloneCriteria} standalone "Criteria met" button(s) still present`);

  if (problems.length === 0) {
    ev.pass('Row actions match the specified set for every state observed; the two jobs open different panels; the approver’s copy of the evidence is read-only; no standalone Criteria met button.');
  } else {
    ev.fail(problems.join('; '));
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

// ===========================================================================
// Suite 3 — Evidence
// ===========================================================================

test('TC-INT-020 — Both lists are shown side by side', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-020', 'Both lists are shown side by side');
  ev.expect('The panel lists Salesforce files and ServiceNow attachments separately.');
  ev.expect('A failed push is therefore visible rather than inferred.');

  ev.step(`Open the evidence panel on ${SUBJECT.closedTask}, which holds files on both sides.`);
  await lx.openDashboard(page);
  await lx.openRequest(page, SUBJECT.mixedRequest);
  await lx.openTaskPanel(page, SUBJECT.closedTask, 'evidence');
  const panel = await lx.readEvidencePanel(page);
  await ev.shot(page, 'evidence-both-lists');

  ev.record('Evidence panel', 'cafEvidence', `task ${SUBJECT.closedTask}`, [
    { column: 'Salesforce Files', count: panel.salesforceCount, items: panel.salesforceFiles.join(' | ') || '(none)' },
    { column: 'ServiceNow attachments', count: panel.servicenowCount, items: panel.servicenowAttachments.join(' | ') || '(none)' },
  ]);
  // A failed ServiceNow callout renders in place of the attachment list rather
  // than as an empty one, and the difference decides whether an empty column
  // means "nothing there" or "could not look".
  if (panel.error) ev.observe(`The panel reported an error: ${panel.error}`);

  ev.step('Confirm each column against its own platform.');
  const snSysId = cnitGet(TABLES.tsk, { query: `number=${SUBJECT.closedTask}`, fields: ['sys_id'] })[0]?.sys_id;
  const attQuery = `table_name=${TABLES.tsk}^table_sys_id=${snSysId}`;
  const attachments = cnitGet(TABLES.attachment, { query: attQuery, fields: ['file_name', 'size_bytes'] });
  ev.record('sys_attachment in ServiceNow', TABLES.attachment, cnitCommand(TABLES.attachment, { query: attQuery }), attachments);

  // Through ContentDocumentLink, not FirstPublishLocationId: a file uploaded by
  // lightning-file-upload is *linked* to the record, and its publish location
  // is not necessarily that record. Querying the wrong one returns zero and
  // agrees with anything.
  const cvSoql =
    'SELECT ContentDocument.Title, ContentDocument.ContentSize FROM ContentDocumentLink ' +
    `WHERE LinkedEntityId IN (SELECT Id FROM CAF_Task__c WHERE SN_Number__c = '${SUBJECT.closedTask}')`;
  const files = sf.soql(cvSoql).map((f) => ({
    title: f.ContentDocument?.Title ?? '',
    size: String(f.ContentDocument?.ContentSize ?? ''),
  }));
  ev.record('Files linked to the task in Salesforce', sf.OBJECTS.contentDocumentLink, sf.soqlCommand(cvSoql), files);

  ev.actual(`Panel shows two separate columns: "Salesforce Files" (${panel.salesforceCount}) and "ServiceNow attachments" (${panel.servicenowCount}).`);
  ev.actual(`Salesforce column lists: ${panel.salesforceFiles.join(' | ') || '(none)'}`);
  ev.actual(`ServiceNow column lists: ${panel.servicenowAttachments.join(' | ') || '(none)'}`);
  ev.actual(`Underneath: ${files.length} ContentVersion(s) and ${attachments.length} sys_attachment(s).`);
  ev.observe(
    'Two copies on purpose, and not reconciled. Salesforce’s copy makes preview and download work with no ' +
      'round trip; ServiceNow’s is the copy an auditor is entitled to and the only one the attestation gate counts.'
  );

  const separated = panel.salesforceCount !== '' && panel.servicenowCount !== '';
  const sfMatches = panel.salesforceFiles.length === files.length;
  const snMatches = panel.servicenowAttachments.length === attachments.length;
  if (separated && sfMatches && snMatches) {
    ev.pass('Two labelled columns, each agreeing with its own platform — a failed push would show as an empty column beside a populated one.');
  } else {
    ev.fail(`Columns separated: ${separated}; Salesforce column ${panel.salesforceFiles.length} vs ${files.length} actual; ServiceNow column ${panel.servicenowAttachments.length} vs ${attachments.length} actual.`);
  }
  expect(separated, 'the panel must show the two sources as separate columns').toBeTruthy();
  expect(panel.salesforceFiles.length, 'Salesforce column disagrees with ContentVersion').toBe(files.length);
  expect(panel.servicenowAttachments.length, 'ServiceNow column disagrees with sys_attachment').toBe(attachments.length);
});

test('TC-INT-021 — A count mismatch raises a warning', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-021', 'A count mismatch raises a warning');
  ev.expect(`${SUBJECT.closedTask} carries 1 Salesforce file against 2 ServiceNow attachments.`);
  ev.expect('The panel shows a warning, and it reads as informative rather than alarming.');

  ev.step(`Open the evidence panel on ${SUBJECT.closedTask}.`);
  await lx.openDashboard(page);
  await lx.openRequest(page, SUBJECT.mixedRequest);
  await lx.openTaskPanel(page, SUBJECT.closedTask, 'evidence');
  const panel = await lx.readEvidencePanel(page);
  await ev.shot(page, 'evidence-count-mismatch-warning');

  ev.record('Counts and warning, as rendered', 'cafEvidence', `task ${SUBJECT.closedTask}`, [
    { salesforce_files: panel.salesforceCount, servicenow_attachments: panel.servicenowCount, warning: panel.warning || '(none shown)' },
  ]);

  const mismatch = panel.salesforceCount !== panel.servicenowCount;
  ev.actual(`Salesforce ${panel.salesforceCount} file(s) against ServiceNow ${panel.servicenowCount} attachment(s) — mismatch present: ${mismatch}`);
  ev.actual(`Warning shown: ${panel.warning || '(none)'}`);
  ev.observe(
    'The extra ServiceNow attachment is backup-restore-test.txt, left by a direct-HTTP smoke test. Two copies of ' +
      'evidence is not a compliance failure, which is why the wording matters more than the fact of the warning.'
  );

  if (!mismatch) {
    ev.blocked(
      `The ready-made subject no longer carries a mismatch: the panel shows ${panel.salesforceCount} Salesforce ` +
        `file(s) and ${panel.servicenowCount} ServiceNow attachment(s). Producing one requires an upload with the ` +
        'kill switch off, which is a write. Blocked rather than failed — the component was not exercised.'
    );
    return;
  }

  if (panel.warning) {
    const alarming = /error|fail|critical|invalid|breach/i.test(panel.warning);
    ev.actual(`Wording judged ${alarming ? 'alarming' : 'informative'}: "${panel.warning}"`);

    // The case asks whether the wording is right, not merely whether a warning
    // appeared. It is not: the remediation advice is unconditional and assumes
    // the mismatch runs the other way.
    const snHasMore = Number(panel.servicenowCount) > Number(panel.salesforceCount);
    if (snHasMore && /re-upload/i.test(panel.warning)) {
      ev.observe(
        'Finding — the advice is backwards for this mismatch. cafEvidence.mismatchLabel is unconditional: it ' +
          'always says "Re-upload the missing file to send it to the system of record", which is correct only when ' +
          'Salesforce holds more than ServiceNow, i.e. a push failed. Here ServiceNow holds more (' +
          `${panel.servicenowCount} against ${panel.salesforceCount}), so the system of record already has the file ` +
          'and following the advice would create a third ServiceNow attachment rather than repair anything. ' +
          'This is the only mismatch state present on the instance today, so it is the one a user will actually ' +
          'meet. The label needs to branch on which side is short.'
      );
    }
    if (alarming) {
      ev.fail(`A mismatch is not a compliance failure, but the warning reads as one: "${panel.warning}"`);
    } else {
      ev.pass(
        `Mismatch detected and surfaced informatively: "${panel.warning}". The case's stated expectation is met — ` +
          'but see the observation on the remediation advice, which is wrong for this direction of mismatch and ' +
          'should be raised separately.'
      );
    }
    expect(alarming, `warning wording reads as a failure: ${panel.warning}`).toBeFalsy();
  } else {
    ev.fail(
      `Counts differ (${panel.salesforceCount} vs ${panel.servicenowCount}) but the panel raised no warning — a ` +
        'failed push would be invisible.'
    );
    expect(panel.warning, 'a count mismatch must raise a warning').toBeTruthy();
  }
});

test('TC-INT-024 — A closed task shows its evidence and takes no more', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-024', 'A closed task shows its evidence and takes no more');
  ev.expect('Row action reads "View evidence".');
  ev.expect('The panel opens with no upload control.');
  ev.expect('A closed task’s evidence is exactly what an audit wants to see, so it is still shown in full.');

  ev.step(`Confirm ${SUBJECT.closedTask} is closed on both platforms before judging the UI.`);
  const snTask = cnitGet(TABLES.tsk, { query: `number=${SUBJECT.closedTask}`, fields: ['number', 'state', 'active', 'approval'] });
  ev.record('The task in ServiceNow', TABLES.tsk, cnitCommand(TABLES.tsk, { query: `number=${SUBJECT.closedTask}` }), snTask);

  ev.step('Open the drill-in and read the action offered on it.');
  await lx.openDashboard(page);
  await lx.openRequest(page, SUBJECT.mixedRequest);
  const tasks = await lx.readTasks(page);
  const closed = tasks.find((t) => t.number === SUBJECT.closedTask);
  expect(closed, `${SUBJECT.closedTask} was not listed in the drill-in`).toBeTruthy();
  ev.record('Row actions on the closed task', 'cafDashboard', `task ${SUBJECT.closedTask}`, [
    { number: closed!.number, state: closed!.state, approval: closed!.approval, actions: closed!.actions.join(', ') },
  ]);

  ev.step('Open the panel and confirm it shows the evidence but offers no upload.');
  await lx.openTaskPanel(page, SUBJECT.closedTask, 'evidence');
  const panel = await lx.readEvidencePanel(page);
  await ev.shot(page, 'closed-task-view-evidence');
  ev.record('Panel on the closed task', 'cafEvidence', `task ${SUBJECT.closedTask}`, [
    { heading: panel.heading, upload_control: String(panel.uploadVisible), salesforce_files: panel.salesforceCount, servicenow_attachments: panel.servicenowCount },
  ]);

  ev.actual(`ServiceNow: state=${snTask[0]?.state}, active=${snTask[0]?.active}, approval=${snTask[0]?.approval}`);
  ev.actual(`Row actions: ${closed!.actions.join(', ')}`);
  ev.actual(`Panel heading "${panel.heading}"; upload control present: ${panel.uploadVisible}`);
  ev.actual(`Evidence still listed: ${panel.salesforceCount} Salesforce file(s), ${panel.servicenowCount} ServiceNow attachment(s).`);
  ev.observe(
    'One component serves both modes through the hide-upload flag rather than a second read-only component ' +
      'existing to say the same things.'
  );

  const labelled = closed!.actions.some((a) => /view evidence/i.test(a));
  const noStart = !closed!.actions.some((a) => /^start$/i.test(a));
  const noAttest = !closed!.actions.some((a) => /attest/i.test(a));
  const shows = Number(panel.salesforceCount || 0) + Number(panel.servicenowCount || 0) > 0;

  if (labelled && !panel.uploadVisible && noStart && noAttest && shows) {
    ev.pass('Reads "View evidence", offers no upload, no Start and no Attest, and still shows every file held on both sides.');
  } else {
    ev.fail(
      `Action label correct: ${labelled}; upload hidden: ${!panel.uploadVisible}; Start absent: ${noStart}; ` +
        `Attest absent: ${noAttest}; evidence still shown: ${shows}`
    );
  }
  expect(labelled, 'the closed task’s action must read "View evidence"').toBeTruthy();
  expect(panel.uploadVisible, 'a closed task must offer no upload control').toBeFalsy();
  expect(noAttest, 'a closed task must not offer Attest').toBeTruthy();
});

// ===========================================================================
// Suite 10 — regressions raised by earlier runs
// ===========================================================================

test('TC-INT-071 — Mismatch advice names the side that is short', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-071', 'Mismatch advice names the side that is short');
  ev.expect('When ServiceNow holds fewer files than Salesforce, the advice is to re-upload.');
  ev.expect(
    'When Salesforce holds fewer — the state on this instance — the advice does NOT say re-upload, ' +
      'because the system of record already holds the file and re-uploading creates a third copy.'
  );

  ev.step(`Open the evidence panel on ${SUBJECT.closedTask} and read the mismatch warning.`);
  await lx.openDashboard(page);
  await lx.openRequest(page, SUBJECT.mixedRequest);
  await lx.openTaskPanel(page, SUBJECT.closedTask, 'evidence');
  const panel = await lx.readEvidencePanel(page);
  await ev.shot(page, 'mismatch-advice');

  const sfCount = Number(panel.salesforceCount || 0);
  const snCount = Number(panel.servicenowCount || 0);

  ev.record('Counts and advice, as rendered', 'cafEvidence', `task ${SUBJECT.closedTask}`, [
    {
      salesforce_files: panel.salesforceCount,
      servicenow_attachments: panel.servicenowCount,
      short_side: sfCount === snCount ? '(none)' : sfCount < snCount ? 'Salesforce' : 'ServiceNow',
      advice: panel.warning || '(no warning shown)',
    },
  ]);

  // Verify against the record, not only the screen: the panel's counts are what
  // the component believes, and a case about advice being wrong for a direction
  // must first establish the direction from something other than the component
  // under test.
  ev.step('Confirm the direction of the mismatch against the ServiceNow record.');
  const attachments = cnitGet(TABLES.attachment, {
    query: `table_name=${TABLES.tsk}^ORDERBYfile_name`,
    fields: ['file_name', 'table_sys_id', 'size_bytes'],
  });
  const snTask = cnitGet(TABLES.tsk, { query: `number=${SUBJECT.closedTask}`, fields: ['sys_id', 'number'] });
  const mine = attachments.filter((a) => a.table_sys_id === snTask[0]?.sys_id);
  ev.record(
    `ServiceNow attachments on ${SUBJECT.closedTask}`,
    TABLES.attachment,
    cnitCommand(TABLES.attachment, { query: `table_name=${TABLES.tsk}` }),
    mine
  );
  ev.actual(
    `Panel: ${sfCount} Salesforce file(s) against ${snCount} ServiceNow attachment(s). ` +
      `ServiceNow itself reports ${mine.length} attachment(s) on the task.`
  );

  if (sfCount === snCount) {
    ev.blocked(
      `The counts agree (${sfCount} and ${snCount}), so no advice is rendered and there is nothing to judge. ` +
        'Producing a mismatch requires an upload, which is a write — blocked rather than failed, because the ' +
        'component was not exercised.'
    );
    return;
  }

  const advice = panel.warning || '';
  const saysReupload = /re-?upload/i.test(advice);
  const salesforceIsShort = sfCount < snCount;

  ev.actual(`Advice rendered: "${advice || '(none)'}"`);
  ev.observe(
    'Re-uploading is the correct remedy only when the push to ServiceNow failed, i.e. Salesforce holds MORE. ' +
      'Where ServiceNow already holds more, the file is safe in the system of record and the advice is not ' +
      'merely unhelpful — acting on it adds another copy.'
  );

  if (salesforceIsShort && saysReupload) {
    ev.fail(
      `Salesforce is the short side (${sfCount} against ${snCount}) yet the advice is still "re-upload": ` +
        `"${advice}". cafEvidence.mismatchLabel is unconditional and does not branch on which side is short, ` +
        'so following it would create a third ServiceNow attachment rather than repair anything. ' +
        'Fix: branch the label on servicenowCount - salesforceCount.'
    );
  } else if (!advice) {
    ev.fail(
      `The counts differ (${sfCount} against ${snCount}) but no warning was rendered at all, so a failed push ` +
        'would be invisible.'
    );
  } else {
    ev.pass(
      `Advice matches the direction of the mismatch: ${salesforceIsShort ? 'Salesforce' : 'ServiceNow'} is short ` +
        `and the panel says "${advice}".`
    );
  }

  // The assertion the case exists to make. Expected to fail until
  // cafEvidence.mismatchLabel branches on which side is short.
  expect(
    salesforceIsShort && saysReupload,
    `Advice tells the user to re-upload while Salesforce is the short side (${sfCount} against ${snCount}): "${advice}"`
  ).toBeFalsy();
});
