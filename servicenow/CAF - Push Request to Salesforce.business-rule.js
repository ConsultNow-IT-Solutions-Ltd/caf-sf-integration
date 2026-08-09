/**
 * Business Rule: CAF - Push Request to Salesforce
 *
 * Table:   CAF Request [x_gskn2_caf_compli_caf_req]
 * When:    async
 * Insert:  true
 * Update:  true
 * Order:   1000
 *
 * ------------------------------------------------------------------
 * CONDITION FIELD - paste this into the Condition box, not the script:
 *
 *   gs.getUserName() != gs.getProperty('x_gskn2_caf_compli.sf.integration_user', 'sf.integration')
 *
 * That is the echo-loop guard (watch-out 4). Once the inbound Scripted REST
 * API exists, a Salesforce-originated write lands as the integration user;
 * without this the write triggers a push straight back to Salesforce, which
 * triggers Salesforce logic, which writes back again. Idempotent upsert does
 * not save you - it is a loop, not a duplicate.
 *
 * The condition lives in the Condition field rather than the script because it
 * is evaluated synchronously at trigger time, while an async rule body runs
 * later in the scheduler where the session user is no longer reliable.
 * ------------------------------------------------------------------
 *
 * Why async: the callout must not sit inside the user's save transaction. A
 * slow or unreachable Salesforce would otherwise hang the form, and a thrown
 * error would roll back a legitimate CAF Request.
 */
(function executeRule(current, previous /*null when async*/) {

    new x_gskn2_caf_compli.CAFSalesforceSync().pushRequest(current);

})(current, previous);
