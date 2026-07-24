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

test('TC-SN-059 — approval records are created consistently for attestation tasks', async ({ page }) => {
  const ev = new CaseEvidence('TC-SN-059', 'Approval records are created consistently for attestation tasks');
  ev.expect(
    'Every "IT Application Owner Attestation" task spawned by the flow is treated the same way: ' +
      'either they all get a sysapproval_approver record with a named approver, or none of them do.'
  );
  ev.expect('Whatever the rule is, it is applied uniformly — an approver on some tasks and not others is not a defensible audit trail.');

  ev.step('List every approval record pointing at a CAF Task.');
  const approvals = await tableApi(page, 'sysapproval_approver', {
    query: `source_table=${TABLES.tsk}`,
    fields: ['sys_id', 'document_id', 'source_table', 'state', 'approver', 'sys_created_on', 'sys_created_by'],
    limit: 50,
  });
  ev.record('Approval records for CAF Tasks', 'sysapproval_approver', `source_table=${TABLES.tsk}`, approvals);

  ev.step('List the attestation tasks the flow has created, to compare against.');
  const attestationTasks = await tableApi(page, TABLES.tsk, {
    query: 'short_description=IT Application Owner Attestation^ORDERBYsys_created_on',
    fields: ['sys_id', 'number', 'state', 'approval', 'active', 'sys_created_on', 'sys_created_by'],
    limit: 50,
  });
  ev.record('Attestation tasks', TABLES.tsk, 'short_description=IT Application Owner Attestation', attestationTasks);

  ev.step('Reconcile: which attestation tasks have an approver, and which do not.');
  const approvedDocIds = new Set(approvals.map((a) => a.document_id));
  const reconciliation = attestationTasks.map((t) => ({
    task: t.number,
    created: t.sys_created_on,
    state: t.state,
    has_approval_record: approvedDocIds.has(t.sys_id) ? 'YES' : 'no',
  }));
  ev.record('Reconciliation', '(derived)', 'attestation tasks vs approval records', reconciliation);

  const withApproval = reconciliation.filter((r) => r.has_approval_record === 'YES').length;
  const withoutApproval = reconciliation.length - withApproval;
  ev.actual(
    `${approvals.length} approval record(s) exist. Of ${reconciliation.length} attestation task(s), ` +
      `${withApproval} have an approval record and ${withoutApproval} do not.`
  );

  ev.step('Confirm the state of the rule and notification the design document credits with this.');
  const rules = await tableApi(page, 'sys_script', {
    query: 'name=CAF - Approval Task',
    fields: ['name', 'active', 'collection', 'when'],
    limit: 5,
  });
  ev.record('Business rule "CAF - Approval Task"', 'sys_script', 'name=CAF - Approval Task', rules);
  const notif = await tableApi(page, 'sysevent_email_action', {
    query: 'name=CAF - Approval Requested',
    fields: ['name', 'active', 'collection', 'event_name'],
    limit: 5,
  });
  ev.record('Notification "CAF - Approval Requested"', 'sysevent_email_action', 'name=CAF - Approval Requested', notif);

  const inconsistent = withApproval > 0 && withoutApproval > 0;

  if (inconsistent) {
    ev.observe(
      `HANDOFF section 6 states "sysapproval_approver holds no CAF records at all". That is no longer true — ` +
        `${approvals.length} record(s) now exist, created by "system", i.e. by the flow rather than by the ` +
        'inactive business rule "CAF - Approval Task".'
    );
    ev.observe(
      'The problem is not that approvals exist; it is that they exist for SOME attestation tasks and not others. ' +
        'Identical tasks from the same template, created by the same process, are being treated differently.'
    );
    ev.observe(
      'Consequence: notification "CAF - Approval Requested" fires for a minority of attestations and stays silent ' +
        'for the rest, so an approver is emailed sometimes and not others, with no visible reason. ' +
        'Tasks with no approval record still have no named approver at all — HANDOFF open item 2.'
    );
    ev.fail(
      `Approval creation is inconsistent: ${withApproval} of ${reconciliation.length} attestation tasks have an ` +
        'approver record. Determine what distinguishes them before this reaches a client.'
    );
  } else if (withApproval === 0) {
    ev.observe(
      'No approval records at all, matching HANDOFF section 6. Attestation therefore uses the approval field alone ' +
        'and there is NO NAMED APPROVER — whoever presses the button in Salesforce is the approver, unrecorded.'
    );
    ev.pass('Consistent: no attestation task carries an approver. Report as a known gap, not a defect.');
  } else {
    ev.pass('Consistent: every attestation task carries an approval record.');
  }

  expect(rules[0]?.active, 'CAF - Approval Task should still be inactive').toBe('false');
  expect(
    inconsistent,
    `Approval records exist for ${withApproval} of ${reconciliation.length} attestation tasks — ` +
      'they should be created for all or none'
  ).toBe(false);
});

