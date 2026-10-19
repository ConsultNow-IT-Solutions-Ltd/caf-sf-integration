/**
 * Read model for the Approvals screen: the tasks waiting on an attestation,
 * and the decisions made most recently.
 *
 * "Waiting" means In Progress, because that is the only state the attestation
 * endpoint accepts. An Open task has not been started, so nobody can judge its
 * evidence yet; listing it here would put a task in the approver's queue that
 * the approver can do nothing with.
 *
 * Nothing here decides anything. The decision is made through cafAttestation,
 * which sends it to ServiceNow; the task leaves this queue when ServiceNow
 * closes it and the push carries the new state back.
 *
 * Both reads are cacheable and make no callout, so the queue still renders
 * from the mirror when ServiceNow is unreachable. Both run WITH USER_MODE.
 */
public with sharing class CafApprovalsController {

    /** Row cap for the queue. The screen warns when a reply is this long. */
    @TestVisible
    private static final Integer QUEUE_LIMIT = 500;

    /** Row cap for the recently decided list. */
    @TestVisible
    private static final Integer DECISION_LIMIT = 25;

    /**
     * The approver's queue: every task In Progress, soonest due first, with
     * its parent request's number, application and control.
     *
     * A task whose parent lookup is empty still comes back, with a null
     * CAF_Request__r; the LWC renders those columns blank rather than this
     * method dropping a task someone is waiting on.
     *
     * @return up to QUEUE_LIMIT tasks; never null
     * @throws QueryException when the user lacks read access to CAF_Task__c
     *         or one of the fields (WITH USER_MODE)
     */
    @AuraEnabled(cacheable=true)
    public static List<CAF_Task__c> getQueue() {
        return [
            SELECT Id, SN_Number__c, Short_Description__c, State__c, Approval__c,
                   Met_Criteria__c, ServiceNow_Sys_Id__c, Planned_Completion_Date__c,
                   LastModifiedDate,
                   CAF_Request__r.SN_Number__c,
                   CAF_Request__r.Business_Application__c,
                   CAF_Request__r.CAF_Control__c
            FROM CAF_Task__c
            WHERE State__c = 'In Progress'
            WITH USER_MODE
            ORDER BY Planned_Completion_Date__c ASC NULLS LAST, SN_Number__c
            LIMIT :QUEUE_LIMIT
        ];
    }

    /**
     * The last decisions that came back from ServiceNow, newest first. The
     * mirror's LastModifiedDate is when the push landed, which is close enough
     * to when the decision was made for a "recently decided" list.
     *
     * @return up to DECISION_LIMIT tasks whose Approval__c is approved or
     *         rejected; never null
     * @throws QueryException when the user lacks read access (WITH USER_MODE)
     */
    @AuraEnabled(cacheable=true)
    public static List<CAF_Task__c> getRecentDecisions() {
        return [
            SELECT Id, SN_Number__c, Short_Description__c, State__c, Approval__c,
                   Met_Criteria__c, LastModifiedDate,
                   CAF_Request__r.SN_Number__c,
                   CAF_Request__r.Business_Application__c,
                   CAF_Request__r.CAF_Control__c
            FROM CAF_Task__c
            WHERE Approval__c IN ('approved', 'rejected')
            WITH USER_MODE
            ORDER BY LastModifiedDate DESC
            LIMIT :DECISION_LIMIT
        ];
    }
}
