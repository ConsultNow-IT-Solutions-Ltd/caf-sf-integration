var SCOPE = 'x_gskn2_caf_compli';
var app = new GlideRecord('sys_app'); app.addQuery('scope', SCOPE); app.query(); app.next();
var appId = app.getUniqueValue();
var T = 'x_gskn2_caf_compli_';
var made = 0, skipped = 0, failed = 0;

// f(table, element, label, type, len, ref, mandatory, readonly, choiceMode, defaultValue)
function f(tbl, el, lbl, typ, len, ref, man, ro, ch, dv) {
  var e = new GlideRecord('sys_dictionary');
  e.addQuery('name', tbl); e.addQuery('element', el); e.query();
  if (e.next()) { skipped++; return; }
  var d = new GlideRecord('sys_dictionary');
  d.initialize();
  d.setValue('name', tbl);
  d.setValue('element', el);
  d.setValue('column_label', lbl);
  d.setValue('internal_type', typ);
  d.setValue('sys_scope', appId);
  d.setValue('active', true);
  if (len)  d.setValue('max_length', len);
  if (ref)  d.setValue('reference', ref);
  if (man)  d.setValue('mandatory', true);
  if (ro)   d.setValue('read_only', true);
  if (ch)   d.setValue('choice', ch);
  if (dv)   d.setValue('default_value', dv);
  var id = d.insert();
  if (id) { made++; } else { failed++; gs.print('  FAIL ' + tbl + '.' + el + ': ' + d.getLastErrorMessage()); }
}

var CT = T + 'caf_conformance_type', RL = T + 'caf_relationship',
    RT = T + 'caf_relationship_tasks', RQ = T + 'caf_req', TK = T + 'caf_tsk';

// ---- CAF Controls
f(CT,'name','Name','string',40,'',false,false,0,'');
f(CT,'instructions','Instructions','html',65000,'',false,false,0,'');
f(CT,'active','Active','boolean',40,'',false,false,0,'true');

// ---- CAF Controls Relationships
f(RL,'caf_conformance_type','CAF Control Name','reference',32,CT,true,false,0,'');
f(RL,'tier','Service Category','string',40,'',true,false,3,'');
f(RL,'crown_jewels','Crown Jewels','string',40,'',true,false,3,'');
f(RL,'frequency','Frequency','string',40,'',true,false,3,'');
f(RL,'relative_start_date','Relative Start Date','glide_duration',40,'',false,false,0,'');
f(RL,'relative_end_date','Relative End Date','glide_duration',40,'',true,false,0,'');
f(RL,'relative_creation','Relative Creation','glide_duration',40,'',false,false,0,'');
f(RL,'success_criteria','Success Criteria','html',65000,'',true,false,0,'');
f(RL,'order','Order','integer',40,'',true,false,0,'');
f(RL,'parent','Parent','reference',32,RL,false,false,0,'');
f(RL,'business_application','Business Application','reference',32,'cmdb_ci_business_app',false,false,0,'');
f(RL,'tasks_required','Tasks Required','simple_name_values',4000,'',false,false,0,'');
f(RL,'active','Active','boolean',40,'',false,false,0,'true');

// ---- CAF Relationship Tasks
f(RT,'caf_relationship','CAF Relationship','reference',32,RL,true,false,0,'');
f(RT,'short_description','Short Description','string',160,'',true,false,0,'');
f(RT,'description','Description','string',4000,'',false,false,0,'');
f(RT,'emergency_tier','Emergency Tier','string',40,'',false,false,3,'');
f(RT,'crown_jewels','Crown Jewels','string',40,'',false,false,3,'');
f(RT,'frequency','Frequency','string',40,'',false,false,3,'');
f(RT,'relative_start_date','Relative Start Date','glide_duration',40,'',false,false,0,'');
f(RT,'relative_end_date','Relative End Date','glide_duration',40,'',false,false,0,'');
f(RT,'order','Order','integer',40,'',false,false,0,'');
f(RT,'active','Active','boolean',40,'',false,false,0,'true');

