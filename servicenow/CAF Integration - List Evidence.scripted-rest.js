/**
 * Scripted REST API - CAF Integration
 * Resource: List Evidence
 *
 * GET /api/x_gskn2_caf_compli/caf/task/{sysId}/evidence
 *
 * What ServiceNow actually holds against the task. The Salesforce panel shows
 * this beside its own file list, so the two are visibly the same set rather
 * than taken on trust - the same argument that produced Sync Health, applied
 * to evidence.
 *
 * Read-only by construction: no GlideRecord here is ever updated.
 *
 * ES5 only. ASCII only.
 */
(function process(request, response) {

    var sysId = request.pathParams.sysId;

    var gr = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    if (!gr.get(sysId)) {
        response.setStatus(404);
        return { error: 'CAF Task not found: ' + sysId };
    }

    var files = [];
    var att = new GlideRecord('sys_attachment');
    att.addQuery('table_name', 'x_gskn2_caf_compli_caf_tsk');
    att.addQuery('table_sys_id', sysId);
    att.orderByDesc('sys_created_on');
    att.query();

    while (att.next()) {
        files.push({
            sys_id:         att.getUniqueValue(),
            file_name:      att.getValue('file_name'),
            content_type:   att.getValue('content_type'),
            size_bytes:     att.getValue('size_bytes'),
            sys_created_on: att.getValue('sys_created_on'),
            sys_created_by: att.getValue('sys_created_by')
        });
    }

    return {
        task:        gr.getValue('number'),
        task_sys_id: sysId,
        state:       gr.getValue('state'),
        approval:    gr.getValue('approval'),
        count:       files.length,
        files:       files
    };

})(request, response);
