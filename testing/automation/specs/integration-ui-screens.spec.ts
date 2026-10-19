import { test, expect } from '@playwright/test';
import { CaseEvidence, flushCurrentCase, describeRun, bindWatchPage } from '../lib/evidence';
import * as sf from '../lib/salesforce';
import * as lx from '../lib/lightning';
import { SF_LIGHTNING } from '../playwright.config';
import fs from 'fs';
import path from 'path';

/**
 * TEST-CASES-INTEGRATION.md, suite 11: the Approvals, Reports and Admin screens.
 *
 * Every case here checks a screen against the record it summarises: a number on
 * a tile is only evidence when the same number comes back from SOQL. The screens
 * are computed in the browser from the mirror, so a drift between the two means
 * the screen is wrong, not the data.
 *
 * Nothing here writes. Review opens the attestation panel, and its Approve and
 * Reject are read as controls and never pressed.
 *
 * Runs in the `sf-ui` project (testMatch integration-ui.*), which signs in to
 * Lightning first; the SOQL goes through the sf CLI as org alias caf-sf.
 */

const RESULTS = path.join(__dirname, '..', 'results');

/** CafApprovalsController.getQueue's LIMIT. */
const QUEUE_LIMIT = 500;

/** The four settings CafConfig reads. CafAdminController lists all of them. */
const SETTINGS = ['Callout_Timeout_Ms', 'Evidence_Max_Bytes', 'Logging_Enabled', 'ServiceNow_Task_Path'];

describeRun({
  instance: SF_LIGHTNING,
  executedBy: 'admin.070b86ccf531@agentforce.com (Salesforce)',
  executedVia:
    'Playwright driving Lightning Experience; every figure on screen is cross-checked against SOQL over ' +
    'the sf CLI. No case in this file writes to either platform.',
});

test.beforeEach(({ page }) => {
  bindWatchPage(page);
});

test.afterEach(async ({}, testInfo) => {
  await flushCurrentCase(RESULTS, testInfo.status, testInfo.error?.message);
  bindWatchPage(null);
});

/** The rows getRequests returns: the grid's filter, which Reports reuses. */
function gridRequests(): Record<string, any>[] {
  return sf.soql(
    'SELECT Id, SN_Number__c, Business_Application__c, CAF_Status__c FROM CAF_Request__c ' +
      'WHERE Business_Application__c != null AND CAF_Control__c != null LIMIT 2000'
  );
}

// ===========================================================================
// Suite 11 — Approvals, Reports and Admin screens
// ===========================================================================

test('TC-INT-072 — Screen tabs and deep links', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-072', 'Screen tabs and deep links');
  ev.expect('The CAF Dashboard tab shows four screens: Compliance, Approvals, Reports, Admin.');
  ev.expect('Compliance is selected on arrival, with the grid.');
  ev.expect('?c__view=<screen> opens on that screen, and clicking a tab writes it into the URL.');

  ev.step('Open the CAF Dashboard tab with no c__view.');
  await lx.openDashboard(page);
  const tabs = await lx.readScreenTabs(page);
  await ev.shot(page, 'arrival-compliance');
  ev.record('Tab bar', 'cafDashboard', 'CAF Dashboard tab', tabs.map((t) => ({ ...t, selected: String(t.selected) })));

  const labelsOk = tabs.map((t) => t.label).join('|') === 'Compliance|Approvals|Reports|Admin';
  const defaultOk = tabs.find((t) => t.selected)?.key === 'compliance';

  const opened: Record<string, boolean> = {};
  for (const view of ['approvals', 'reports', 'admin'] as const) {
    ev.step(`Open /lightning/n/CAF_Dashboard?c__view=${view}.`);
    const root = await lx.openScreen(page, view);
    opened[view] = await root.isVisible();
    const gridGone = (await lx.dashboard(page).locator('table.grid').count()) === 0;
    opened[view] = opened[view] && gridGone;
    await ev.shot(page, `deep-link-${view}`);
  }

  ev.step('From Reports, click the Approvals tab and read the URL.');
  await lx.dashboard(page).locator('[data-view="approvals"]').click();
  await expect(page).toHaveURL(/c__view=approvals/, { timeout: 20_000 });
  const urlAfterClick = page.url();
  ev.actual(`Tabs: ${tabs.map((t) => t.label).join(', ')}; selected on arrival: ${tabs.find((t) => t.selected)?.label}`);
  ev.actual(`Deep links opened their screen without the grid: ${JSON.stringify(opened)}`);
  ev.actual(`URL after clicking Approvals: ${urlAfterClick}`);

  const ok = labelsOk && defaultOk && Object.values(opened).every(Boolean);
  if (ok) ev.pass('Four tabs, Compliance by default, every deep link lands on its screen, and a click updates the URL.');
  else ev.fail(`labels ok: ${labelsOk}; default ok: ${defaultOk}; deep links: ${JSON.stringify(opened)}`);
  expect(labelsOk, 'tab labels').toBeTruthy();
  expect(defaultOk, 'Compliance must be the default screen').toBeTruthy();
  expect(Object.values(opened).every(Boolean), 'every c__view deep link must open its screen').toBeTruthy();
});

