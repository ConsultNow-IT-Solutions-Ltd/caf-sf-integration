var SCOPE = 'x_gskn2_caf_compli';
var app = new GlideRecord('sys_app'); app.addQuery('scope', SCOPE); app.query(); app.next();
var appId = app.getUniqueValue();
var T = 'x_gskn2_caf_compli_';
var CT = T + 'caf_conformance_type', RL = T + 'caf_relationship',
    RT = T + 'caf_relationship_tasks', RQ = T + 'caf_req', TK = T + 'caf_tsk';

// -- the second custom BA field the integration code names (see caf_short_desc header)
var e = new GlideRecord('sys_dictionary');
e.addQuery('name', 'cmdb_ci_business_app'); e.addQuery('element', 'u_emergency_tier'); e.query();
if (!e.next()) {
  var d = new GlideRecord('sys_dictionary');
  d.initialize();
  d.setValue('name', 'cmdb_ci_business_app');
  d.setValue('element', 'u_emergency_tier');
  d.setValue('column_label', 'Emergency Tier');
  d.setValue('internal_type', 'string');
  d.setValue('max_length', 40);
  d.setValue('choice', 3);
  d.setValue('sys_scope', appId);
  d.setValue('active', true);
  gs.print('BA field u_emergency_tier -> ' + d.insert());
} else { gs.print('BA field u_emergency_tier already present'); }

// -- choices ---------------------------------------------------------------
var made = 0, skipped = 0;
function ch(tbl, el, pairs) {
  for (var i = 0; i < pairs.length; i++) {
    var val = '' + pairs[i][0], lbl = pairs[i][1];
    var x = new GlideRecord('sys_choice');
    x.addQuery('name', tbl); x.addQuery('element', el);
    x.addQuery('value', val); x.addQuery('language', 'en');
    x.query();
    if (x.next()) { skipped++; continue; }
    var c = new GlideRecord('sys_choice');
    c.initialize();
    c.setValue('name', tbl);
    c.setValue('element', el);
    c.setValue('value', val);
    c.setValue('label', lbl);
    c.setValue('sequence', (i + 1) * 100);
    c.setValue('language', 'en');
    c.setValue('inactive', false);
    c.setValue('sys_scope', appId);
    if (c.insert()) { made++; } else { gs.print('  FAIL choice ' + tbl + '.' + el + '=' + val); }
  }
}

var TIERS   = [['Tier 0','Tier 0'], ['Tier 1','Tier 1'], ['Tier 2','Tier 2']];
var YESNO   = [['Yes','Yes'], ['No','No']];
var FREQ    = [['90','90'], ['180','180'], ['365','365'], ['other','Other']];
var STATE   = [[1,'Open'], [2,'In Progress'], [3,'Closed Complete'], [-1,'Cancelled']];
var PRIORITY= [[1,'1 - Critical'], [2,'2 - High'], [3,'3 - Moderate'], [4,'4 - Low']];
var STATUS  = [['in_compliance','In Compliance'],
               ['approaching_due','Approaching Due'],
               ['out_of_compliance','Out of Compliance'],
               ['archer_exception_approved','Archer Exception Approved']];

ch(RL, 'tier', TIERS);
ch(RL, 'crown_jewels', YESNO);
ch(RL, 'frequency', FREQ);

ch(RT, 'emergency_tier', TIERS);
ch(RT, 'crown_jewels', YESNO);
ch(RT, 'frequency', FREQ);

ch(RQ, 'state', STATE);
ch(RQ, 'priority', PRIORITY);
ch(RQ, 'caf_status', STATUS);

ch(TK, 'state', STATE);
ch(TK, 'priority', PRIORITY);
ch(TK, 'approval', [['requested','Requested'], ['approved','Approved'],
                    ['rejected','Rejected'], ['cancelled','Cancelled']]);
ch(TK, 'met_criteria', [['yes','Yes'], ['no','No']]);

ch('cmdb_ci_business_app', 'u_caf_compliance_status', STATUS);
ch('cmdb_ci_business_app', 'u_emergency_tier', TIERS);

gs.print('CHOICES created=' + made + ' skipped=' + skipped);

// -- display fields --------------------------------------------------------
function disp(tbl, el) {
  var g = new GlideRecord('sys_dictionary');
  g.addQuery('name', tbl); g.addQuery('element', el); g.query();
  if (g.next()) { g.setValue('display', true); g.update(); gs.print('display: ' + tbl + '.' + el); }
  else { gs.print('display MISSING: ' + tbl + '.' + el); }
}
disp(CT, 'name');
disp(RQ, 'number');
disp(TK, 'number');