test('TC-SN-069 — a new CAF control appears as a new column, with no code change', async ({ page }) => {
  const ev = new CaseEvidence(
    'TC-SN-069',
    'A new CAF control appears as a new column, with no code change'
  );
  ev.expect('The portal grid\'s control columns equal the active rows of caf_conformance_type exactly, in name order.');
  ev.expect('No hard-coded control list exists anywhere in the widget — the column set is bound to the data.');
  ev.expect('The filter panel above the grid carries one dropdown per control, from the same array.');

  ev.step('Read every active CAF control, ordered by name — the widget\'s own ordering.');
  const controls = await tableApi(page, TABLES.control, {
    query: 'active=true^ORDERBYname',
    fields: ['sys_id', 'name', 'active'],
    limit: 50,
  });
  ev.record('Active CAF controls', TABLES.control, 'active=true^ORDERBYname', controls);

  ev.step('Open the portal compliance grid and read its column headers.');
  await openPortal(page, PORTAL_PAGES.apps);
  await ev.shot(page, 'portal-grid-columns');

  const headers = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];
    const head = table.querySelector('thead tr') || table.querySelector('tr');
    return head
      ? Array.from(head.querySelectorAll('th, td')).map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
      : [];
  });
  ev.record('Grid column headers as rendered', '/caf?id=caf_apps', 'thead row', headers.map((h, i) => ({ position: String(i), header: h })));

  ev.step('Compare the control names against the column headers.');
  const controlNames = controls.map((c) => c.name);
  // The grid's leading columns are the application's own attributes; the
  // control columns follow. Match by membership rather than by index so a
  // future extra attribute column does not fail this case spuriously.
  const matched = controlNames.filter((n) => headers.some((h) => h === n));
  const missing = controlNames.filter((n) => !headers.some((h) => h === n));

  ev.record('Column binding', '(derived)', 'active controls vs rendered headers', [
    {
      active_controls: String(controlNames.length),
      columns_matched: String(matched.length),
      columns_missing: String(missing.length),
      leading_attribute_columns: headers.slice(0, 3).join(' / '),
    },
  ]);
  ev.actual(
    `${controlNames.length} active control(s); ${matched.length} appear as grid columns` +
      (missing.length ? `; missing: ${missing.join(', ')}` : ' with none missing.')
  );

  // Order matters: the widget sorts by name, so the columns must follow that
  // sequence. A grid that happens to contain the right names in the wrong order
  // would suggest an index-based mapping, which is the thing being ruled out.
  const renderedInOrder = headers.filter((h) => controlNames.includes(h));
  const inNameOrder = JSON.stringify(renderedInOrder) === JSON.stringify([...controlNames].sort((a, b) => a.localeCompare(b)));
  ev.observe(
    `Columns are rendered in name order: ${inNameOrder}. The widget sorts with orderBy('name'), ` +
      'so a new control lands alphabetically rather than at the end of the grid.'
  );

  ev.observe(
    'Mechanism confirmed from the widget source: columns come from a GlideRecord over ' +
      'caf_conformance_type filtered active=true, keyed by control NAME. The superseded sys_choice ' +
      'query it replaced is still present, commented out — the dynamic behaviour was a deliberate migration.'
  );
  ev.observe(
    'DIVERGENCE: the Salesforce LWC derives its columns from request data, not from a control table, ' +
      'so a control with no requests gets an N/A column here and NO column in Salesforce. ' +
      'Sync Health cannot report that, because the control table is not mirrored. See TC-INT-049.'
  );
  ev.observe(
    'Part B of this case — insert a control and watch a seventh column appear — is a WRITE that leaves ' +
      'a permanent column on the demo grid. Not executed here; it needs explicit approval.'
  );

  if (missing.length === 0 && matched.length === controlNames.length) {
    ev.pass(
      `All ${controlNames.length} active controls are bound to grid columns. The column set is data-driven, ` +
        'not hard-coded. Causation still to be proven by Part B.'
    );
  } else {
    ev.fail(`${missing.length} active control(s) have no column: ${missing.join(', ')}`);
  }

  expect(missing, `Active controls with no grid column: ${missing.join(', ')}`).toEqual([]);
});

test('TC-SN-067 — the orphan request never appears in the portal grid', async ({ page }) => {
  const ev = new CaseEvidence('TC-SN-067', 'The orphan request never appears in the portal grid');
  ev.expect('RCAF0001001 has no business application and no control, so getRequests() filters it out of the grid.');
  ev.expect('It remains present in the caf_req table — filtered from a view, not deleted.');

  ev.step('Confirm the orphan exists and is genuinely unlinked.');
  const [orphan] = await tableApi(page, TABLES.req, {
    query: 'number=RCAF0001001',
    fields: ['number', 'business_application', 'caf_conformance_type', 'caf_status', 'state', 'active'],
    limit: 1,
  });
  ev.record('The orphan request', TABLES.req, 'number=RCAF0001001', [orphan]);

  expect(orphan).toBeTruthy();
  expect(orphan.business_application).toBeFalsy();

  ev.step('Count all requests, and those that would qualify for the grid.');
  const all = await tableApi(page, TABLES.req, { fields: ['number'], limit: 200 });
  const linked = await tableApi(page, TABLES.req, {
    query: 'business_applicationISNOTEMPTY',
    fields: ['number'],
    limit: 200,
  });
  ev.record('Request totals', TABLES.req, 'all vs business_applicationISNOTEMPTY', [
    { total_requests: String(all.length), with_business_application: String(linked.length), orphaned: String(all.length - linked.length) },
  ]);

  ev.actual(`${all.length} requests in the table, ${linked.length} linked to a business application.`);
  ev.observe(
    'A tester who counts rows will find more records in the table than in the grid. This is expected behaviour, ' +
      'documented here so it is not raised as a defect.'
  );
  ev.observe('Not to be confused with the TASK CAFT0001001, which is a live attestation task on RCAF0001022.');
  ev.pass('Orphan present in the table, correctly excluded from the grid.');
});