test('TC-INT-073 — Approvals queue is every In Progress task', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-073', 'Approvals queue is every In Progress task');
  ev.expect('The queue lists exactly the CAF_Task__c records with State__c = In Progress (up to 500).');
  ev.expect('The "Awaiting decision" tile equals that count.');

  ev.step('Query the mirror for In Progress tasks.');
  const records = sf.soql(
    "SELECT SN_Number__c FROM CAF_Task__c WHERE State__c = 'In Progress' ORDER BY SN_Number__c LIMIT 2000"
  );
  const expected = records.map((r) => r.SN_Number__c as string);
  ev.record('In Progress tasks', 'CAF_Task__c', "State__c = 'In Progress'", records.map((r) => ({ task: r.SN_Number__c })));

  ev.step('Open the Approvals screen and read the queue.');
  const root = await lx.openScreen(page, 'approvals');
  const tiles = await lx.readTiles(root);
  const shown = (await root.locator('table.queue tbody tr td:first-child').allInnerTexts()).map((s) => s.trim());
  await ev.shot(page, 'approvals-queue');

  const want = Math.min(expected.length, QUEUE_LIMIT);
  const missing = expected.filter((n) => !shown.includes(n));
  const extra = shown.filter((n) => !expected.includes(n));
  ev.actual(`SOQL: ${expected.length} In Progress task(s). Queue rows: ${shown.length}. Tile: ${tiles['Awaiting decision']}.`);
  if (missing.length) ev.actual(`Missing from the queue: ${missing.join(', ')}`);
  if (extra.length) ev.actual(`On the queue but not In Progress: ${extra.join(', ')}`);

  const ok =
    shown.length === want &&
    extra.length === 0 &&
    (expected.length > QUEUE_LIMIT || missing.length === 0) &&
    tiles['Awaiting decision'] === String(want);
  if (ok) ev.pass(`Queue holds the ${want} In Progress task(s) the mirror holds, and the tile agrees.`);
  else ev.fail(`queue ${shown.length} vs SOQL ${expected.length}; missing ${missing.length}; extra ${extra.length}`);
  expect(extra, 'queue rows that are not In Progress').toEqual([]);
  expect(shown.length).toBe(want);
  expect(tiles['Awaiting decision']).toBe(String(want));
});

