/**
 * CAFSalesforceSync
 *
 * Outbound push of CAF Requests and CAF Tasks into Salesforce, upserting on the
 * External Id field ServiceNow_Sys_Id__c so a replayed push updates rather than
 * duplicates.
 *
 * Scope:  x_gskn2_caf_compli
 * Client callable: No
 * Accessible from: This application scope only
 *
 * Auth is OAuth 2.0 Client Credentials, requested inline rather than through an
 * Application Registry entity. That keeps every moving part in this file and in
 * six system properties, which is what makes the whole setup creatable and
 * testable over the Table API. It differs from section 3 of the handoff
 * document, which specifies JWT bearer; JWT remains the better production
 * answer.
 *
 * ES5 only - the app runs at Helsinki JS level, so no let/const, arrow
 * functions or template literals.
 */
var CAFSalesforceSync = Class.create();

CAFSalesforceSync.prototype = {

    initialize: function() {
        this.enabled      = gs.getProperty('x_gskn2_caf_compli.sf.enabled', 'false') === 'true';
        this.instanceUrl  = gs.getProperty('x_gskn2_caf_compli.sf.instance_url', '');
        this.clientId     = gs.getProperty('x_gskn2_caf_compli.sf.client_id', '');
        this.clientSecret = gs.getProperty('x_gskn2_caf_compli.sf.client_secret', '');
        this.apiVersion   = gs.getProperty('x_gskn2_caf_compli.sf.api_version', 'v67.0');
        this._token       = null;   // cached for the life of this object only
    },

    // ---------------------------------------------------------------- public

    pushRequest: function(gr) {
        return this._push(gr, 'CAF_Request__c', this.buildPayload(gr));
    },

    pushTask: function(gr) {
        return this._push(gr, 'CAF_Task__c', this.buildTaskPayload(gr));
    },

    /**
     * The control catalogue itself, so the Salesforce grid can render a column
     * for a control that has no requests yet - which is what the ServiceNow
     * portal widget does, building its columns from this table rather than from
     * the requests. Without this, a newly created control is invisible in
     * Salesforce until someone generates a request against it.
     */
    pushControl: function(gr) {
        return this._push(gr, 'CAF_Control_Catalog__c', this.buildControlPayload(gr));
    },

    /**
     * A control deleted in ServiceNow, mirrored as Active__c = false rather than
     * as a delete.
     *
     * Deletes otherwise propagate in neither direction, and for the catalogue
     * that has teeth: the orphaned Salesforce row keeps Active__c = true and the
     * grid keeps rendering a column of N/A for a control that no longer exists.
     * That happened twice on 2026-08-07/08 and was cleaned up by hand both times.
     *
     * Retiring rather than deleting because it reuses the proven upsert path -
     * no new HTTP verb, no new failure mode - and because getControls() filters
     * on Active__c, so the column disappears just as completely. What survives
     * is a Salesforce row recording that the control once existed, which is the
     * more defensible audit position anyway.
     *
     * The full payload is sent, not just the flag: an upsert against an External
     * Id that Salesforce has never seen would otherwise create a nameless row,
     * and Name is required. That happens when a control is deleted having never
     * been pushed.
     */
    retireControl: function(gr) {
        var payload = this.buildControlPayload(gr);
        payload.Active__c = false;
        return this._push(gr, 'CAF_Control_Catalog__c', payload);
    },

    /**
     * Field mapping for CAF Request. Kept separate from the callout so the
     * payload can be inspected from a background script.
     */
    buildPayload: function(gr) {
        var control = this._control(gr);

        return {
            Name:                       gr.getValue('number'),
            SN_Number__c:               gr.getValue('number'),
            Short_Description__c:       this._truncate(gr.getValue('short_description'), 255),
            Planned_Completion_Date__c: this._toIso(gr.getValue('planned_completion_date')),
            Business_Application__c:    gr.getDisplayValue('business_application'),
            CAF_Control__c:             control.name,
            CAF_Control_Sys_Id__c:      control.sysId,
            CAF_Status__c:              gr.getValue('caf_status'),
            State__c:                   this._stateLabel(gr.getValue('state'))
        };
    },

    /**
     * The control is two hops away: caf_req.caf_conformance_type points at a CAF
     * Relationship, and that record's caf_conformance_type points at the CAF
     * Control which carries the name. Walked explicitly rather than by
     * dot-walking, because the field sharing a name across both tables makes a
     * dotted path easy to misread and hard to spot when it silently returns
     * the wrong level.
     *
     * Both halves are returned because the name alone is not a safe join key.
     * The name is a snapshot taken at push time, so renaming a control in
     * ServiceNow strands the old label on every request already in Salesforce -
     * which has happened here, and is why Salesforce still shows a column for
     * "Test Disaster Recovery Plan". The sys_id is what the grid matches on.
     */
    _control: function(gr) {
        var empty = { sysId: '', name: '' };

        var relId = gr.getValue('caf_conformance_type');
        if (!relId) {
            return empty;
        }
        var rel = new GlideRecord('x_gskn2_caf_compli_caf_relationship');
        if (!rel.get(relId)) {
            return empty;
        }
        var ctrlId = rel.getValue('caf_conformance_type');
        if (!ctrlId) {
            return empty;
        }
        var ctrl = new GlideRecord('x_gskn2_caf_compli_caf_conformance_type');
        if (!ctrl.get(ctrlId)) {
            return empty;
        }
        return { sysId: ctrlId, name: ctrl.getValue('name') };
    },

    /**
     * Field mapping for the CAF Control catalogue.
     *
     * active is read with getValue, which on a boolean returns '1' or '0' and
     * never 'true' - the Table API's JSON says "true", so a check written from
     * what a cnit get shows would be wrong here.
     */
    buildControlPayload: function(gr) {
        return {
            Name:         this._truncate(gr.getValue('name'), 80),
            SN_Number__c: gr.getValue('number'),
            Active__c:    gr.getValue('active') === '1'
        };
    },

    /**
     * Field mapping for CAF Task.
     *
     * The parent is linked by the request's External Id rather than by a
     * Salesforce Id, using the CAF_Request__r relationship. That removes any
     * ordering dependency between the two pushes and means no Salesforce Id
     * ever has to be stored back in ServiceNow.
     *
     * A task with no parent (they exist - CAFT0001007 has an empty caf_request)
     * simply omits the relationship rather than sending an empty one, which
     * Salesforce would reject.
     */
    buildTaskPayload: function(gr) {
        var payload = {
            Name:                       gr.getValue('number'),
            SN_Number__c:               gr.getValue('number'),
            Short_Description__c:       this._truncate(gr.getValue('short_description'), 255),
            State__c:                   this._stateLabel(gr.getValue('state')),
            Approval__c:                gr.getValue('approval'),
            Met_Criteria__c:            gr.getValue('met_criteria'),
            Planned_Completion_Date__c: this._toIso(gr.getValue('planned_completion_date'))
        };

        var parent = gr.getValue('caf_request');
        if (parent) {
            payload.CAF_Request__r = { ServiceNow_Sys_Id__c: parent };
        }
        return payload;
    },

    /**
     * OAuth 2.0 Client Credentials. Returns the access token, or null on
     * failure with the reason logged. Never logs the token or the secret.
     */
    getToken: function(force) {
        if (this._token && !force) {
            return this._token;
        }
        try {
            var req = new sn_ws.RESTMessageV2();
            req.setHttpMethod('POST');
            req.setEndpoint(this.instanceUrl + '/services/oauth2/token');
            req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            req.setRequestBody(
                'grant_type=client_credentials' +
                '&client_id=' + encodeURIComponent(this.clientId) +
                '&client_secret=' + encodeURIComponent(this.clientSecret)
            );
            req.setHttpTimeout(30000);

            var resp   = req.execute();
            var status = '' + resp.getStatusCode();

            if (status !== '200') {
                gs.error('[CAF->SF] token request failed, HTTP ' + status + ': ' + resp.getBody());
                return null;
            }
            this._token = JSON.parse(resp.getBody()).access_token;
            return this._token;

        } catch (e) {
            gs.error('[CAF->SF] token request exception: ' + e);
            return null;
        }
    },

    // --------------------------------------------------------------- private

    /**
     * One upsert. Never throws - a failed push must not roll back the
     * ServiceNow transaction that triggered it.
     */
    _push: function(gr, sobject, payload) {
        if (!this.enabled) {
            return this._result(false, '0', 'Sync disabled (x_gskn2_caf_compli.sf.enabled is not true)');
        }
        if (!this.instanceUrl || !this.clientId || !this.clientSecret) {
            return this._result(false, '0', 'Missing sf.instance_url, sf.client_id or sf.client_secret');
        }
        if (!gr || !gr.getUniqueValue()) {
            return this._result(false, '0', 'No record supplied');
        }

        // One retry with the cache cleared before giving up.
        //
        // On 2026-08-08 this returned HTTP 0 - a transport failure, not a
        // rejection - during a control delete, and the deleted control stayed
        // active in Salesforce as an orphan dashboard column. The retire push is
        // the one push in this integration with no second chance: every other
        // failure stays repairable through /caf/resync because the record still
        // exists, but by the time a retire push fails the record it would
        // re-send is already gone.
        var token = this.getToken();
        if (!token) {
            gs.warn('[CAF->SF] ' + sobject + ' token request failed, retrying once');
            token = this.getToken(true);
        }
        if (!token) {
            return this._result(false, '0', 'Could not obtain a Salesforce access token - see system log');
        }

        var number = gr.getValue('number');
        var url    = this.instanceUrl +
                     '/services/data/' + this.apiVersion +
                     '/sobjects/' + sobject + '/ServiceNow_Sys_Id__c/' + gr.getUniqueValue();

        var result = this._send(url, token, payload, number, sobject);

        // Status '0' is the transport-level failure again, distinct from any
        // status Salesforce chose to return. Replaying is safe: the upsert keys
        // on an External Id, so a duplicate delivery updates the same row rather
        // than creating a second one. A 4xx is a rejection and is not retried -
        // sending the same bad payload twice only doubles the log noise.
        if (!result.ok && result.status === '0') {
            gs.warn('[CAF->SF] ' + number + ' transport failure, retrying once');
            result = this._send(url, token, payload, number, sobject);
        }
        return result;
    },

    /** One upsert attempt. Never throws; the caller decides about retrying. */
    _send: function(url, token, payload, number, sobject) {
        try {
            var req = new sn_ws.RESTMessageV2();
            req.setHttpMethod('PATCH');
            req.setEndpoint(url);
            req.setRequestHeader('Content-Type', 'application/json');
            req.setRequestHeader('Authorization', 'Bearer ' + token);
            req.setRequestBody(JSON.stringify(payload));
            req.setHttpTimeout(30000);

            var resp   = req.execute();
            var status = '' + resp.getStatusCode();
            var body   = resp.getBody();

            // 200 updated with body, 201 created, 204 updated with no body
            if (status === '200' || status === '201' || status === '204') {
                gs.info('[CAF->SF] ' + number + ' -> ' + sobject + ', HTTP ' + status);
                return this._result(true, status, body);
            }

            gs.error('[CAF->SF] ' + number + ' -> ' + sobject + ' FAILED, HTTP ' + status + ': ' + body);
            return this._result(false, status, body);

        } catch (e) {
            gs.error('[CAF->SF] ' + number + ' -> ' + sobject + ' EXCEPTION: ' + e);
            return this._result(false, '0', '' + e);
        }
    },

    /**
     * CAF state is an integer choice. Pushing the label rather than the number
     * keeps the Salesforce side readable without a second lookup.
     */
    _stateLabel: function(value) {
        // An unset state is pushed as empty rather than falling through to the
        // default. '' + null is the four-character string "null", and that is
        // what State__c ended up holding - a value the grid renders as though
        // the record genuinely had a state called null.
        if (value === null || value === undefined || value === '') {
            return '';
        }
        switch ('' + value) {
            case '1':  return 'Open';
            case '2':  return 'In Progress';
            case '3':  return 'Closed Complete';
            case '-1': return 'Cancelled';
            default:   return '' + value;
        }
    },

    /**
     * ServiceNow stores date/time as 'yyyy-MM-dd HH:mm:ss' in UTC.
     * Salesforce wants ISO 8601 with an explicit zone.
     */
    _toIso: function(snDateTime) {
        if (!snDateTime) {
            return null;
        }
        return snDateTime.replace(' ', 'T') + 'Z';
    },

    _truncate: function(str, max) {
        if (!str) {
            return '';
        }
        return str.length > max ? str.substring(0, max) : str;
    },

    _result: function(ok, status, message) {
        return { ok: ok, status: status, message: message };
    },

    type: 'CAFSalesforceSync'
};
