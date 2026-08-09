/**
 * Scripted REST API — CAF Integration
 * Resource: Sync Snapshot
 *
 * GET /api/x_gskn2_caf_compli/caf/snapshot
 *
 * The read side of drift detection. Returns the fields Salesforce mirrors, for
 * every request and task, so the Sync Health panel can compare the two systems
 * and show whether the dashboard is telling the truth.
 *
 * Read-only by construction: no GlideRecord here is ever updated, so this
 * endpoint cannot itself cause the drift it is meant to detect.
 *
 * Authenticates as sf.integration like the PATCH resource beside it. That user
 * writes nothing here, so the echo-loop guard is not involved either way.
 *
 * The state integer is mapped to the same labels CAFSalesforceSync pushes -
 * 1 Open, 2 In Progress, 3 Closed Complete, -1 Cancelled. If those two lists
 * ever disagree the panel reports drift on every record, which is a loud enough
 * failure to notice immediately.
 *
 * ES5 only.
 */
(function process(request, response) {

    var LIMIT = 2000;

    function stateLabel(value) {
        switch ('' + value) {
            case '1':  return 'Open';
            case '2':  return 'In Progress';
            case '3':  return 'Closed Complete';
            case '-1': return 'Cancelled';
            default:   return '' + value;
        }
    }

    var out = {
        generated_on: new GlideDateTime().getValue(),
        requests: [],
        tasks: [],
        controls: []
    };

    var req = new GlideRecord('x_gskn2_caf_compli_caf_req');
    req.orderBy('number');
    req.setLimit(LIMIT);
    req.query();
    while (req.next()) {
        out.requests.push({
            number:            req.getValue('number'),
            sys_id:            req.getUniqueValue(),
            caf_status:        req.getValue('caf_status'),
            state:             stateLabel(req.getValue('state')),
            short_description: req.getValue('short_description'),
            updated_on:        req.getValue('sys_updated_on')
        });
    }

    var tsk = new GlideRecord('x_gskn2_caf_compli_caf_tsk');
    tsk.orderBy('number');
    tsk.setLimit(LIMIT);
    tsk.query();
    while (tsk.next()) {
        out.tasks.push({
            number:            tsk.getValue('number'),
            sys_id:            tsk.getUniqueValue(),
            state:             stateLabel(tsk.getValue('state')),
            approval:          tsk.getValue('approval'),
            met_criteria:      tsk.getValue('met_criteria'),
            short_description: tsk.getValue('short_description'),
            updated_on:        tsk.getValue('sys_updated_on')
        });
    }

    // The control catalogue, added 2026-08-08.
    //
    // Until now this endpoint returned requests and tasks only, so the catalogue
    // was reconciled by nothing on the running system - and a catalogue row is a
    // visible dashboard column, which makes it the drift with the most obvious
    // user-facing consequence. A control deleted in ServiceNow whose retire push
    // failed stayed active in Salesforce as an orphan column, and nothing
    // reported it.
    //
    // Every control is returned, active or not, because "inactive here, active
    // there" is itself the drift worth catching. Keyed on sys_id by the consumer
    // rather than on number: control numbers are NOT unique on this instance -
    // CNFTYPE0001004 and CNFTYPE0001005 each name two different controls - so
    // keying on number would silently compare the wrong pairs.
    var ctl = new GlideRecord('x_gskn2_caf_compli_caf_conformance_type');
    ctl.orderBy('name');
    ctl.setLimit(LIMIT);
    ctl.query();
    while (ctl.next()) {
        out.controls.push({
            number:     ctl.getValue('number'),
            sys_id:     ctl.getUniqueValue(),
            name:       ctl.getValue('name'),
            // getValue on a boolean returns '1' or '0', never 'true'. Normalised
            // here so the consumer compares a real boolean rather than guessing
            // which spelling arrived.
            active:     ctl.getValue('active') === '1',
            updated_on: ctl.getValue('sys_updated_on')
        });
    }

    out.request_count = out.requests.length;
    out.task_count = out.tasks.length;
    out.control_count = out.controls.length;

    return out;

})(request, response);