test('TC-INT-074 — Review opens evidence read-only', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-074', 'Review opens evidence read-only');
  ev.expect('Review on a queued task opens the evidence and attestation panels for that task.');
  ev.expect('The evidence panel offers no upload: the approver judges evidence, and does not add to it.');

  ev.step('Open the Approvals screen.');
  const root = await lx.openScreen(page, 'approvals');
  const first = root.locator('table.queue tbody tr').filter({ has: page.locator('button:not([disabled])') }).first();
  if ((await first.count()) === 0) {
    ev.blocked('No In Progress task with a ServiceNow sys_id is queued, so there is nothing to review.');
    test.skip(true, 'empty approval queue');
    return;
  }
  const number = (await first.locator('td').first().innerText()).trim();

  ev.step(`Press Review on ${number}. (Approve and Reject are read, never pressed.)`);
  await first.locator('button').click();
  const panel = await lx.readEvidencePanel(page);
  const attest = root.locator('c-caf-attestation');
  await attest.waitFor({ state: 'visible', timeout: 60_000 });
  const heading = (await root.locator('.review__title').innerText()).trim();
  await ev.shot(page, 'review-panel');

  ev.record('Review panel', 'cafApprovals', number, [
    { heading, upload_visible: String(panel.uploadVisible), sf_files: panel.salesforceCount, sn_attachments: panel.servicenowCount },
  ]);
  ev.actual(`Heading "${heading}"; upload control visible: ${panel.uploadVisible}`);

  const ok = heading.includes(number) && !panel.uploadVisible;
  if (ok) ev.pass(`Review opened ${number} with the evidence panel read-only.`);
  else ev.fail(`heading "${heading}", upload visible ${panel.uploadVisible}`);
  expect(heading).toContain(number);
  expect(panel.uploadVisible, 'the approver view must not offer an upload').toBeFalsy();
});

test('TC-INT-075 — Reports figures match the mirror', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-075', 'Reports figures match the mirror');
  ev.expect('Requests assessed, Business applications and Out of compliance equal SOQL over the grid\'s rows.');
  ev.expect('The per-control totals add up to Requests assessed: no request is dropped from the bars.');

  ev.step('Query the rows the grid and the report are built from.');
  const rows = gridRequests();
  const apps = new Set(rows.map((r) => r.Business_Application__c)).size;
  const out = rows.filter((r) => r.CAF_Status__c === 'out_of_compliance').length;
  ev.record('Grid rows', 'CAF_Request__c', 'Business_Application__c != null AND CAF_Control__c != null', [
    { requests: String(rows.length), applications: String(apps), out_of_compliance: String(out) },
  ]);

  ev.step('Open the Reports screen and read the tiles and the per-control table.');
  const root = await lx.openScreen(page, 'reports');
  const tiles = await lx.readTiles(root);
  const totals = (await root.locator('table.bars tbody tr td.num:nth-of-type(2)').allInnerTexts()).map((s) => Number(s.trim()));
  const barSum = totals.reduce((a, b) => a + b, 0);
  await ev.shot(page, 'reports');

  ev.record('Reports tiles', 'cafReports', 'Reports screen', [{ ...tiles, per_control_sum: String(barSum) }]);
  ev.actual(`Tiles: ${JSON.stringify(tiles)}. Per-control totals sum to ${barSum}.`);

  const ok =
    tiles['Requests assessed'] === String(rows.length) &&
    tiles['Business applications'] === String(apps) &&
    tiles['Out of compliance'] === String(out) &&
    barSum === rows.length;
  if (ok) ev.pass(`${rows.length} requests across ${apps} applications, ${out} out of compliance, on screen and in SOQL.`);
  else ev.fail(`screen ${JSON.stringify(tiles)} / bars ${barSum} vs SOQL ${rows.length} requests, ${apps} apps, ${out} out`);
  expect(tiles['Requests assessed']).toBe(String(rows.length));
  expect(tiles['Business applications']).toBe(String(apps));
  expect(tiles['Out of compliance']).toBe(String(out));
  expect(barSum, 'per-control bars must add up to the request total').toBe(rows.length);
});

