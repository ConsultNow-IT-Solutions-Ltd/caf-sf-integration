var SCOPE = 'x_gskn2_caf_compli';
var APP_SYS_ID = '7889b3de1bfca150a3d187b8e34bcbdf';

var ex = new GlideRecord('sys_app');
ex.addQuery('scope', SCOPE);
ex.query();
if (ex.next()) {
    gs.print('app already exists: ' + ex.getUniqueValue() + ' ' + ex.getValue('name'));
} else {
    var a = new GlideRecord('sys_app');
    a.initialize();
    a.setValue('sys_id', APP_SYS_ID);
    a.setValue('name', 'CAF Compliance');
    a.setValue('scope', SCOPE);
    a.setValue('version', '1.0.0');
    a.setValue('active', true);
    a.setValue('short_description', 'Cyber Assessment Framework compliance engine and Salesforce integration');
    a.setValue('vendor_prefix', 'x_gskn2');
    a.setValue('licensable', false);
    a.setValue('private', false);
    var id = a.insert();
    gs.print('app inserted: ' + id);
}

var v = new GlideRecord('sys_scope');
v.addQuery('scope', SCOPE);
v.query();
gs.print('sys_scope rows=' + v.getRowCount());
while (v.next()) { gs.print('  scope sys_id=' + v.getUniqueValue() + ' name=' + v.getValue('name')); }
