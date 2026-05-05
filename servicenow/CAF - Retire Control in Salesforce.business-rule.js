/**
 * Business Rule: CAF - Retire Control in Salesforce
 *
 * Table:   CAF Conformance Type [x_gskn2_caf_compli_caf_conformance_type]
 * When:    after
 * Delete:  true   (insert and update are handled by CAF - Push Control to Salesforce)
 * Order:   1000
 *
 * ------------------------------------------------------------------
 * CONDITION FIELD - paste this into the Condition box, not the script:
 *
 *   gs.getUserName() != gs.getProperty('x_gskn2_caf_compli.sf.integration_user', 'sf.integration')
 *
 * The same echo-loop guard the other three rules carry.
 * ------------------------------------------------------------------
 *
 * Synchronous, not async, and that is the one deliberate departure from the
 * other push rules. An async rule fires after the transaction commits, by which
 * point the record is gone and `current` is unreliable - the sys_id this needs
 * for the upsert key is exactly what is no longer there. An "after delete" rule
 * still holds the deleted record's values.
 *
 * The usual objection to a synchronous callout - a slow Salesforce hanging the
 * user's save - is weak here on both counts. Deleting a CAF Control is a rare
 * admin action rather than something done in bulk, and `_push` never throws: a
 * Salesforce outage logs an error and returns, so the ServiceNow delete still
 * commits. The cost of the outage is a stale Salesforce column, which is the
 * same thing that happened before this rule existed.
 *
 * Retire rather than delete: the Salesforce row stays with Active__c = false, so
 * the column disappears from the grid while the record survives as evidence the
 * control once existed. See CAFSalesforceSync.retireControl.
 */
(function executeRule(current, previous /*null when async*/) {

    new x_gskn2_caf_compli.CAFSalesforceSync().retireControl(current);

})(current, previous);
