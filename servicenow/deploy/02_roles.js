var SCOPE = 'x_gskn2_caf_compli';
var app = new GlideRecord('sys_app');
app.addQuery('scope', SCOPE); app.query();
if (!app.next()) { gs.print('FATAL: app not found'); }
var appId = app.getUniqueValue();

// js_level to match the documented application metadata
app.setValue('js_level', 'helsinki_es5');
app.update();
var chk = new GlideRecord('sys_app'); chk.get(appId);
gs.print('js_level now = ' + chk.getValue('js_level'));

var roles = [
  ['caf_admin',         'Full application management - CRUD on all CAF tables'],
  ['caf_engineer',      'Operational execution - read all, write only assigned records'],
  ['caf_tier_0_owner',  'Tier 0 service management - full access to Tier 0 BAs and related data'],
  ['caf_tier_1_owner',  'Tier 1 service management - full access to Tier 1 BAs and related data'],
  ['caf_tier_2_owner',  'Tier 2 service management - full access to Tier 2 BAs and related data'],
  ['caf_read_only_all', 'Audit/reporting access - read-only on all CAF tables']
];
for (var i = 0; i < roles.length; i++) {
  var n = roles[i][0];
  var e = new GlideRecord('sys_user_role');
  e.addQuery('name', n); e.query();
  if (e.next()) { gs.print('role exists: ' + e.getValue('name')); continue; }
  var r = new GlideRecord('sys_user_role');
  r.initialize();
  r.setValue('name', n);
  r.setValue('description', roles[i][1]);
  r.setValue('sys_scope', appId);
  var id = r.insert();
  var back = new GlideRecord('sys_user_role'); back.get(id);
  gs.print('role created: requested="' + n + '" actual="' + back.getValue('name') + '"');
}
