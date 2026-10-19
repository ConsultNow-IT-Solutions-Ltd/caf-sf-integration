/**
 * Read model for the Admin screen: what the integration is configured to do,
 * which controls Salesforce knows about, and what its recent callouts did.
 *
 * Read-only on purpose. Settings are custom metadata, changed in Setup or by
 * a deploy; controls are owned by ServiceNow and arrive on the push. A screen
 * that edited either would be a second way to change them that bypasses the
 * first.
 *
 * Settings are reported twice - the value stored and the value CafConfig will
 * actually use - because the two differ whenever a value is blank, will not
 * convert, or is above a ceiling, and that difference is exactly what an
 * administrator looking at this screen needs to see.
 *
 * The callout log is optional. CAF_Integration does not grant read access to
 * CAF_Integration_Log__c (CAF_Admin does), so a user without it gets the rest
 * of the screen and logAccess = false rather than an error for the whole page.
 */
public with sharing class CafAdminController {

    @TestVisible
    private static final Integer LOG_ROWS = 50;

    public class Setting {
        @AuraEnabled public String name;
        @AuraEnabled public String label;
        @AuraEnabled public String configured;
        @AuraEnabled public String effective;
        @AuraEnabled public String notes;
        @AuraEnabled public Boolean hasRecord;
    }

    public class Control {
        @AuraEnabled public String name;
        @AuraEnabled public String snNumber;
        @AuraEnabled public String sysId;
        @AuraEnabled public Boolean active;
        @AuraEnabled public Integer requests;
    }

    public class Overview {
        @AuraEnabled public List<Setting> settings = new List<Setting>();
        @AuraEnabled public List<Control> controls = new List<Control>();
        @AuraEnabled public Boolean logAccess = false;
        @AuraEnabled public List<CAF_Integration_Log__c> calls = new List<CAF_Integration_Log__c>();
    }

    @AuraEnabled(cacheable=true)
    public static Overview getOverview() {
        Overview o = new Overview();
        o.settings = settings();
        o.controls = controls();
        if (Schema.SObjectType.CAF_Integration_Log__c.isAccessible()) {
            try {
                o.calls = recentCalls();
                o.logAccess = true;
            } catch (QueryException e) {
                // Object access without field access: same answer as none.
                o.logAccess = false;
            }
        }
        return o;
    }

    // ---------------------------------------------------------------- private

    /**
     * Every setting CafConfig reads, whether or not a record exists for it. A
     * missing record is a real state - the default is in use - and leaving it
     * off the list would hide that.
     */
    private static List<Setting> settings() {
        Map<String, String> effective = new Map<String, String>{
            'Callout_Timeout_Ms'   => String.valueOf(CafConfig.calloutTimeoutMs()),
            'Evidence_Max_Bytes'   => String.valueOf(CafConfig.evidenceMaxBytes()),
            'Logging_Enabled'      => String.valueOf(CafConfig.isEnabled('Logging_Enabled')),
            'ServiceNow_Task_Path' => CafConfig.serviceNowTaskPath()
        };

        Map<String, CAF_Setting__mdt> records = CAF_Setting__mdt.getAll();
        Set<String> names = new Set<String>(effective.keySet());
        names.addAll(records.keySet());

        List<String> ordered = new List<String>(names);
        ordered.sort();

        List<Setting> out = new List<Setting>();
        for (String name : ordered) {
            CAF_Setting__mdt rec = records.get(name);
            Setting s = new Setting();
            s.name = name;
            s.label = rec != null ? rec.MasterLabel : name.replace('_', ' ');
            s.configured = rec != null ? rec.Value__c : null;
            s.notes = rec != null ? rec.Notes__c : null;
            s.hasRecord = rec != null;
            s.effective = effective.containsKey(name) ? effective.get(name) : s.configured;
            out.add(s);
        }
        return out;
    }

    /**
     * All controls, inactive ones included - an inactive control that still
     * has requests against it is the thing an administrator wants to find.
     * Requests join on sys_id, falling back to the name, as the grid does.
     */
    private static List<Control> controls() {
        Map<String, Integer> bySysId = new Map<String, Integer>();
        Map<String, Integer> byName = new Map<String, Integer>();
        for (AggregateResult row : [
            SELECT CAF_Control_Sys_Id__c sysId, CAF_Control__c controlName, COUNT(Id) total
            FROM CAF_Request__c
            WHERE CAF_Control__c != null
            WITH USER_MODE
            GROUP BY CAF_Control_Sys_Id__c, CAF_Control__c
        ]) {
            String sysId = (String) row.get('sysId');
            String name = (String) row.get('controlName');
            Integer total = (Integer) row.get('total');
            if (String.isNotBlank(sysId)) {
                bySysId.put(sysId, total + (bySysId.containsKey(sysId) ? bySysId.get(sysId) : 0));
            } else {
                byName.put(name, total + (byName.containsKey(name) ? byName.get(name) : 0));
            }
        }

        List<Control> out = new List<Control>();
        for (CAF_Control_Catalog__c c : [
            SELECT Name, SN_Number__c, ServiceNow_Sys_Id__c, Active__c
            FROM CAF_Control_Catalog__c
            WITH USER_MODE
            ORDER BY Active__c DESC, Name
            LIMIT 200
        ]) {
            Control row = new Control();
            row.name = c.Name;
            row.snNumber = c.SN_Number__c;
            row.sysId = c.ServiceNow_Sys_Id__c;
            row.active = c.Active__c;
            Integer n = 0;
            if (c.ServiceNow_Sys_Id__c != null && bySysId.containsKey(c.ServiceNow_Sys_Id__c)) {
                n += bySysId.get(c.ServiceNow_Sys_Id__c);
            }
            if (byName.containsKey(c.Name)) {
                n += byName.get(c.Name);
            }
            row.requests = n;
            out.add(row);
        }
        return out;
    }

    private static List<CAF_Integration_Log__c> recentCalls() {
        return [
            SELECT Id, Name, Operation__c, Method__c, Endpoint__c, Status_Code__c,
                   Succeeded__c, Latency_Ms__c, Error__c, Called_At__c,
                   Requested_By__r.Name
            FROM CAF_Integration_Log__c
            WITH USER_MODE
            ORDER BY Called_At__c DESC
            LIMIT :LOG_ROWS
        ];
    }
}
