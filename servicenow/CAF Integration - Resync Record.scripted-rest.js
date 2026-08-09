/**
 * Scripted REST API — CAF Integration
 * Resource: Resync Record
 *
 * POST /api/x_gskn2_caf_compli/caf/resync/{type}/{sysId}
 *   type: "request" | "task"
 *
 * The repair side of drift detection. Re-pushes one record to Salesforce and
 * reports the result. Nothing in ServiceNow is modified — this only replays the
 * outbound upsert that should have happened and evidently did not.
 *
 * Deliberately one record per call, and deliberately never automatic. Drift
 * repair that runs unattended can turn a Salesforce problem into a ServiceNow
 * problem; a button pressed by someone looking at the difference cannot. The
 * Sync Health panel is the only caller.
 *
 * ServiceNow stays the system of record here as everywhere else: the push sends
 * ServiceNow's values to Salesforce, so a divergence is always resolved in
 * ServiceNow's favour. That is the correct direction — Salesforce holds a
 * mirror, and a mirror that disagrees is simply stale.
 *
 * ES5 only.
 */
(function process(request, response) {

    var TABLES = {
        request: 'x_gskn2_caf_compli_caf_req',
        task:    'x_gskn2_caf_compli_caf_tsk',
        // Added 2026-08-08 alongside catalogue drift detection. A control whose
        // push failed is repairable exactly like a request or a task, so long as
        // the record still exists. A control that was deleted is not repairable
        // from here by design - there is nothing left to re-push - and Sync
        // Health marks that difference as needing a human rather than a button.
        control: 'x_gskn2_caf_compli_caf_conformance_type'
    };

    var type  = ('' + request.pathParams.type).toLowerCase();
    var sysId = request.pathParams.sysId;

    if (!TABLES.hasOwnProperty(type)) {
        response.setStatus(400);
        return { error: 'type must be "request", "task" or "control", got: ' + type };
    }

    var gr = new GlideRecord(TABLES[type]);
    if (!gr.get(sysId)) {
        response.setStatus(404);
        return { error: 'No ' + type + ' with sys_id ' + sysId };
    }

    var sync = new x_gskn2_caf_compli.CAFSalesforceSync();
    var result;
    if (type === 'request') {
        result = sync.pushRequest(gr);
    } else if (type === 'task') {
        result = sync.pushTask(gr);
    } else {
        result = sync.pushControl(gr);
    }

    gs.info('[CAF resync] ' + gr.getValue('number') + ' re-pushed by ' +
            gs.getUserName() + ': ok=' + result.ok + ' status=' + result.status);

    // A failed push is reported as a failed resync rather than swallowed. The
    // whole point of this endpoint is that a silent failure already happened
    // once; a second silent failure would be worse than useless.
    if (!result.ok) {
        response.setStatus(502);
        return {
            number:  gr.getValue('number'),
            ok:      false,
            status:  result.status,
            message: result.message
        };
    }

    return {
        number: gr.getValue('number'),
        ok:     true,
        status: result.status
    };

})(request, response);
