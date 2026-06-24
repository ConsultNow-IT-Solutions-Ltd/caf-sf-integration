import { test, expect } from '@playwright/test';
import * as lx from '../lib/lightning';

/**
 * Harness smoke check for lib/lightning.ts. **Not a test case** — it files no
 * verdict and writes nothing to results/.
 *
 * Its job is to fail loudly if a template rename breaks the selectors, so that
 * a real case never fails for a reason that has nothing to do with the
 * application. Every step here only reads.
 */
test('smoke: the Lightning helpers reach every surface the UI cases need', async ({ page }) => {
  await lx.openDashboard(page);

  const grid = await lx.readGrid(page);
  console.log(`[smoke] grid: ${grid.rows.length} row(s), ${grid.columns.length} column(s)`);
  console.log(`[smoke] columns: ${grid.columns.join(' | ')}`);
  for (const r of grid.rows) {
    console.log(
      `[smoke]   ${r.application.padEnd(14)} overall="${r.overall}" (${r.overallColour}) ` +
        `dots=[${r.cells.map((c) => c.dot || '-').join(',')}]`
    );
  }
  expect(grid.columns.length, 'grid rendered no control columns').toBeGreaterThan(0);
  expect(grid.rows.length, 'grid rendered no application rows').toBeGreaterThan(0);
  expect(
    grid.rows.every((r) => r.cells.length === grid.columns.length),
    'a row has a different number of cells than there are columns — the readGrid selectors have drifted'
  ).toBeTruthy();

  const health = await lx.readSyncHealth(page);
  console.log(`[smoke] sync health: "${health.headline}" (${health.colour}) — ${health.summary}`);
  console.log(`[smoke] differences listed: ${health.differences.length}`);
  expect(health.headline, 'sync health strip never resolved to a headline').toBeTruthy();

  // Drill in on whichever request the grid actually offers, rather than a
  // hard-coded number that a later case may have consumed.
  const firstCell = grid.rows.flatMap((r) => r.cells).find((c) => c.number && !c.disabled);
  expect(firstCell, 'no enabled grid cell to drill into').toBeTruthy();

  await lx.openRequest(page, firstCell!.number);
  const tasks = await lx.readTasks(page);
  console.log(`[smoke] ${firstCell!.number}: ${tasks.length} task(s)`);
  tasks.forEach((t) => console.log(`[smoke]   ${t.number} ${t.state} — actions: ${t.actions.join(', ')}`));
  expect(tasks.length, `drill-in on ${firstCell!.number} listed no tasks`).toBeGreaterThan(0);

  // The evidence action exists in every state — only its label changes — so it
  // is the one panel that can be opened without depending on task state. It
  // reads ServiceNow and writes nothing.
  const anyTask = tasks[0];
  await lx.openTaskPanel(page, anyTask.number, 'evidence');
  const panel = await lx.readEvidencePanel(page);
  console.log(`[smoke] evidence panel for ${anyTask.number}: heading="${panel.heading}", upload visible=${panel.uploadVisible}`);
  console.log(
    `[smoke]   Salesforce Files (${panel.salesforceCount}): ${panel.salesforceFiles.join(' / ') || '(none)'}`
  );
  console.log(
    `[smoke]   ServiceNow attachments (${panel.servicenowCount}): ${panel.servicenowAttachments.join(' / ') || '(none)'}`
  );
  if (panel.warning) console.log(`[smoke]   warning: ${panel.warning}`);
  expect(panel.bodyText, 'evidence panel rendered empty').toBeTruthy();
  expect(panel.heading, 'evidence panel has no heading').toContain(anyTask.number);

  await lx.shot(page, 'PROBE', 'lightning-harness-smoke');
  console.log('[smoke] all helpers reached their targets; screenshot written to evidence/PROBE/');
});
