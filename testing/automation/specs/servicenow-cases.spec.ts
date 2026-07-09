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

test('TC-SN-006 — state is read-only on the request but writable on the task', async ({ page }) => {
  const ev = new CaseEvidence('TC-SN-006', 'state is read-only on the request but writable on the task');
  ev.expect('caf_req.state.read_only = true — a request\'s state moves only through business rules and flows.');
  ev.expect('caf_tsk.state.read_only = false — a task\'s state can be set directly.');

  ev.step('Read both dictionary entries.');
  // nameIN..^element=state, not name=a^element=state^ORname=b^element=state.
  // In an encoded query ^OR binds only to the condition immediately before it,
  // so the latter parses as (req AND state) OR (tsk) AND state and quietly
  // returns the wrong rows.
  const dicts = await tableApi(page, 'sys_dictionary', {
    query: `nameIN${TABLES.req},${TABLES.tsk}^element=state`,
    fields: ['name', 'element', 'read_only', 'default_value'],
    limit: 5,
  });
  ev.record('state field, both tables', 'sys_dictionary', 'caf_req.state and caf_tsk.state', dicts);

  const reqState = dicts.find((d) => d.name === TABLES.req);
  const tskState = dicts.find((d) => d.name === TABLES.tsk);
  ev.actual(`Dictionary: caf_req.state read_only=${reqState?.read_only}, caf_tsk.state read_only=${tskState?.read_only}`);

  expect(reqState?.read_only).toBe('true');
  expect(tskState?.read_only).toBe('false');

  ev.step('Open an Open CAF Task form and ask g_form whether state is editable there.');
  const sysId = await sysIdForNumber(page, TABLES.tsk, 'CAFT0001001');
  await openForm(page, TABLES.tsk, sysId);
  await ev.shot(page, 'caft0001001-form');

  const formStateRO = await isFieldReadOnly(page, 'state');
  const formApprovalRO = await isFieldReadOnly(page, 'approval');
  const formDescMandatory = await isFieldMandatory(page, 'description');
  ev.record('Form introspection via g_form', TABLES.tsk, 'CAFT0001001 (state=1, Open)', [
    {
      field_state_readOnly: String(formStateRO),
      field_approval_readOnly: String(formApprovalRO),
      field_description_mandatory: String(formDescMandatory),
    },
  ]);
  ev.actual(`Form: state readOnly=${formStateRO}, approval readOnly=${formApprovalRO}, description mandatory=${formDescMandatory}`);

  if (formStateRO === true) {
    ev.observe(
      'GAP: the dictionary makes caf_tsk.state writable, but the form reports it read-only on an OPEN task. ' +
        'Something on the form — most likely the client script "CAF Task On Load Logic" — is locking it.'
    );
    ev.observe(
      'Consequence: state is writable by the API but not through the native form. Either TC-SN-026 needs rewriting, ' +
        'or a task cannot be started from the ServiceNow form at all, which is an unstated workflow claim.'
    );
    ev.fail(
      'The dictionary and the form disagree about caf_tsk.state. The dictionary assertion passes; the form contradicts it. ' +
        'Referred for a decision on intended behaviour before this is classed as a defect.'
    );
  } else {
    ev.pass('Dictionary and form agree.');
  }

  // Assert last, so the evidence is complete before the run goes red. A case
  // that fails must show red in the run as well as in its document — a green
  // run beside a failing verdict is exactly the inconsistency that makes people
  // stop trusting the pack.
  expect(
    formStateRO,
    'caf_tsk.state is writable in the dictionary but read-only on the form'
  ).toBe(false);
});

test('TC-SN-008 — choice values match the documented set exactly', async ({ page }) => {
  const ev = new CaseEvidence('TC-SN-008', 'Choice values match the documented set exactly');
  ev.expect('state, caf_status, approval, met_criteria and priority carry exactly the documented values, with no inactive rows.');

  ev.step('Read every choice on caf_req and caf_tsk.');
  const choices = await tableApi(page, 'sys_choice', {
    query: `name=${TABLES.req}^ORname=${TABLES.tsk}^ORDERBYname^ORDERBYelement^ORDERBYsequence`,
    fields: ['name', 'element', 'value', 'label', 'inactive'],
    limit: 100,
  });
  ev.record('All choices', 'sys_choice', 'caf_req and caf_tsk', choices);

  const inactive = choices.filter((c) => c.inactive === 'true');
  ev.actual(`${choices.length} choice values found; ${inactive.length} inactive.`);

  const expectations: Record<string, string[]> = {
    [`${TABLES.req}.state`]: ['1', '2', '3', '-1'],
    [`${TABLES.req}.caf_status`]: ['in_compliance', 'approaching_due', 'out_of_compliance', 'archer_exception_approved'],
    [`${TABLES.tsk}.approval`]: ['requested', 'approved', 'rejected', 'cancelled'],
    [`${TABLES.tsk}.met_criteria`]: ['yes', 'no'],
  };

  const mismatches: string[] = [];
  for (const [key, want] of Object.entries(expectations)) {
    const [table, element] = [key.slice(0, key.lastIndexOf('.')), key.slice(key.lastIndexOf('.') + 1)];
    const got = choices.filter((c) => c.name === table && c.element === element).map((c) => c.value).sort();
    if (JSON.stringify(got) !== JSON.stringify([...want].sort())) {
      mismatches.push(`${key}: expected [${want}], found [${got}]`);
    }
  }

  mismatches.forEach((m) => ev.observe(`MISMATCH ${m}`));
  if (mismatches.length === 0 && inactive.length === 0) {
    ev.pass('All choice sets match, no inactive values.');
  } else {
    ev.fail(`${mismatches.length} choice set(s) differ; ${inactive.length} inactive value(s).`);
  }
  expect(mismatches).toEqual([]);
});

