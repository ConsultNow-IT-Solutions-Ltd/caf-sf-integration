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

    /** How many of the most recent callouts the log section shows. */
    @TestVisible
    private static final Integer LOG_ROWS = 50;

    /** Row cap for the control catalogue. */
    @TestVisible
    private static final Integer CONTROL_ROWS = 200;

    /** One CAF setting: what is stored, and what the code actually uses. */
    public class Setting {
        /** DeveloperName, e.g. Callout_Timeout_Ms. Never blank. */
        @AuraEnabled public String name;
        /** MasterLabel, or the name with underscores as spaces when there is no record. */
        @AuraEnabled public String label;
        /** Value__c as stored; null when there is no record or it is blank. */
        @AuraEnabled public String configured;
        /** The value CafConfig resolves, after defaults and ceilings. */
        @AuraEnabled public String effective;
        /** Notes__c, or null. */
        @AuraEnabled public String notes;
        /** Whether a CAF_Setting__mdt record exists for this name. */
        @AuraEnabled public Boolean hasRecord;
    }

    /** One control in the catalogue, with how many requests point at it. */
    public class Control {
        @AuraEnabled public String name;
        @AuraEnabled public String snNumber;
        @AuraEnabled public String sysId;
        /** Never null: an unset checkbox reads as false. */
        @AuraEnabled public Boolean active;
        /** Requests joined on sys_id, plus those joined on the name. Never null. */
        @AuraEnabled public Integer requests;
    }

    /** Everything the Admin screen shows, in one cacheable reply. */
    public class Overview {
        @AuraEnabled public List<Setting> settings = new List<Setting>();
        @AuraEnabled public List<Control> controls = new List<Control>();
        /** False when the user cannot read CAF_Integration_Log__c; calls is then empty. */
        @AuraEnabled public Boolean logAccess = false;
        @AuraEnabled public List<CAF_Integration_Log__c> calls = new List<CAF_Integration_Log__c>();
    }

    /**
     * Settings, controls and - where the user may read it - the callout log.
     * The log is the only optional part: failing to read it leaves
     * logAccess false instead of failing the whole screen.
     *
     * @return the overview; never null, and none of its lists are null
     * @throws QueryException when the user lacks read access to the request
     *         or control objects (WITH USER_MODE)
     */
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
                o.calls = new List<CAF_Integration_Log__c>();
                o.logAccess = false;
            }
        }
        return o;
    }

    // ---------------------------------------------------------------- private

    /**
     * Every setting CafConfig reads, whether or not a record exists for it. A
     * missing record is a real state - the default is in use - and leaving it
     * off the list would hide that. Sorted by name.
     *
     * @return one entry per known or stored setting; never null
     */
    private static List<Setting> settings() {
        Map<String, String> effective = new Map<String, String>{
            'Callout_Timeout_Ms'   => String.valueOf(CafConfig.calloutTimeoutMs()),
            'Evidence_Max_Bytes'   => String.valueOf(CafConfig.evidenceMaxBytes()),
            'Logging_Enabled'      => String.valueOf(CafConfig.isEnabled('Logging_Enabled')),
            'ServiceNow_Task_Path' => CafConfig.serviceNowTaskPath()
        };

        Map<String, CAF_Setting__mdt> records = CAF_Setting__mdt.getAll();
        if (records == null) {
            records = new Map<String, CAF_Setting__mdt>();
        }
        Set<String> names = new Set<String>(effective.keySet());
        names.addAll(records.keySet());

        List<String> ordered = new List<String>(names);
        ordered.sort();

        List<Setting> out = new List<Setting>();
        for (String name : ordered) {
            if (String.isBlank(name)) {
                continue;
            }
            out.add(settingOf(name, records.get(name), effective.get(name)));
        }
        return out;
    }

    /**
     * Builds one setting row.
     *
     * @param name      the setting's DeveloperName
     * @param rec       its metadata record, or null when none exists
     * @param effective what CafConfig resolves it to, or null for a setting
     *                  CafConfig does not read (then the stored value is shown)
     * @return the row
     */
    @TestVisible
    private static Setting settingOf(String name, CAF_Setting__mdt rec, String effective) {
        Setting s = new Setting();
        s.name = name;
        s.hasRecord = rec != null;
        s.label = rec != null && String.isNotBlank(rec.MasterLabel) ? rec.MasterLabel : name.replace('_', ' ');
        s.configured = rec != null && String.isNotBlank(rec.Value__c) ? rec.Value__c : null;
        s.notes = rec != null ? rec.Notes__c : null;
        s.effective = effective != null ? effective : s.configured;
        return s;
    }

    /**
     * All controls, inactive ones included - an inactive control that still
     * has requests against it is the thing an administrator wants to find.
     * Requests join on sys_id, falling back to the name, as the grid does.
     *
     * @return controls, active first then by name; never null
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
            if (total == null || total <= 0) {
                continue;
            }
            if (String.isNotBlank(sysId)) {
                addTo(bySysId, sysId, total);
            } else if (String.isNotBlank(name)) {
                addTo(byName, name, total);
            }
        }

        List<Control> out = new List<Control>();
        for (CAF_Control_Catalog__c c : [
            SELECT Name, SN_Number__c, ServiceNow_Sys_Id__c, Active__c
            FROM CAF_Control_Catalog__c
            WITH USER_MODE
            ORDER BY Active__c DESC, Name
            LIMIT :CONTROL_ROWS
        ]) {
            Control row = new Control();
            row.name = c.Name;
            row.snNumber = c.SN_Number__c;
            row.sysId = c.ServiceNow_Sys_Id__c;
            row.active = c.Active__c == true;
            Integer n = 0;
            if (String.isNotBlank(c.ServiceNow_Sys_Id__c) && bySysId.containsKey(c.ServiceNow_Sys_Id__c)) {
                n += bySysId.get(c.ServiceNow_Sys_Id__c);
            }
            if (String.isNotBlank(c.Name) && byName.containsKey(c.Name)) {
                n += byName.get(c.Name);
            }
            row.requests = n;
            out.add(row);
        }
        return out;
    }

    /**
     * Adds to a running count, starting from 0 for a key not yet seen.
     *
     * @param counts the map of counts
     * @param key    the key to add to; not blank
     * @param n      the amount to add
     */
    private static void addTo(Map<String, Integer> counts, String key, Integer n) {
        Integer current = counts.get(key);
        counts.put(key, (current == null ? 0 : current) + n);
    }

    /**
     * The most recent callouts, newest first.
     *
     * @return up to LOG_ROWS log rows; never null
     * @throws QueryException when the user can see the object but not one of
     *         its fields (WITH USER_MODE)
     */
    private static List<CAF_Integration_Log__c> recentCalls() {
        return [
            SELECT Id, Name, Operation__c, Method__c, Endpoint__c, Status_Code__c,
                   Succeeded__c, Latency_Ms__c, Error__c, Called_At__c,
                   Requested_By__r.Name
            FROM CAF_Integration_Log__c
            WITH USER_MODE
            ORDER BY Called_At__c DESC NULLS LAST
            LIMIT :LOG_ROWS
        ];
    }
}
