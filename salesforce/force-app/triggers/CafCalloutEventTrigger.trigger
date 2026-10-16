/**
 * Writes each CAF_Callout_Event__e to CAF_Integration_Log__c.
 *
 * Runs as the Automated Process user, in its own transaction, after the
 * publishing transaction has finished - whether that transaction committed or
 * rolled back. That is the point of routing the log through an event.
 */
trigger CafCalloutEventTrigger on CAF_Callout_Event__e (after insert) {
    List<CAF_Integration_Log__c> rows = new List<CAF_Integration_Log__c>();
    for (CAF_Callout_Event__e e : Trigger.new) {
        rows.add(new CAF_Integration_Log__c(
            Operation__c    = e.Operation__c,
            Method__c       = e.Method__c,
            Endpoint__c     = e.Endpoint__c,
            Status_Code__c  = e.Status_Code__c,
            Latency_Ms__c   = e.Latency_Ms__c,
            Error__c        = e.Error__c,
            Requested_By__c = String.isBlank(e.Requested_By__c) ? null : Id.valueOf(e.Requested_By__c),
            Called_At__c    = e.Called_At__c
        ));
    }
    insert rows;
}
