/**
 * Write-back to ServiceNow.
 *
 * Salesforce owns no CAF state. Every action here is a callout to the Scripted
 * REST API in x_gskn2_caf_compli, which applies the change through ServiceNow's
 * own business rules and returns the result. The mirrored CAF_Task__c record is
 * never edited directly — doing so would put Salesforce and ServiceNow into
 * disagreement about a value ServiceNow is the system of record for.
 *
 * The callout authenticates through the ServiceNow_CAF named credential as
 * sf.integration. That user is load-bearing: the outbound business rules skip
 * anything it writes, and the inbound API reconciles the affected records
 * explicitly instead.
 */
public with sharing class CafTaskService {

    @AuraEnabled(cacheable=true)
    public static List<CAF_Task__c> getTasks(String requestExternalId) {
        return [
            SELECT Id, SN_Number__c, Short_Description__c, State__c, Approval__c,
                   Met_Criteria__c, ServiceNow_Sys_Id__c, Planned_Completion_Date__c
            FROM CAF_Task__c
            WHERE CAF_Request__r.ServiceNow_Sys_Id__c = :requestExternalId
            WITH USER_MODE
            ORDER BY SN_Number__c
            LIMIT 200
        ];
    }

    /**
     * Apply a change in ServiceNow. Returns the API's response body.
     *
     * Field names are ServiceNow's, not Salesforce's, because this is a message
     * to ServiceNow rather than a record update here. The inbound API enforces
     * its own allow-list, so anything not permitted fails there with a 400
     * rather than being quietly dropped.
     */
    @AuraEnabled
    public static String applyChange(String sysId, String field, String value) {
        if (String.isBlank(sysId) || String.isBlank(field)) {
            throw new AuraHandledException('sysId and field are both required.');
        }
        CafAccess.require(CafAccess.WORK_TASKS, 'change tasks');

        Map<String, Object> body = new Map<String, Object>{ field => value };

        // The inbound call reconciles two records synchronously, hence the
        // long timeout CafCallout applies.
        HttpResponse res;
        try {
            res = CafCallout.send('task.update', 'PATCH',
                                  CafConfig.serviceNowTaskPath() + sysId, JSON.serialize(body));
        } catch (Exception e) {
            throw new AuraHandledException('Could not reach ServiceNow: ' + e.getMessage());
        } finally {
            CafCallout.flush();
        }

        Integer code = res.getStatusCode();
        if (code >= 200 && code < 300) {
            return res.getBody();
        }
        throw new AuraHandledException('ServiceNow returned ' + code + ': ' + res.getBody());
    }
}
