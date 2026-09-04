var SCOPE = 'x_gskn2_caf_compli';
var app = new GlideRecord('sys_app'); app.addQuery('scope', SCOPE); app.query(); app.next();
var appId = app.getUniqueValue();

// -- system properties -----------------------------------------------------
// sf.enabled ships FALSE: the Salesforce client_id/client_secret are not in the
// repo, so an enabled push would only log auth failures. Flip it once the
// connected-app credentials are filled in.
var props = [
  ['x_gskn2_caf_compli.sf.enabled',   'boolean',   'false',
   'Master kill switch. false stops every outbound Salesforce call immediately.'],
  ['x_gskn2_caf_compli.sf.instance_url', 'string',
   'https://orgfarm-4938c7f768-dev-ed.develop.my.salesforce.com',
   'Salesforce My Domain URL; serves both the token endpoint and the data API.'],
  ['x_gskn2_caf_compli.sf.client_id', 'string',    '',
   'Consumer Key of the Salesforce connected app. NOT SET - fill in before enabling.'],
  ['x_gskn2_caf_compli.sf.client_secret', 'password2', '',
   'Consumer Secret, encrypted at rest. NOT SET - fill in before enabling.'],
  ['x_gskn2_caf_compli.sf.api_version', 'string',  'v67.0',
   'Salesforce REST API version.'],
  ['x_gskn2_caf_compli.sf.integration_user', 'string', 'sf.integration',
   'User name Salesforce-originated writes arrive as; the echo-loop guard keys off it.']
];
for (var i = 0; i < props.length; i++) {
  var nm = props[i][0];
  var x = new GlideRecord('sys_properties');
  x.addQuery('name', nm); x.query();
  if (x.next()) { gs.print('PROP EXISTS: ' + nm); continue; }
  var p = new GlideRecord('sys_properties');
  p.initialize();
  p.setValue('name', nm);
  p.setValue('type', props[i][1]);
  p.setValue('value', props[i][2]);
  p.setValue('description', props[i][3]);
  p.setValue('suffix', nm.substring(nm.indexOf('.') + 1));
  p.setValue('is_private', false);
  p.setValue('ignore_cache', false);
  p.setValue('sys_scope', appId);
  var id = p.insert();
  gs.print('PROP ' + (id ? 'created' : 'FAILED') + ': ' + nm + ' = "' + props[i][2] + '"');
}

// -- integration user ------------------------------------------------------
var PWD = gs.getProperty('caf.tmp.sfint.pwd');
var u = new GlideRecord('sys_user');
u.addQuery('user_name', 'sf.integration');
u.query();
var uid;
if (u.next()) {
  uid = u.getUniqueValue();
  gs.print('USER EXISTS: sf.integration -> ' + uid);
} else {
  var n = new GlideRecord('sys_user');
  n.initialize();
  n.setValue('user_name', 'sf.integration');
  n.setValue('first_name', 'Salesforce');
  n.setValue('last_name', 'Integration');
  n.setValue('email', 'sf.integration@reyantech.co.uk');
  n.setValue('active', true);
  n.setValue('web_service_access_only', true);
  n.setValue('locked_out', false);
  n.setValue('password_needs_reset', false);
  uid = n.insert();
  gs.print('USER created: sf.integration -> ' + uid);
}

// password: setDisplayValue routes through the hasher. Writing user_password
// with setValue stores the raw string and authentication then fails - that is
// the trap SETUP.md records against the Table API.
var up = new GlideRecord('sys_user');
if (up.get(uid)) {
  up.setDisplayValue('user_password', PWD);
  up.setValue('password_needs_reset', false);
  up.update();
  gs.print('password set via setDisplayValue');
}

// -- roles for the integration user ----------------------------------------
function grant(userId, roleName) {
  var r = new GlideRecord('sys_user_role');
  r.addQuery('name', roleName); r.query();
  if (!r.next()) { gs.print('  role NOT FOUND (skipped): ' + roleName); return; }
  var h = new GlideRecord('sys_user_has_role');
  h.addQuery('user', userId); h.addQuery('role', r.getUniqueValue()); h.query();
  if (h.next()) { gs.print('  role already held: ' + roleName); return; }
  var a = new GlideRecord('sys_user_has_role');
  a.initialize();
  a.setValue('user', userId);
  a.setValue('role', r.getUniqueValue());
  gs.print('  role granted: ' + roleName + ' -> ' + (a.insert() ? 'ok' : 'FAILED'));
}
grant(uid, 'caf_admin');
grant(uid, 'snc_platform_rest_api_access');
grant(uid, 'snc_internal');
