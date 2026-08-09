/**
 * Scripted REST API - CAF Integration
 * Resource: Upload Evidence
 *
 * POST /api/x_gskn2_caf_compli/caf/task/{sysId}/evidence
 *
 * Body: { "file_name": "...", "content_type": "...", "data": "<base64>" }
 *
 * Evidence is an audit artefact, so the copy that counts lives here, against
 * the task, in sys_attachment. Salesforce keeps its own ContentVersion for the
 * file preview UI; that copy is a convenience and this one is the record.
 *
 * Nothing is pushed back to Salesforce after a write. An attachment maps to no
 * mirrored field on CAF_Task__c, so there is no drift for a push to correct,
 * and the Developer Edition API budget is better spent elsewhere.
 *
 * Authenticates as sf.integration, which holds caf_admin.
 *
 * ES5 only. ASCII only - a single non-ASCII character anywhere in this file
 * makes the JSON that carries it to the instance fail with a bare HTTP 400.
 */
(function process(request, response) {

    // Apex holds the Blob and its base64 expansion in the same 6MB heap, and
    // the callout body is capped at 6MB too. Two megabytes of file is roughly
    // 2.7MB of base64 and leaves room for both. The limit is repeated in
    // CafEvidenceService so the caller fails before spending the callout.
    var MAX_BYTES = 2097152;

    var sysId = request.pathParams.sysId;
    var body  = request.body ? request.body.data : null;

    if (!body) {
        response.setStatus(400);
        return { error: 'Empty request body' };
    }

    var fileName    = body.file_name;
    var contentType = body.content_type || 'application/octet-stream';
    var data        = body.data;

    if (!fileName || !data) {
        response.setStatus(400);
        return { error: 'file_name and data are both required' };
    }

    var gr = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    if (!gr.get(sysId)) {
        response.setStatus(404);
        return { error: 'CAF Task not found: ' + sysId };
    }

    // Base64 carries three bytes in every four characters. Checking the encoded
    // length costs nothing and refuses an oversized file before it is decoded
    // into the transaction.
    var approxBytes = Math.floor((data.length * 3) / 4);
    if (approxBytes > MAX_BYTES) {
        response.setStatus(413);
        return {
            error: 'File is about ' + approxBytes + ' bytes; the limit is ' + MAX_BYTES
        };
    }

    var attachmentId;
    try {
        attachmentId = new GlideSysAttachment().writeBase64(gr, fileName, contentType, data);
    } catch (e) {
        gs.error('[SF->CAF] evidence write failed for ' + gr.getValue('number') + ': ' + e);
        response.setStatus(500);
        return { error: 'Could not write the attachment: ' + e };
    }

    if (!attachmentId) {
        response.setStatus(500);
        return { error: 'Attachment write returned no sys_id' };
    }

    // Read the stored row back rather than echoing the request. The size and
    // content type ServiceNow settled on are what the Salesforce side should
    // display, and they are not always what was sent.
    var att = new GlideRecord('sys_attachment');
    var size = '';
    if (att.get(attachmentId)) {
        size = att.getValue('size_bytes');
    }

    gs.info('[SF->CAF] evidence attached to ' + gr.getValue('number') + ': ' +
            fileName + ' (' + size + ' bytes) by ' + gs.getUserName());

    response.setStatus(201);
    return {
        sys_id:       attachmentId,
        task:         gr.getValue('number'),
        task_sys_id:  sysId,
        file_name:    fileName,
        content_type: contentType,
        size_bytes:   size
    };

})(request, response);
