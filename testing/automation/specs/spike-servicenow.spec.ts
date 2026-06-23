import { test, expect } from '@playwright/test';
import {
  TABLES,
  tableApi,
  sysIdForNumber,
  openForm,
  openList,
  openViaNav,
  openPortal,
  PORTAL_PAGES,
  readComplianceGrid,
  formValue,
  isFieldReadOnly,
  isFieldMandatory,
  evidence,
} from '../lib/servicenow';

/**
 * Feasibility spike — does Playwright drive this instance well enough to be
 * worth building 68 cases on?
 *
 * Read-only throughout. Nothing here inserts, updates or transitions anything,
 * so it can be re-run freely against the demo instance.
 *
 * Each test answers one question that changes the design of the suite. Failures
 * here are findings about the approach, not defects in the application.
 */

const findings: string[] = [];
const note = (s: string) => {
  findings.push(s);
  console.log(`  → ${s}`);
};

test.afterAll(() => {
  console.log('\n=== SPIKE FINDINGS ===');
  findings.forEach((f) => console.log(` • ${f}`));
  console.log('======================\n');
});

test('01 — the saved session reaches the instance and the Table API', async ({ page }) => {
  const rows = await tableApi(page, TABLES.req, { fields: ['number'], limit: 1000 });
  expect(rows.length).toBeGreaterThan(0);
  const tasks = await tableApi(page, TABLES.tsk, { fields: ['number'], limit: 1000 });

  note(`storageState session works. Table API visible: ${rows.length} requests, ${tasks.length} tasks.`);

  // Cross-check the baseline the test pack was written against. A mismatch is
  // not a failure — it means the instance moved, which the pack expects.
  if (rows.length !== 19 || tasks.length !== 30) {
    note(
      `Baseline drift: the case files assume 19 requests / 30 tasks, this run sees ` +
        `${rows.length} / ${tasks.length}. Update the baseline before a formal pass.`
    );
  }
});

test('02 — a record form renders standalone, with no navigation shell', async ({ page }) => {
  const sysId = await sysIdForNumber(page, TABLES.tsk, 'CAFT0001001');
  await openForm(page, TABLES.tsk, sysId);

  const frameCount = page.frames().length;
  const hasGsftMain = page.frames().some((f) => f.name() === 'gsft_main');

  await expect(page.locator('body')).toContainText('CAFT0001001', { timeout: 30_000 });
  await evidence(page, 'SPIKE-02', 'caf-task-form-standalone');

  note(
    `Direct \`${TABLES.tsk}.do?sys_id=\` renders the form as a top-level document ` +
      `(${frameCount} frame(s), gsft_main present: ${hasGsftMain}). ` +
      `${hasGsftMain ? 'Shell was injected anyway — specs must reach through the iframe.' : 'No iframe to reach through.'}`
  );
});

test('03 — g_form is reachable, so the UI can be asserted on directly', async ({ page }) => {
  const sysId = await sysIdForNumber(page, TABLES.tsk, 'CAFT0001001');
  await openForm(page, TABLES.tsk, sysId);

  const state = await formValue(page, 'state');
  const approval = await formValue(page, 'approval');

  if (state === null) {
    note('g_form is NOT reachable from the top-level document — UI assertions must use DOM selectors instead.');
    test.skip();
    return;
  }

  // Confirm the UI agrees with the record. This is the two-proof pattern every
  // case in the pack uses, exercised once here to prove it works.
  const [record] = await tableApi(page, TABLES.tsk, {
    query: 'number=CAFT0001001',
    fields: ['state', 'approval', 'active'],
    limit: 1,
  });

  expect(state, 'g_form and the Table API disagree about state').toBe(record.state);
  note(`g_form works. CAFT0001001 state="${state}", approval="${approval}"; Table API agrees (state=${record.state}).`);

  // The dictionary says approval is read-only and state is not. Proving the
  // form reflects that is what makes the read-only cases (TC-SN-006) automatable.
  const approvalRO = await isFieldReadOnly(page, 'approval');
  const stateRO = await isFieldReadOnly(page, 'state');
  const descMandatory = await isFieldMandatory(page, 'description');
  note(
    `Field introspection available: approval readOnly=${approvalRO}, state readOnly=${stateRO}, ` +
      `description mandatory=${descMandatory}. TC-SN-003/006/038/040 are automatable this way.`
  );
});

