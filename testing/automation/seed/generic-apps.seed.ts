import { test, expect } from '@playwright/test';
import { runBackgroundScript } from './background';
import { APPS, APPS_TO_CREATE, CONTROLS, REPOINTS, STATUS, SeedApp } from './data';

/**
 * Seed the demo estate: eighteen generic business applications on the CAF
 * compliance grid instead of three SAP/Zscalar ones.
 *
 * Everything is written in ServiceNow and nothing at all in Salesforce. The
 * Salesforce grid has no app list in it — its rows are the distinct
 * `Business_Application__c` values across the mirrored `CAF_Request__c` records
 * — so the way to change what it shows is to change what ServiceNow holds and
 * let the existing async push business rules carry it over. Writing rows into
 * Salesforce directly would put the mirror ahead of its source, which is
 * exactly the drift `CafSyncHealth` exists to catch.
 *
 * Five phases, each idempotent against seed/data.ts. Re-running after editing
 * the matrix converges on the new matrix rather than creating a second estate.
 *
 *   npx playwright test seed/generic-apps.seed.ts --project=seed
 */

/** Sabrina Deppert — the assignee already on every existing CAF Request. */
const PERSON = 'b6826bf03710200044e0bfc8bcbe5df8';

/** Tier the new CIs are stamped with, and the relationship set requests use. */
const TIER = 'Tier 0';

/** Embed a value as a JS string literal the background script can JSON.parse. */
function literal(value: unknown): string {
  return JSON.stringify(JSON.stringify(value));
}

/**
 * Helpers every phase's script starts with.
 *
 * `shift` is days from now, negative for the past. Dates carry real weight
 * here: the nightly *CAF - Update CAF request status if overdue* job at 23:00
 * rewrites `caf_status` to out_of_compliance on any **active** request whose
 * planned completion date has passed, so anything meant to stay green or amber
 * has to be either closed or dated into the future. Get that wrong and the
 * whole grid turns red overnight with nothing in the logs to explain it.
 */
const PRELUDE = `
function shift(days) {
  var g = new GlideDateTime();
  g.addDaysUTC(days);
  return g.getValue();
}
function relationshipFor(controlName) {
  var rel = new GlideRecord('x_gskn2_caf_compli_caf_relationship');
  rel.addQuery('active', true);
  rel.addQuery('tier', ${JSON.stringify(TIER)});
  rel.addQuery('caf_conformance_type.name', controlName);
  rel.setLimit(1);
  rel.query();
  return rel.next() ? rel.getUniqueValue() : '';
}
function appSysId(name) {
  var ba = new GlideRecord('cmdb_ci_business_app');
  ba.addQuery('name', name);
  ba.orderBy('sys_created_on');
  ba.setLimit(1);
  ba.query();
  return ba.next() ? ba.getUniqueValue() : '';
}
/**
 * The request driving one cell of the grid: newest request for this
 * application against this *control*.
 *
 * Keyed on the control, not on the relationship. A control is reachable through
 * three relationships — one per tier — and the requests already on this
 * instance do not all use the same one: Zscalar App and SAP Fiori were raised
 * against the Tier 0 set, SAP HANA against Tier 1. Keying on the relationship
 * sys_id made an existing request invisible whenever it came in through a
 * different tier, and the seed duly created a second one for the same control.
 * Both grids column on the control, so the control is the identity that
 * matters, and this is the same join the ServiceNow portal widget uses
 * (caf_conformance_type.caf_conformance_type).
 */
function requestForControl(baId, controlName) {
  var r = new GlideRecord('x_gskn2_caf_compli_caf_req');
  r.addQuery('business_application', baId);
  r.addQuery('caf_conformance_type.caf_conformance_type.name', controlName);
  r.orderByDesc('sys_created_on');
  r.setLimit(1);
  r.query();
  return r.next() ? r : null;
}
`;

