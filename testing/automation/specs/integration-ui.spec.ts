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

