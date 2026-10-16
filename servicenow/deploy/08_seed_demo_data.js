var T = 'x_gskn2_caf_compli_';
var admin = new GlideRecord('sys_user'); admin.addQuery('user_name','admin'); admin.query(); admin.next();
var ADMIN = admin.getUniqueValue();

// a business application to hang it all off
var ba = new GlideRecord('cmdb_ci_business_app');
ba.addQuery('name','CAF Demo Payments Platform'); ba.query();
var baId;
if (ba.next()) { baId = ba.getUniqueValue(); }
else {
  var nb = new GlideRecord('cmdb_ci_business_app');
  nb.initialize();
  nb.setValue('name','CAF Demo Payments Platform');
  nb.setValue('u_caf_compliance_status','in_compliance');
  nb.setValue('u_emergency_tier','Tier 0');
  baId = nb.insert();
}
gs.info('BA=' + baId);

// CAF Control
var ct = new GlideRecord(T + 'caf_conformance_type');
ct.initialize();
ct.setValue('name','B3.a Data Security');
ct.setValue('instructions','<p>Evidence that data at rest is encrypted.</p>');
ct.setValue('active', true);
var ctId = ct.insert();
var ctBack = new GlideRecord(T + 'caf_conformance_type'); ctBack.get(ctId);
gs.info('CONTROL=' + ctId + ' number=' + ctBack.getValue('number'));

// Relationship
var rl = new GlideRecord(T + 'caf_relationship');
rl.initialize();
rl.setValue('caf_conformance_type', ctId);
rl.setValue('tier','Tier 0');
rl.setValue('crown_jewels','Yes');
rl.setValue('frequency','365');
rl.setValue('relative_end_date','1970-01-01 00:00:00');
rl.setValue('success_criteria','<p>Encryption at rest evidenced for all stores.</p>');
rl.setValue('order', 100);
rl.setValue('business_application', baId);
rl.setValue('active', true);
var rlId = rl.insert();
gs.info('RELATIONSHIP=' + rlId);

// Request
var rq = new GlideRecord(T + 'caf_req');
rq.initialize();
rq.setValue('business_application', baId);
rq.setValue('caf_conformance_type', rlId);
rq.setValue('assigned_to', ADMIN);
rq.setValue('managed_by', ADMIN);
rq.setValue('short_description','CAF Demo Payments Platform - B3.a Data Security');
rq.setValue('state', 1);
rq.setValue('caf_status','in_compliance');
rq.setValue('planned_start_date', '2026-09-01 09:00:00');
rq.setValue('planned_completion_date', '2026-12-01 17:00:00');
rq.setValue('priority', 2);
rq.setValue('active', true);
var rqId = rq.insert();
var rqBack = new GlideRecord(T + 'caf_req'); rqBack.get(rqId);
gs.info('REQUEST=' + rqId + ' number=' + rqBack.getValue('number'));

// Two tasks - one parented, one deliberately parentless (the SETUP.md case)
var tk = new GlideRecord(T + 'caf_tsk');
tk.initialize();
tk.setValue('caf_request', rqId);
tk.setValue('business_application', baId);
tk.setValue('assigned_to', ADMIN);
tk.setValue('short_description','Evidence encryption at rest');
tk.setValue('description','Attach the current encryption configuration export.');
tk.setValue('success_criteria','<p>Config export shows AES-256 on every store.</p>');
tk.setValue('state', 1);
tk.setValue('planned_start_date','2026-09-01 09:00:00');
tk.setValue('planned_completion_date','2026-10-01 17:00:00');
tk.setValue('priority', 2);
tk.setValue('active', true);
var tkId = tk.insert();
var tkBack = new GlideRecord(T + 'caf_tsk'); tkBack.get(tkId);
gs.info('TASK=' + tkId + ' number=' + tkBack.getValue('number'));

var tk2 = new GlideRecord(T + 'caf_tsk');
tk2.initialize();
tk2.setValue('short_description','Parentless task (no caf_request)');
tk2.setValue('description','Exercises the omit-the-relationship branch in buildTaskPayload.');
tk2.setValue('state', 1);
tk2.setValue('active', true);
var tk2Id = tk2.insert();
var tk2Back = new GlideRecord(T + 'caf_tsk'); tk2Back.get(tk2Id);
gs.info('TASK2=' + tk2Id + ' number=' + tk2Back.getValue('number'));
