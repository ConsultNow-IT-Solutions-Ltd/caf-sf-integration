var app = new GlideRecord('sys_app');
app.addQuery('scope', 'x_gskn2_caf_compli'); app.query(); app.next();
var APP = app.getUniqueValue();
var T = 'x_gskn2_caf_compli_';
var MENU_ROLES = 'itil,caf_admin,caf_read_only_all,caf_tier_0_owner,' +
                 'caf_tier_1_owner,caf_tier_2_owner,caf_engineer';

// Does the /caf Service Portal actually exist here? Module 50 in the TDD points
// at it, and a menu item that 404s is worse than no menu item.
var sp = new GlideRecord('sp_portal');
if (sp.isValid()) {
  sp.addQuery('url_suffix', 'caf'); sp.query();
  gs.print('sp_portal /caf exists = ' + (sp.getRowCount() > 0));
} else { gs.print('sp_portal table not present'); }

// -- application menu ------------------------------------------------------
var menuId;
var m = new GlideRecord('sys_app_application');
m.addQuery('title', 'CAF Compliance'); m.query();
if (m.next()) { menuId = m.getUniqueValue(); gs.print('MENU EXISTS -> ' + menuId); }
else {
  var nm = new GlideRecord('sys_app_application');
  nm.initialize();
  nm.setValue('title', 'CAF Compliance');
  nm.setValue('name', 'CAF Compliance');
  nm.setValue('roles', MENU_ROLES);
  nm.setValue('active', true);
  nm.setValue('order', 100);
  nm.setValue('hint', 'Cyber Assessment Framework compliance');
  nm.setValue('sys_scope', APP);
  menuId = nm.insert();
  gs.print('MENU CREATED -> ' + menuId);
}

// -- modules ---------------------------------------------------------------
// mod(order, title, table, roles)
function mod(order, title, table, roles) {
  var e = new GlideRecord('sys_app_module');
  e.addQuery('application', menuId); e.addQuery('title', title); e.query();
  if (e.next()) { gs.print('  MODULE EXISTS: ' + title); return; }
  var d = new GlideRecord('sys_app_module');
  d.initialize();
  d.setValue('application', menuId);
  d.setValue('title', title);
  d.setValue('name', table);
  d.setValue('link_type', 'LIST');
  d.setValue('order', order);
  d.setValue('active', true);
  d.setValue('sys_scope', APP);
  if (roles) d.setValue('roles', roles);
  var id = d.insert();
  gs.print('  MODULE ' + (id ? 'created' : 'FAILED') + ': ' + order + ' ' + title +
           ' -> ' + table + (roles ? ' [' + roles + ']' : '') +
           (id ? '' : ' err=' + d.getLastErrorMessage()));
}

mod(10, 'CAF Requests',               T + 'caf_req',               '');
mod(20, 'CAF Tasks',                  T + 'caf_tsk',               '');
mod(30, 'CAF Controls Relationship',  T + 'caf_relationship',      'caf_admin');
mod(35, 'CAF Controls',               T + 'caf_conformance_type',  'caf_admin');
mod(40, 'Critical Business Applications', 'cmdb_ci_business_app',  '');

// -- verify ----------------------------------------------------------------
gs.print('--- menu as built ---');
var v = new GlideRecord('sys_app_module');
v.addQuery('application', menuId);
v.orderBy('order'); v.query();
while (v.next()) {
  gs.print('  ' + v.getValue('order') + '  ' + v.getValue('title') +
           '  -> ' + v.getValue('name') +
           '  roles=[' + (v.getValue('roles') || '-') + ']' +
           '  active=' + v.getValue('active'));
}
