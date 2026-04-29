/**
 * Business Rule: CAF - Push Control to Salesforce
 *
 * Table:   CAF Conformance Type [x_gskn2_caf_compli_caf_conformance_type]
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
 * The same echo-loop guard the request and task rules carry. Nothing in
 * Salesforce writes back to this table today, so the guard is precautionary
 * rather than load-bearing - but a rule that is the odd one out is the one
 * someone later assumes was deliberate.
 * ------------------------------------------------------------------
 *
 * Why this rule exists at all: the Salesforce grid used to derive its columns
 * from the CAF Requests it held, so a control with no requests against it was
 * invisible there. The ServiceNow portal widget does the opposite - it queries
 * this table for active controls and renders a column for each, showing N/A in
 * any cell where an initiated application has no request for that control. The
 * two grids are meant to agree, and without this push they cannot.
 *
 * Choose "async" from the choice list, not "async_always" - and be aware the
 * choice LABELLED async has the value async_always; plain async is the
 * deprecated one.
 */
(function executeRule(current, previous /*null when async*/) {

    new x_gskn2_caf_compli.CAFSalesforceSync().pushControl(current);

})(current, previous);