async function run(page: import('@playwright/test').Page, script: string): Promise<string> {
  const out = await runBackgroundScript(page, PRELUDE + '\n' + script);
  console.log(out);
  // Every phase prints FAILED / MISSING / SKIP on the paths it cannot complete,
  // which is more precise than pattern-matching the page for an exception —
  // runBackgroundScript already refuses to return at all if the script did not
  // finish.
  expect(out, 'the seed script reported a record it could not write').not.toMatch(/FAILED/);
  return out;
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

// ---------------------------------------------------------------------------

test('phase 1 - create the business application CIs', async ({ page }) => {
  await run(
    page,
    `
var names = JSON.parse(${literal(APPS_TO_CREATE)});
var owner = ${JSON.stringify(PERSON)};
var created = 0, existed = 0;

for (var i = 0; i < names.length; i++) {
  var n = names[i];
  if (appSysId(n)) { existed++; gs.print('exists  : ' + n); continue; }

  var ins = new GlideRecord('cmdb_ci_business_app');
  ins.initialize();
  ins.setValue('name', n);
  ins.setValue('short_description', n + ' - business application');
  ins.setValue('operational_status', 1);
  ins.setValue('install_status', 1);
  ins.setValue('u_emergency_tier', ${JSON.stringify(TIER)});
  ins.setValue('u_caf_compliance_status', 'not_ini');
  ins.setValue('it_application_owner', owner);
  ins.setValue('managed_by', owner);
  ins.setValue('owned_by', owner);
  // 'environment' is deliberately left empty. The nightly CAF - Create new CAF
  // requests job selects on u_emergency_tier IN Tier 0,1,2 AND
  // environment=Production AND operational_status=1, so a blank environment
  // keeps these applications out of automatic generation. The tier is still set
  // because the compliance roll-up business rule and the control reference
  // qualifier both key off it.
  var id = ins.insert();
  if (id) { created++; gs.print('created : ' + n + ' (' + id + ')'); }
  else { gs.print('FAILED  : ' + n); }
}
gs.print('phase 1: ' + created + ' created, ' + existed + ' already present');
`
  );
});

// ---------------------------------------------------------------------------

test('phase 2 - repoint the existing requests onto generic applications', async ({ page }) => {
  await run(
    page,
    `
var moves = JSON.parse(${literal(REPOINTS)});

for (var i = 0; i < moves.length; i++) {
  var from = moves[i].from, to = moves[i].to, numbers = moves[i].numbers;
  var toId = appSysId(to);
  if (!toId) { gs.print('SKIP: no CI named ' + to); continue; }

  var req = new GlideRecord('x_gskn2_caf_compli_caf_req');
  if (numbers.length) {
    // Named requests. Used where the source application holds requests bound
    // for two different rows, so a whole-application move cannot express it.
    req.addQuery('number', 'IN', numbers.join(','));
  } else {
    // Matched by dot-walked name rather than by resolving the old name to a
    // sys_id first: cmdb_ci_business_app holds two CIs both called SAP HANA, so
    // a name lookup would silently pick one and leave the other's requests
    // behind.
    req.addEncodedQuery('business_application.name=' + from);
  }
  req.query();

  var moved = 0;
  while (req.next()) {
    if (req.getValue('business_application') === toId) { continue; }

    // Rebuild the short description the way caf_short_desc does — '<app> -
    // <control>' — or every moved request keeps advertising the old app name in
    // the Salesforce drill-in header. The field is read_only in the dictionary,
    // which is why this runs server side rather than over the Table API.
    var control = '';
    var rel = new GlideRecord('x_gskn2_caf_compli_caf_relationship');
    if (rel.get(req.getValue('caf_conformance_type'))) {
      control = rel.caf_conformance_type.getDisplayValue() || '';
    }

    req.setValue('business_application', toId);
    if (control) { req.setValue('short_description', to + ' - ' + control); }
    req.update();
    moved++;

    // The task carries its own copy of the business application, set on insert
    // by the 'set business app' rule. Left alone it would still name the old CI
    // in the ServiceNow task list.
    var tsk = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    tsk.addQuery('caf_request', req.getUniqueValue());
    tsk.query();
    while (tsk.next()) {
      tsk.setValue('business_application', toId);
      tsk.update();
    }
  }
  gs.print((from || numbers.length + ' named requests') + ' -> ' + to + ': ' + moved + ' moved');
}
`
  );
});

// ---------------------------------------------------------------------------

test('phase 3 - create the missing CAF Requests', async ({ page }) => {
  // One background call per application rather than one for all eighteen. A
  // request insert fires the CAF - Create CAF tasks flow and an async Salesforce
  // push, so a single script covering every app is both a long transaction and
  // an all-or-nothing one; per app, a failure names the app it happened on.
  for (const app of APPS) {
    await run(
      page,
      `
var cfg = JSON.parse(${literal({ app: app.name, cells: app.cells, controls: CONTROLS })});
var baId = appSysId(cfg.app);
if (!baId) { gs.print('SKIP: no CI named ' + cfg.app); }
else {
  var created = 0, existed = 0;
  for (var key in cfg.cells) {
    if (!cfg.cells.hasOwnProperty(key)) { continue; }
    var code = cfg.cells[key];
    var controlName = cfg.controls[key];
    var relId = relationshipFor(controlName);
    if (!relId) { gs.print('  SKIP: no ${TIER} relationship for ' + controlName); continue; }

    if (requestForControl(baId, controlName)) { existed++; continue; }

    // Dates are chosen by the status the cell is meant to end up in. Anything
    // staying active and not red has to complete in the future - see the note
    // on the nightly overdue job.
    var startDays = -120, endDays = -30;
    if (code === 'A') { startDays = -30;  endDays = 21; }
    if (code === 'R') { startDays = -150; endDays = -20; }
    if (code === 'X') { startDays = -90;  endDays = 45; }

    var ins = new GlideRecord('x_gskn2_caf_compli_caf_req');
    ins.initialize();
    ins.setValue('business_application', baId);
    ins.setValue('caf_conformance_type', relId);
    ins.setValue('assigned_to', ${JSON.stringify(PERSON)});
    ins.setValue('managed_by', ${JSON.stringify(PERSON)});
    ins.setValue('process_control_owner', ${JSON.stringify(PERSON)});
    ins.setValue('planned_start_date', shift(startDays));
    ins.setValue('planned_completion_date', shift(endDays));
    ins.setValue('short_description', cfg.app + ' - ' + controlName);
    ins.setValue('description', 'Annual CAF conformance check for ' + cfg.app + ': ' + controlName + '.');
    var id = ins.insert();
    if (id) { created++; } else { gs.print('  FAILED: ' + controlName); }
  }
  gs.print(cfg.app + ': ' + created + ' requests created, ' + existed + ' already present');
}
`
    );
  }
});

// ---------------------------------------------------------------------------

test('phase 4 - drive tasks and set the compliance status', async ({ page }) => {
  for (const app of APPS as SeedApp[]) {
    await run(
      page,
      `
var cfg = JSON.parse(${literal({ app: app.name, cells: app.cells, controls: CONTROLS, status: STATUS })});
var baId = appSysId(cfg.app);
if (!baId) { gs.print('SKIP: no CI named ' + cfg.app); }
else {
  var n = 0;
  for (var key in cfg.cells) {
    if (!cfg.cells.hasOwnProperty(key)) { continue; }
    var code = cfg.cells[key];
    var req = requestForControl(baId, cfg.controls[key]);
    if (!req) { gs.print('  MISSING request: ' + cfg.controls[key]); continue; }
    var reqId = req.getUniqueValue();

    var closing = (code === 'G' || code === 'X');

    // The Archer flag has to be on the record before the state reaches 3: the
    // CAF - Archer Exception rule keys off stateCHANGESTO3 with the flag
    // already true, and sets caf_status itself.
    if (code === 'X') {
      req.setValue('archer_exception_approved', true);
      req.setValue('archer_finding_number', 'ARCHER-004182');
      req.update();
    }

    // Tasks first, then the request, so that whatever the task-side rules
    // derive onto the parent is overwritten by the intended value rather than
    // the other way round.
    var tsk = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    tsk.addQuery('caf_request', reqId);
    tsk.query();
    while (tsk.next()) {
      var st = tsk.getValue('state');
      if (st === '3' || st === '-1') { continue; }

      // Open -> Closed Complete in one hop is refused by CAF - Task - prevent
      // state change, so In Progress is a required stop even when the end state
      // is closed.
      //
      // A red cell's task is left exactly where it is. On a newly created
      // request that means Open, so the drill-in offers Start; on a repointed
      // one it means whatever it already was. Both are truthful for an overdue
      // control, and it leaves the demo with a spread of available actions
      // rather than every task sitting In Progress.
      if (st === '1' && (closing || code === 'A')) {
        tsk.setValue('state', '2');
        tsk.update();
        st = '2';
      }
      if (closing && st === '2') {
        tsk.setValue('met_criteria', 'yes');
        tsk.setValue('approval', 'approved');
        tsk.setValue('state', '3');
        tsk.update();
      }
    }

    // Re-read: the task rules above update the parent, so the in-memory copy is
    // stale by now.
    var fresh = new GlideRecord('x_gskn2_caf_compli_caf_req');
    if (!fresh.get(reqId)) { continue; }

    fresh.setValue('caf_status', cfg.status[code]);
    if (closing) {
      fresh.setValue('state', '3');
      fresh.setValue('active', false);
      if (!fresh.getValue('actual_start_date')) { fresh.setValue('actual_start_date', shift(-90)); }
      if (!fresh.getValue('actual_completion_date')) { fresh.setValue('actual_completion_date', shift(-30)); }
    } else if (code === 'A') {
      fresh.setValue('state', '2');
      fresh.setValue('active', true);
      fresh.setValue('planned_completion_date', shift(21));
    } else if (code === 'R') {
      fresh.setValue('active', true);
      if (fresh.getValue('state') === '3') { fresh.setValue('state', '2'); }
      fresh.setValue('planned_completion_date', shift(-20));
    }
    fresh.update();
    n++;
  }
  gs.print(cfg.app + ': ' + n + ' requests set');
}
`
    );
  }
});

// ---------------------------------------------------------------------------

test('phase 5 - roll up the business application status and report', async ({ page }) => {
  const overall: Record<string, string> = {};
  for (const app of APPS) {
    const codes = Object.values(app.cells);
    const allGreen = codes.every((c) => c === 'G');
    overall[app.name] = allGreen ? 'compliant' : 'out_of_compliance';
  }

  await run(
    page,
    `
var overall = JSON.parse(${literal(overall)});
var controls = JSON.parse(${literal(CONTROLS)});

for (var name in overall) {
  if (!overall.hasOwnProperty(name)) { continue; }
  var id = appSysId(name);
  if (!id) { gs.print('SKIP: ' + name); continue; }
  var ba = new GlideRecord('cmdb_ci_business_app');
  if (ba.get(id)) {
    // Set last, after every request has landed: the roll-up business rules move
    // this field on each caf_status change, so the value it holds mid-seed is
    // whichever request happened to be written most recently.
    ba.setValue('u_caf_compliance_status', overall[name]);
    ba.update();
  }

  var line = [];
  for (var key in controls) {
    if (!controls.hasOwnProperty(key)) { continue; }
    var req = requestForControl(id, controls[key]);
    line.push(key + '=' + (req ? req.getValue('caf_status') : 'n/a'));
  }
  gs.print(name + ' [' + overall[name] + '] ' + line.join(' '));
}

var total = new GlideRecord('x_gskn2_caf_compli_caf_req');
total.query();
gs.print('TOTAL caf_req: ' + total.getRowCount());
var tt = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
tt.query();
gs.print('TOTAL caf_tsk: ' + tt.getRowCount());
`
  );
});