test('TC-SN-017 — business application flips to Compliant only when every control is compliant', async ({ page }) => {
  const ev = new CaseEvidence(
    'TC-SN-017',
    'Business application flips to Compliant only when every control is compliant'
  );
  ev.expect('cmdb_ci_business_app.u_caf_compliance_status reads "compliant" only when EVERY CAF Request for that application is in_compliance.');
  ev.expect('An application with any out_of_compliance control must not read compliant.');

  ev.step('Read the compliance status of the three demo business applications.');
  const apps = await tableApi(page, TABLES.businessApp, {
    query: 'nameINSAP HANA,SAP Fiori,Zscalar App',
    fields: ['sys_id', 'name', 'u_caf_compliance_status'],
    limit: 10,
  });
  ev.record('Business applications', TABLES.businessApp, 'nameINSAP HANA,SAP Fiori,Zscalar App', apps);

  ev.step('For each application, read the CAF Requests it claims to summarise.');
  const violations: string[] = [];
  const summary: Record<string, string>[] = [];

  for (const app of apps) {
    const reqs = await tableApi(page, TABLES.req, {
      query: `business_application=${app.sys_id}`,
      fields: ['number', 'caf_status', 'state', 'active'],
      limit: 50,
    });
    if (!reqs.length) continue;

    const out = reqs.filter((r) => r.caf_status === 'out_of_compliance').length;
    const inC = reqs.filter((r) => r.caf_status === 'in_compliance').length;
    const consistent = !(app.u_caf_compliance_status === 'compliant' && out > 0);

    ev.record(`Requests for ${app.name} (${app.sys_id})`, TABLES.req, `business_application=${app.sys_id}`, reqs);
    summary.push({
      application: app.name,
      sys_id: app.sys_id,
      u_caf_compliance_status: app.u_caf_compliance_status,
      controls_compliant: String(inC),
      controls_out_of_compliance: String(out),
      consistent: consistent ? 'YES' : 'NO',
    });

    if (!consistent) {
      violations.push(
        `${app.name} (${app.sys_id}) reads "compliant" while ${out} of ${reqs.length} controls are out_of_compliance`
      );
    }
  }

  ev.record('Roll-up reconciliation', '(derived)', 'business application status vs its controls', summary);

  ev.step('Open the /caf compliance grid and confirm what a user is shown.');
  await openPortal(page, PORTAL_PAGES.apps);
  await ev.shot(page, 'caf-compliance-grid');
  const grid = await readComplianceGrid(page);
  const shown = grid.filter((g) => ['SAP HANA', 'SAP Fiori', 'Zscalar App'].includes(g.application));
  ev.record(
    'Grid as rendered to the user',
    '/caf?id=caf_apps',
    'Overall Conformance Status column',
    shown.map((s) => ({ application: s.application, overall_status_shown: s.overall }))
  );

  ev.actual(
    violations.length
      ? `${violations.length} application(s) report Compliant while holding out-of-compliance controls: ${violations.join('; ')}`
      : 'Every application\'s status is consistent with its controls.'
  );

  if (violations.length) {
    ev.observe(
      'The /caf grid renders u_caf_compliance_status faithfully, so it displays "Compliant" beside red control dots. ' +
        'The grid is not at fault; the field it reads is wrong.'
    );
    ev.observe(
      'Suspected cause: business rule "CAF - update BA when req compliant" (after update, order 1500, ' +
        'filter caf_statusCHANGESTOin_compliance) sets the application compliant whenever ANY request goes compliant, ' +
        'without checking whether its siblings still are not.'
    );
    ev.observe(
      'This falsifies HANDOFF section 3: "An app is compliant only when every control is, matching the ServiceNow widget." ' +
        'The Salesforce LWC is documented as mirroring that behaviour, so the same wrong answer is likely on both platforms — see TC-INT-050.'
    );
    ev.fail(
      `${violations.length} business application(s) are reported compliant while controls are out of compliance. ` +
        'Severity: high — this is the headline number on the compliance dashboard.'
    );
  } else {
    ev.pass('Roll-up is correct for all three demo applications.');
  }

  expect(violations, `Compliance roll-up violations: ${violations.join(' | ')}`).toEqual([]);
});

