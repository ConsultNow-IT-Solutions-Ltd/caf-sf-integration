var SCOPE = 'x_gskn2_caf_compli';
var app = new GlideRecord('sys_app'); app.addQuery('scope', SCOPE); app.query(); app.next();
var appId = app.getUniqueValue();

function roleId(n) { var r = new GlideRecord('sys_user_role'); r.addQuery('name', n); r.query(); return r.next() ? r.getUniqueValue() : ''; }

// [table, label, extendable, autonumber-prefix (''=none), restricting role ('' = none)]
var defs = [
  ['x_gskn2_caf_compli_caf_conformance_type',  'CAF Controls',                false, 'CAFC', ''],
  ['x_gskn2_caf_compli_caf_relationship',      'CAF Controls Relationships',  false, '',     'caf_admin'],
  ['x_gskn2_caf_compli_caf_relationship_tasks','CAF Relationship Tasks',      false, '',     ''],
  ['x_gskn2_caf_compli_caf_req',               'CAF Request',                 true,  'RCAF', ''],
  ['x_gskn2_caf_compli_caf_tsk',               'CAF Task',                    true,  'CAFT', '']
];

for (var i = 0; i < defs.length; i++) {
  var nm = defs[i][0], lbl = defs[i][1], ext = defs[i][2], pfx = defs[i][3], rl = defs[i][4];

  var chk = new GlideRecord('sys_db_object'); chk.addQuery('name', nm); chk.query();
  if (chk.next()) { gs.print('TABLE EXISTS: ' + nm); continue; }

  var t = new GlideRecord('sys_db_object');
  t.initialize();
  t.setValue('name', nm);
  t.setValue('label', lbl);
  t.setValue('sys_scope', appId);
  t.setValue('is_extendable', ext);
  t.setValue('access', 'public');
  t.setValue('create_access_controls', false);
  t.setValue('caller_access', '');
  if (rl) t.setValue('user_role', roleId(rl));
  var tid = t.insert();
  gs.print('TABLE CREATED: ' + nm + ' -> ' + tid + (tid ? '' : ' ERROR: ' + t.getLastErrorMessage()));

  if (pfx) {
    var n = new GlideRecord('sys_number');
    n.initialize();
    n.setValue('category', nm);
    n.setValue('prefix', pfx);
    n.setValue('maximum_digits', 7);
    n.setValue('number', 1000);
    n.setValue('sys_scope', appId);
    var nid = n.insert();
    gs.print('  autonumber ' + pfx + ' -> ' + nid);
  }
}
gs.print('--- verify ---');
for (var j = 0; j < defs.length; j++) {
  var g = new GlideRecord(defs[j][0]);
  gs.print(defs[j][0] + ' valid=' + g.isValid());
}
