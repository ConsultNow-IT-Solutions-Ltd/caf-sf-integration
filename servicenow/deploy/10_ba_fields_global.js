// Run with sn_bg (global scope). Creates the two CAF columns on
// cmdb_ci_business_app that the app's code reads: u_emergency_tier
// (CAFUtil.generateCAFRequests, caf_short_desc, two request business rules)
// and u_caf_compliance_status (five request business rules, caf_short_desc).
//
// 04_fields.js and 05_choices_and_display.js also try to make these, but they
// stamp sys_scope with the CAF app, and a scoped app may not add a u_ column to
// a global table. The insert fails without printing an error, the choices are
// created anyway, and every write to either field is silently dropped - which
// is how dev249570 ran from 2026-09-04 until 2026-10-04 with no tier on any
// business application. This script owns the two columns; it is idempotent.
//
// Not to be confused with the platform's own emergency_tier (no u_), a choice
// of mission_critical / business_critical / non_critical. CAF's tiers are
// Tier 0 / Tier 1 / Tier 2 and live in u_emergency_tier.

var TABLE = 'cmdb_ci_business_app';
var FIELDS = [
  ['u_emergency_tier', 'Emergency Tier'],
  ['u_caf_compliance_status', 'CAF Compliance Status']
];

for (var i = 0; i < FIELDS.length; i++) {
  var el = FIELDS[i][0], label = FIELDS[i][1];

  var have = new GlideRecord('sys_dictionary');
  have.addQuery('name', TABLE);
  have.addQuery('element', el);
  have.query();
  if (have.next()) {
    gs.print(el + ': dictionary row already present (scope ' + have.getValue('sys_scope') + ')');
  } else {
    var d = new GlideRecord('sys_dictionary');
    d.initialize();
    d.setValue('name', TABLE);
    d.setValue('element', el);
    d.setValue('column_label', label);
    d.setValue('internal_type', 'string');
    d.setValue('max_length', 40);
    d.setValue('choice', 3);            // dropdown without -- None --
    d.setValue('sys_scope', 'global');
    d.setValue('active', true);
    var id = d.insert();
    gs.print(el + ': insert -> ' + (id || 'FAILED: ' + d.getLastErrorMessage()));
  }

  // The dictionary row is not the column. Ask the table itself.
  gs.print(el + ': column usable = ' + new GlideRecord(TABLE).isValidField(el));
}
