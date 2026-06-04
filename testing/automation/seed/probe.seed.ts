import { test } from '@playwright/test';
import { runBackgroundScript } from './background';

/**
 * Read-only probe: prove Scripts - Background runs, and prove it can see the
 * scoped tables from wherever it lands, before anything writes.
 */
test('background script probe', async ({ page }) => {
  await page.goto('/');

  const out = await runBackgroundScript(
    page,
    [
      "gs.print('user=' + gs.getUserName() + ' scope=' + gs.getCurrentScopeName());",
      "var r = new GlideRecord('x_gskn2_caf_compli_caf_req'); r.query();",
      "gs.print('caf_req readable=' + r.getRowCount());",
      "var b = new GlideRecord('cmdb_ci_business_app'); b.query();",
      "gs.print('business_app readable=' + b.getRowCount());",
      "var t = new GlideRecord('x_gskn2_caf_compli_caf_tsk'); t.query();",
      "gs.print('caf_tsk readable=' + t.getRowCount());",
    ].join('\n')
  );

  console.log('----- background output -----\n' + out + '\n-----------------------------');
});
