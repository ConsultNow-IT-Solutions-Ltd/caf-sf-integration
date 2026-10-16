/**
 * Read model for the CAF compliance grid.
 *
 * Deliberately thin: it returns rows and lets the LWC pivot them. The grid's
 * shape is driven by whatever controls exist in the data, so pivoting in Apex
 * would mean inventing a column contract that the client then has to trust.
 *
 * Two reads rather than one, because the column list and the cell data have
 * different sources. Columns come from the control catalogue, so a control with
 * no requests still gets a column with N/A down it - which is what the
 * ServiceNow portal widget does. Deriving columns from the requests alone made
 * a newly created control invisible here until someone generated a request
 * against it, and the two grids are meant to agree.
 *
 * Both stay cacheable=true. Neither makes a callout, so the grid still renders
 * from the mirror when ServiceNow is unreachable - the property that ruled out
 * fetching the catalogue live.
 *
 * Both run WITH USER_MODE, so object and field permissions are enforced as
 * well as sharing. A user without the CAF permission set gets an error naming
 * the missing access rather than a grid silently missing columns.
 */
public with sharing class CafDashboardController {

    @AuraEnabled(cacheable=true)
    public static List<CAF_Request__c> getRequests() {
        return [
            SELECT Id, SN_Number__c, Short_Description__c, Business_Application__c,
                   CAF_Control__c, CAF_Control_Sys_Id__c, CAF_Status__c, State__c,
                   Planned_Completion_Date__c, ServiceNow_Sys_Id__c
            FROM CAF_Request__c
            WHERE Business_Application__c != null
              AND CAF_Control__c != null
            WITH USER_MODE
            ORDER BY Business_Application__c, CAF_Control__c
            LIMIT 2000
        ];
    }

    /**
     * Active controls only, ordered by name - the same filter and the same sort
     * the ServiceNow widget applies, so the columns land in the same order in
     * both grids.
     */
    @AuraEnabled(cacheable=true)
    public static List<CAF_Control_Catalog__c> getControls() {
        return [
            SELECT Id, Name, SN_Number__c, ServiceNow_Sys_Id__c
            FROM CAF_Control_Catalog__c
            WHERE Active__c = true
            WITH USER_MODE
            ORDER BY Name
            LIMIT 200
        ];
    }
}
