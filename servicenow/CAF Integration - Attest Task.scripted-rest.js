/**
 * Scripted REST API - CAF Integration
 * Resource: Attest Task
 *
 * POST /api/x_gskn2_caf_compli/caf/task/{sysId}/attest
 *
 * Body: { "met_criteria": "yes"|"no", "outcome": "approved"|"rejected",
 *         "comments": "..." }
 *
 * The attestation outcome, recorded where the state machine lives.
 *
 * This endpoint writes no state itself beyond the three fields it is given.
 * Setting `approval` is the whole act: the active business rule
 * "CAF - success criteria not met" (before update, order 2100, filter
 * approvalVALCHANGES^active=true) closes the task and sets the parent
 * request's caf_status to in_compliance or out_of_compliance. Doing any of
 * that here would put a second implementation of the transition next to the
 * one that already runs for the /caf portal and for admins.
 *
 * Why a dedicated resource rather than PATCH /task/{sysId}, which already
 * allows `approval`: the gate. An attestation with no evidence behind it is
 * the thing the product exists to prevent, and the generic update resource
 * cannot refuse one without imposing the rule on every other caller.
 *
 * The gate lives here and only here. The business rule
 * "CAF - attachment mandatory for def tasks" implements the same check and is
 * deliberately left inactive: activating it would change closure behaviour for
 * the AngularJS portal and for every one of the existing tasks, none of which
 * has an attachment.
 *
 * ES5 only. ASCII only.
 */
(function process(request, response) {

    var OUTCOMES = ['approved', 'rejected'];
    var CRITERIA = ['yes', 'no'];
    var IN_PROGRESS = '2';

    function isTrue(value) {
        return value === '1' || value === 'true';
    }

    var sysId = request.pathParams.sysId;
    var body  = request.body ? request.body.data : null;

    // A request with no body arrives as {}, not null, so a truthiness test
    // never fires: count the keys instead. Measured on dev249570 (TC-INT-035).
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
        response.setStatus(400);
        return { error: 'Empty request body' };
    }

    var outcome     = body.outcome;
    var metCriteria = body.met_criteria;
    var comments    = body.comments || '';

    if (OUTCOMES.indexOf(outcome) === -1) {
        response.setStatus(400);
        return { error: 'outcome must be "approved" or "rejected"' };
    }
    if (CRITERIA.indexOf(metCriteria) === -1) {
        response.setStatus(400);
        return { error: 'met_criteria must be "yes" or "no"' };
    }

    var gr = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    if (!gr.get(sysId)) {
        response.setStatus(404);
        return { error: 'CAF Task not found: ' + sysId };
    }

    var number = gr.getValue('number');

    // The business rule that applies the outcome carries active=true in its
    // filter, so on a closed or cancelled task this write would land silently
    // and change nothing. Refuse instead.
    //
    // getValue() on a boolean returns the stored '1' or '0', not 'true' - the
    // Table API's JSON says 'true' and reading that back into a GlideRecord
    // comparison is why the first version of this check refused every task.
    // Both forms are accepted here rather than relying on which one a given
    // read path produces.
    if (!isTrue(gr.getValue('active'))) {
        response.setStatus(409);
        return { error: number + ' is no longer active; its outcome is already recorded.' };
    }

    // Attestation closes the task, and a task must pass through In Progress on
    // its way to closed - "CAF - Task - prevent state change" enforces that for
    // a direct state write, but it evaluates before the approval rule sets
    // state=3 and so would not catch this route. Requiring In Progress here
    // keeps the one rule true whichever door the task came through.
    if (gr.getValue('state') !== IN_PROGRESS) {
        response.setStatus(409);
        return {
            error: number + ' must be In Progress before it can be attested. ' +
                   'Start the task first.'
        };
    }

    if (gr.getValue('approval') === outcome) {
        response.setStatus(409);
        return { error: number + ' is already ' + outcome + '.' };
    }

    // The gate. An attestation is a claim about evidence, so refuse one with no
    // evidence behind it.
    var att = new GlideRecord('sys_attachment');
    att.addQuery('table_name', 'x_gskn2_caf_compli_caf_tsk');
    att.addQuery('table_sys_id', sysId);
    att.setLimit(1);
    att.query();

    if (!att.hasNext()) {
        response.setStatus(428);
        return {
            error: 'Attach at least one evidence file to ' + number + ' before attesting.'
        };
    }

    gr.setValue('met_criteria', metCriteria);
    if (comments) {
        gr.setValue('comments', comments);
    }
    gr.setValue('approval', outcome);
    gr.update();

    // Re-read rather than trusting the in-memory record: the closure, the
    // actual completion date and the active flag are all set by business rules
    // during that update, and the parent request's caf_status is set by
    // another. Reporting what is actually stored is the point of returning
    // anything at all.
    var after = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    after.get(sysId);

    var requestNumber = '';
    var requestStatus = '';
    var parentId = after.getValue('caf_request');
    var parent = null;

    if (parentId) {
        parent = new GlideRecord('x_gskn2_caf_compli_caf_req');
        if (parent.get(parentId)) {
            requestNumber = parent.getValue('number');
            requestStatus = parent.getValue('caf_status');
        } else {
            parent = null;
        }
    }

    gs.info('[SF->CAF] ' + number + ' attested ' + outcome +
            ' (met_criteria=' + metCriteria + ') by ' + gs.getUserName() +
            '; task state ' + after.getValue('state') +
            ', ' + (requestNumber || 'no parent') + ' status ' + requestStatus);

    // Same reconciliation as the Update Task resource, and for the same reason:
    // the outbound business rules skip anything sf.integration writes, and the
    // closure and the parent's compliance status are both derived inside this
    // transaction and so are attributed to sf.integration too. Push them
    // explicitly - two upserts, triggered by this request rather than by a
    // record change, so no loop can form from it.
    var sync = new x_gskn2_caf_compli.CAFSalesforceSync();
    sync.pushTask(after);
    if (parent) {
        sync.pushRequest(parent);
    }

    return {
        sys_id:         sysId,
        number:         number,
        approval:       after.getValue('approval'),
        met_criteria:   after.getValue('met_criteria'),
        state:          after.getValue('state'),
        // Normalised, so the Salesforce side does not have to know that a
        // GlideRecord boolean reads back as '1'.
        active:         isTrue(after.getValue('active')) ? 'true' : 'false',
        request:        requestNumber,
        request_status: requestStatus
    };

})(request, response);
