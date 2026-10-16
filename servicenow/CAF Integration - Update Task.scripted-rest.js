/**
 * Scripted REST API — CAF Integration
 * Resource: Update Task
 *
 * PATCH /api/x_gskn2_caf_compli/caf/task/{sysId}
 *
 * The inbound half of the round trip: Salesforce sends task outcomes back into
 * ServiceNow, where the state machine still lives.
 *
 * Authenticates as sf.integration. That is not incidental — the outbound
 * business rules skip any write made by that user, which is what stops a
 * Salesforce update from bouncing straight back to Salesforce. If this API is
 * ever run as another account the echo-loop guard silently does nothing.
 *
 * ES5 only.
 */
(function process(request, response) {

    // Salesforce may write these and nothing else. An allow-list rather than a
    // deny-list: the interesting fields on a CAF Task are system-managed
    // (number, active, actual dates, business_application) and letting an
    // external system set them would corrupt the state machine this design
    // deliberately keeps in ServiceNow.
    var WRITABLE = ['state', 'met_criteria', 'approval', 'comments', 'vqd_link', 'vqd_link_2'];

    var sysId = request.pathParams.sysId;
    var body  = request.body ? request.body.data : null;

    // A request with no body arrives as {}, not null, so a truthiness test
    // never fires: count the keys instead. Measured on dev249570 (TC-INT-015).
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
        response.setStatus(400);
        return { error: 'Empty request body' };
    }

    var gr = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    if (!gr.get(sysId)) {
        response.setStatus(404);
        return { error: 'CAF Task not found: ' + sysId };
    }

    var applied  = {};
    var rejected = [];
    var key;

    for (key in body) {
        if (!body.hasOwnProperty(key)) {
            continue;
        }
        if (WRITABLE.indexOf(key) === -1) {
            rejected.push(key);
            continue;
        }
        gr.setValue(key, body[key]);
        applied[key] = body[key];
    }

    // Refuse the whole call rather than silently applying the writable subset.
    // A caller that thinks it set met_criteria and did not would be worse than
    // an error.
    if (rejected.length > 0) {
        response.setStatus(400);
        return { error: 'Fields not writable from Salesforce: ' + rejected.join(', ') };
    }

    gr.update();

    gs.info('[SF->CAF] ' + gr.getValue('number') + ' updated by ' + gs.getUserName() +
            ': ' + JSON.stringify(applied));

    // Reconcile explicitly, because the echo-loop guard cannot tell the
    // difference between the write Salesforce just made and the changes
    // ServiceNow derived from it.
    //
    // Closing or starting a task fires rules that update the task's own actual
    // dates and its parent request's state, actual_start_date and next_due_date.
    // Those run inside this transaction, so they are attributed to
    // sf.integration too, and the outbound business rules skip them - measured:
    // moving CAFT0001048 to In Progress moved RCAF0001039 to state 2 in
    // ServiceNow while Salesforce still read Open, with no push logged for
    // either record.
    //
    // Pushing here rather than loosening the guard keeps the reconciliation
    // deliberate and bounded: exactly two upserts, triggered by this request
    // and not by a record change, so no loop can form from it.
    var sync = new x_gskn2_caf_compli.CAFSalesforceSync();
    sync.pushTask(gr);

    var parentId = gr.getValue('caf_request');
    if (parentId) {
        var parent = new GlideRecord('x_gskn2_caf_compli_caf_req');
        if (parent.get(parentId)) {
            sync.pushRequest(parent);
        }
    }

    return {
        sys_id:  sysId,
        number:  gr.getValue('number'),
        state:   gr.getValue('state'),
        applied: applied
    };

})(request, response);