test('TC-INT-076 — CSV export carries the report rows, defused', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-076', 'CSV export carries the report rows, defused');
  ev.expect('Export CSV downloads one header line plus one line per request on the report.');
  ev.expect('No cell begins with =, +, - or @, so a spreadsheet will not run anything in it.');

  const rows = gridRequests();
  ev.step('Open Reports and press Export CSV.');
  const root = await lx.openScreen(page, 'reports');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    root.locator('button', { hasText: 'Export CSV' }).click(),
  ]);
  const file = path.join(RESULTS, 'TC-INT-076-' + download.suggestedFilename());
  await download.saveAs(file);
  const text: string = fs.readFileSync(file, 'utf8');
  const lines: string[] = text.split('\r\n').filter(Boolean);

  // Split on commas outside quotes, which is all this needs to read a cell's first character.
  const cells = lines.slice(1).flatMap((l) => l.match(/("([^"]|"")*"|[^,]*)(?=,|$)/g) ?? []);
  const live = cells.map((c) => c.replace(/^"/, '')).filter((c) => /^[=+\-@]/.test(c));

  ev.record('Export', 'cafReports', download.suggestedFilename(), [
    { lines: String(lines.length), header: lines[0] ?? '', live_formula_cells: String(live.length) },
  ]);
  ev.actual(`${lines.length - 1} data line(s) for ${rows.length} request(s); live formula cells: ${live.length}.`);

  const ok = lines.length - 1 === rows.length && live.length === 0 && /^Request,/.test(lines[0] ?? '');
  if (ok) ev.pass(`Export holds all ${rows.length} rows and no cell a spreadsheet would evaluate.`);
  else ev.fail(`${lines.length - 1} lines vs ${rows.length} requests; live formula cells: ${live.slice(0, 5).join(' | ')}`);
  expect(lines.length - 1).toBe(rows.length);
  expect(live, 'cells a spreadsheet would evaluate').toEqual([]);
});

test('TC-INT-077 — Admin lists every setting and control', async ({ page }) => {
  const ev = new CaseEvidence('TC-INT-077', 'Admin lists every setting and control');
  ev.expect('Every setting CafConfig reads is listed, whether or not a CAF_Setting__mdt record exists.');
  ev.expect('The control catalogue lists every CAF_Control_Catalog__c, inactive ones included, with the active count in its heading.');
  ev.expect('The callout log section renders: either the log, or the CAF Admin permission message - never an error.');

  ev.step('Query the control catalogue.');
  const controls = sf.soql('SELECT Name, Active__c FROM CAF_Control_Catalog__c LIMIT 200');
  const active = controls.filter((c) => c.Active__c).length;
  ev.record('Controls', 'CAF_Control_Catalog__c', 'all', controls.map((c) => ({ name: c.Name, active: String(c.Active__c) })));

  ev.step('Open the Admin screen.');
  const root = await lx.openScreen(page, 'admin');
  const settingNames = (await root.locator('th .api').allInnerTexts()).map((s) => s.trim());
  const sections = await root.locator('h3.section').allInnerTexts();
  const catalogueHeading = sections.find((s) => s.startsWith('Control catalogue')) ?? '';
  // The catalogue is the second table on the page: the log (if readable) comes first.
  const controlRows = await root.locator('table.tasks').filter({ hasText: 'SN number' }).locator('tbody tr').count();
  const hasLog = (await root.locator('table.tasks').filter({ hasText: 'Called at' }).count()) > 0;
  const hasPermMessage = (await root.getByText('needs the CAF Admin permission set').count()) > 0;
  const hasError = (await root.locator('.msg--error').count()) > 0;
  await ev.shot(page, 'admin');

  const missingSettings = SETTINGS.filter((s) => !settingNames.includes(s));
  ev.actual(`Settings listed: ${settingNames.join(', ')}`);
  ev.actual(`Catalogue rows ${controlRows} vs SOQL ${controls.length}; heading "${catalogueHeading.trim()}"`);
  ev.actual(`Log section: table ${hasLog}, permission message ${hasPermMessage}, error ${hasError}`);

  const ok =
    missingSettings.length === 0 &&
    controlRows === controls.length &&
    catalogueHeading.includes(`${active} active`) &&
    (hasLog || hasPermMessage) &&
    !hasError;
  if (ok) ev.pass(`All ${SETTINGS.length} settings and all ${controls.length} controls (${active} active) listed; log section rendered.`);
  else ev.fail(`missing settings ${missingSettings.join(', ') || 'none'}; controls ${controlRows}/${controls.length}; log ${hasLog}/${hasPermMessage}; error ${hasError}`);
  expect(missingSettings).toEqual([]);
  expect(controlRows).toBe(controls.length);
  expect(catalogueHeading).toContain(`${active} active`);
  expect(hasLog || hasPermMessage, 'the log section must render one way or the other').toBeTruthy();
  expect(hasError, 'the Admin screen must not show an error').toBeFalsy();
});