test('04 — a filtered list renders and its rows are readable', async ({ page }) => {
  await openList(page, TABLES.tsk, 'active=true^state=2');
  await page.waitForTimeout(2000);

  const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
  const rowMatches = bodyText.match(/CAFT\d{7}/g) ?? [];
  const unique = [...new Set(rowMatches)];

  await evidence(page, 'SPIKE-04', 'caf-task-list-in-progress');

  const expected = await tableApi(page, TABLES.tsk, {
    query: 'active=true^state=2',
    fields: ['number'],
    limit: 100,
  });

  note(
    `List view renders ${unique.length} task number(s) in the DOM; Table API says ${expected.length} match the same query.` +
      (unique.length === 0 ? ' Rows are NOT scrapable as plain text — list cases will need cell selectors.' : '')
  );
});

test('05 — the navigation shell and its gsft_main iframe are reachable', async ({ page }) => {
  const sysId = await sysIdForNumber(page, TABLES.tsk, 'CAFT0001001');

  try {
    const frame = await openViaNav(page, TABLES.tsk, sysId);
    await expect(frame.locator('body')).toContainText('CAFT0001001', { timeout: 30_000 });
    await evidence(page, 'SPIKE-05', 'caf-task-via-nav-shell');
    note('Nav shell works and gsft_main is addressable — available for cases that need the full chrome.');
  } catch (e) {
    note(
      `Nav shell path FAILED: ${(e as Error).message.split('\n')[0]}. ` +
        'Not blocking — the standalone form path (02) covers form cases; only chrome-dependent cases are affected.'
    );
  }
});

test('06 — the /caf Service Portal compliance grid renders and agrees with the records', async ({ page }) => {
  await openPortal(page, PORTAL_PAGES.apps);
  const grid = await readComplianceGrid(page);
  await evidence(page, 'SPIKE-06', 'caf-portal-compliance-grid');

  expect(grid.length, 'The compliance grid rendered no rows').toBeGreaterThan(0);
  note(`Portal grid at /caf?id=${PORTAL_PAGES.apps} renders ${grid.length} application row(s) and is scrapable.`);

  // Reconcile the grid's overall status against the records behind it, for the
  // three demo applications. This is the parity assertion TC-SN-066 is built on.
  const subjects = ['SAP HANA', 'SAP Fiori', 'Zscalar App'];
  for (const name of subjects) {
    const row = grid.find((r) => r.application === name);
    if (!row) {
      note(`"${name}" not found in the grid — check the baseline.`);
      continue;
    }

    const apps = await tableApi(page, TABLES.businessApp, {
      query: `name=${name}`,
      fields: ['sys_id', 'name', 'u_caf_compliance_status'],
      limit: 10,
    });
    if (apps.length > 1) {
      note(`DATA: "${name}" exists ${apps.length} times in cmdb_ci_business_app — filtering by name is ambiguous.`);
    }

    // Compare the rolled-up status against the controls it claims to summarise.
    const withRequests = [];
    for (const app of apps) {
      const reqs = await tableApi(page, TABLES.req, {
        query: `business_application=${app.sys_id}`,
        fields: ['number', 'caf_status'],
        limit: 50,
      });
      if (reqs.length) withRequests.push({ app, reqs });
    }

    for (const { app, reqs } of withRequests) {
      const out = reqs.filter((r) => r.caf_status === 'out_of_compliance').length;
      const inC = reqs.filter((r) => r.caf_status === 'in_compliance').length;
      const claimsCompliant = app.u_caf_compliance_status === 'compliant';

      if (claimsCompliant && out > 0) {
        note(
          `DEFECT: "${name}" (${app.sys_id}) has u_caf_compliance_status=compliant ` +
            `while ${out} of its ${reqs.length} controls are out_of_compliance (${inC} compliant). ` +
            'An application must be compliant only when every control is.'
        );
      } else {
        note(`"${name}": status=${app.u_caf_compliance_status}, controls ${inC} in / ${out} out — consistent.`);
      }
    }
  }
});

test('07 — screenshots are captured at usable quality for an evidence pack', async ({ page }) => {
  const sysId = await sysIdForNumber(page, TABLES.req, 'RCAF0001022');
  await openForm(page, TABLES.req, sysId);
  const file = await evidence(page, 'SPIKE-07', 'caf-request-form');

  const fs = await import('fs');
  const bytes = fs.statSync(file).size;
  expect(bytes).toBeGreaterThan(10_000);
  note(`Full-page screenshot captured, ${Math.round(bytes / 1024)} KB. Evidence pipeline input is ready.`);
});
