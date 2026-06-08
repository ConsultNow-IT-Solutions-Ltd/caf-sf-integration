import { test, expect } from '@playwright/test';
import { runBackgroundScript } from './background';

/**
 * One-off repair for two problems the first seeding pass created.
 *
 * **Duplicate numbers.** `sys_number_counter` for CAF Request stood at 1091 and
 * for CAF Task at 1094, while the records the application shipped with already
 * ran up to RCAF0001042 and CAFT0001042 — the counter rows were created from
 * `sys_number.number` (1000) and never reconciled against the data. Nothing had
 * inserted a CAF Request on this instance since, so it had never shown. Seeding
 * 84 of them walked the counter straight back through the occupied range and
 * issued 18 request numbers and 27 task numbers that already existed. A
 * duplicate number is not cosmetic here: `sysIdForNumber` in the test pack
 * takes the first row it finds, the Salesforce mirror shows two records with the
 * same `SN_Number__c`, and a person looking up RCAF0001022 gets whichever the
 * list sorts first.
 *
 * The fix renumbers only the records this seed created — anything from the
 * original nineteen keeps the number it has always had — into a clean block
 * starting at 1101, then lifts both counters clear of it.
 *
 * **Six surplus requests.** Zoho Email holds six requests created at 17:00 that
 * belong to no application: they were dragged there by a repoint keyed on
 * request number, back when numbers were still ambiguous, and phase 3 has since
 * created replacements for all six on Employee Helpdesk and Travel Booking.
 *
 * They are cancelled and detached from their business application rather than
 * deleted. That takes them out of both grids by the route the application
 * already uses for RCAF0001001 — the Apex read model filters
 * `Business_Application__c != null` — it travels to Salesforce on the ordinary
 * push with no manual cleanup there, and it is reversible. A delete would
 * propagate to neither system and would need the Salesforce rows removing by
 * hand. Say the word and they can be deleted properly instead.
 *
 *   npx playwright test seed/repair-numbering.seed.ts --project=seed
 */

/** Everything this seed created carries a timestamp after this. */
const SEEDED_AFTER = '2026-08-08 16:00:00';

/** First number of the clean block. Above CAFT0001094, the highest in use. */
const BLOCK_START = 1101;

/** Where both counters are parked, clear of the renumbered block. */
const COUNTER = 1300;

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('detach the six surplus requests', async ({ page }) => {
  const out = await runBackgroundScript(
    page,
    `
var ba = new GlideRecord('cmdb_ci_business_app');
ba.addQuery('name', 'Zoho Email');
ba.setLimit(1);
ba.query();
if (!ba.next()) { gs.print('no Zoho Email CI'); }
else {
  var r = new GlideRecord('x_gskn2_caf_compli_caf_req');
  r.addQuery('business_application', ba.getUniqueValue());
  r.addQuery('sys_created_on', '>', ${JSON.stringify(SEEDED_AFTER)});
  r.query();
  var n = 0;
  while (r.next()) {
    gs.print('detaching ' + r.getValue('number') + ' (' + r.caf_conformance_type.caf_conformance_type.getDisplayValue() + ')');
    // Cancelling first: CAF - Request cancelled process cancels the request's
    // tasks, and it needs the business application still in place to do it.
    r.setValue('state', '-1');
    r.setValue('active', false);
    r.update();

    r.setValue('business_application', '');
    r.setValue('short_description', 'Superseded - detached by seed repair');
    r.update();
    n++;
  }
  gs.print('detached ' + n + ' requests');
}
`
  );
  console.log(out);
  expect(out).toContain('detached');
});

test('renumber the seeded records and lift the counters', async ({ page }) => {
  const out = await runBackgroundScript(
    page,
    `
function pad(n) {
  var s = '' + n;
  while (s.length < 7) { s = '0' + s; }
  return s;
}

/**
 * Renumber every record of one table created by the seed whose number still
 * falls in the range that was already occupied. Ordered by creation time so a
 * re-run is stable, and skipped once a record is already in the clean block,
 * which is what makes this safe to run twice.
 */
function renumber(table, prefix, start) {
  var gr = new GlideRecord(table);
  gr.addQuery('sys_created_on', '>', ${JSON.stringify(SEEDED_AFTER)});
  gr.orderBy('sys_created_on');
  gr.orderBy('number');
  gr.query();

  var next = start, done = 0, skipped = 0;
  while (gr.next()) {
    var current = gr.getValue('number') || '';
    var suffix = parseInt(current.replace(prefix, ''), 10);
    if (suffix >= start) { skipped++; continue; }

    gr.setValue('number', prefix + pad(next));
    gr.update();
    next++;
    done++;
  }
  gs.print(table + ': ' + done + ' renumbered from ' + prefix + pad(start) +
           ', ' + skipped + ' already in the clean block');
  return next;
}

renumber('x_gskn2_caf_compli_caf_req', 'RCAF', ${BLOCK_START});
renumber('x_gskn2_caf_compli_caf_tsk', 'CAFT', ${BLOCK_START});

// The live counter is sys_number_counter, not sys_number - the latter still
// reads 1000 on this instance and is only the seed value the counter row was
// created from. Setting sys_number alone would have changed nothing.
var counters = ['CAF Request', 'CAF Task'];
for (var i = 0; i < counters.length; i++) {
  var c = new GlideRecord('sys_number_counter');
  c.addEncodedQuery('table.label=' + counters[i]);
  c.query();
  while (c.next()) {
    gs.print('counter ' + counters[i] + ': ' + c.getValue('number') + ' -> ' + ${COUNTER});
    c.setValue('number', ${COUNTER});
    c.update();
  }
}
`
  );
  console.log(out);
  expect(out, 'nothing was renumbered').toContain('renumbered');
});