// ---- CAF Request
f(RQ,'short_description','Short Description','string',160,'',false,true,0,'');
f(RQ,'business_application','Business Application','reference',32,'cmdb_ci_business_app',false,false,0,'');
f(RQ,'caf_conformance_type','CAF Control Name','reference',32,RL,true,false,0,'');
f(RQ,'assigned_to','Assigned To','reference',32,'sys_user',true,false,0,'');
f(RQ,'managed_by','Managed By','reference',32,'sys_user',false,false,0,'');
f(RQ,'process_control_owner','Business Owner','reference',32,'sys_user',false,false,0,'');
f(RQ,'state','State','integer',40,'',false,false,1,'1');
f(RQ,'caf_status','CAF Status','string',40,'',false,false,3,'');
f(RQ,'planned_start_date','Planned Start Date','glide_date_time',40,'',true,false,0,'');
f(RQ,'planned_completion_date','Planned Completion Date','glide_date_time',40,'',true,false,0,'');
f(RQ,'actual_start_date','Actual Start Date','glide_date_time',40,'',false,false,0,'');
f(RQ,'actual_completion_date','Actual Completion Date','glide_date_time',40,'',false,false,0,'');
f(RQ,'next_due_date','Next Due Date','glide_date_time',40,'',false,true,0,'');
f(RQ,'priority','Priority','integer',40,'',false,false,1,'4');
f(RQ,'description','Description','string',4000,'',false,false,0,'');
f(RQ,'comments','Additional Comments','journal_input',4000,'',false,false,0,'');
f(RQ,'active','Active','boolean',40,'',false,false,0,'true');
f(RQ,'allow_all_controls','Allow Any Control','boolean',40,'',false,false,0,'false');
f(RQ,'archer_exception_approved','Archer Finding Approved','boolean',40,'',false,false,0,'false');
f(RQ,'archer_finding_number','Archer Finding Number','string',100,'',false,false,0,'');

// ---- CAF Task
f(TK,'short_description','Short Description','string',160,'',false,true,0,'');
f(TK,'description','Description','string',4000,'',true,false,0,'');
f(TK,'caf_request','CAF Request','reference',32,RQ,false,false,0,'');
f(TK,'business_application','Business Application','reference',32,'cmdb_ci_business_app',false,false,0,'');
f(TK,'assigned_to','Assigned To','reference',32,'sys_user',false,false,0,'');
f(TK,'state','State','integer',40,'',false,false,1,'1');
f(TK,'approval','Approval','string',40,'',false,true,3,'');
f(TK,'met_criteria','Met Criteria','string',40,'',false,false,3,'');
f(TK,'success_criteria','Success Criteria','html',65000,'',false,false,0,'');
f(TK,'planned_start_date','Planned Start Date','glide_date_time',40,'',false,true,0,'');
f(TK,'planned_completion_date','Planned Completion Date','glide_date_time',40,'',false,true,0,'');
f(TK,'actual_start_date','Actual Start Date','glide_date_time',40,'',false,false,0,'');
f(TK,'actual_completion_date','Actual Completion Date','glide_date_time',40,'',false,false,0,'');
f(TK,'priority','Priority','integer',40,'',false,false,1,'4');
f(TK,'vqd_link','VQD Link','url',1024,'',false,false,0,'');
f(TK,'vqd_link_2','VQD Link 2','url',1024,'',false,false,0,'');
f(TK,'comments','Additional Comments','journal_input',4000,'',false,false,0,'');
f(TK,'active','Active','boolean',40,'',false,false,0,'true');

// ---- the one field the CAF engine writes on the CMDB business app
f('cmdb_ci_business_app','u_caf_compliance_status','CAF Compliance Status','string',40,'',false,false,3,'');

gs.print('RESULT created=' + made + ' skipped=' + skipped + ' failed=' + failed);
