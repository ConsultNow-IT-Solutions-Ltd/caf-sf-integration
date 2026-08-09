/**
 * Drift detection between ServiceNow and Salesforce.
 *
 * Every outbound push in this integration is fire-and-forget: CAFSalesforceSync
 * logs a failure with gs.error and returns, because a Salesforce outage must not
 * roll back the ServiceNow transaction that triggered it. That is the right
 * trade, but it leaves the failure recorded only in a log nobody reads, while
 * the dashboard carries on showing a value that is no longer true.
 *
 * This class answers the question that follows from it — do the two systems
 * still agree? — by pulling ServiceNow's own view over the Scripted REST API and
 * comparing it against the mirrored records here.
 *
 * ServiceNow is the system of record throughout. A difference is always
 * described as Salesforce being wrong, because Salesforce holds a mirror, and a
 * mirror that disagrees is stale by definition.
 *
 * Note the absence of cacheable=true on check(): an Apex method that makes a
 * callout cannot be cacheable, so the LWC calls this imperatively rather than
 * through a wire adapter. That is also what makes the Re-check button honest —
 * it really does go and look.
 */
public with sharing class CafSyncHealth {

    private static final String SNAPSHOT = 'callout:ServiceNow_CAF/api/x_gskn2_caf_compli/caf/snapshot';
    private static final String RESYNC   = 'callout:ServiceNow_CAF/api/x_gskn2_caf_compli/caf/resync/';

    // ------------------------------------------------------------------ types

    public class Report {
        @AuraEnabled public Boolean inSync;
        @AuraEnabled public Integer snRequests;
        @AuraEnabled public Integer snTasks;
        @AuraEnabled public Integer snControls;
        @AuraEnabled public Integer sfRequests;
        @AuraEnabled public Integer sfTasks;
        @AuraEnabled public Integer sfControls;
        @AuraEnabled public Integer comparedCount;
        @AuraEnabled public Datetime checkedAt;
        @AuraEnabled public List<Difference> differences = new List<Difference>();
    }

    public class Difference {
        @AuraEnabled public String recordNumber;
        @AuraEnabled public String recordType;   // Request | Task | Control
        @AuraEnabled public String kind;         // what sort of disagreement
        @AuraEnabled public String fieldLabel;
        @AuraEnabled public String servicenow;
        @AuraEnabled public String salesforce;
        @AuraEnabled public String sysId;        // null when ServiceNow has no such record
        @AuraEnabled public Boolean canResync;
    }

    // ----------------------------------------------------------------- public

    @AuraEnabled
    public static Report check() {
        Map<String, Object> snapshot = fetchSnapshot();

        Report r = new Report();
        r.checkedAt = Datetime.now();

        List<Object> snRequests = (List<Object>) snapshot.get('requests');
        List<Object> snTasks    = (List<Object>) snapshot.get('tasks');
        List<Object> snControls = (List<Object>) snapshot.get('controls');
        if (snRequests == null) { snRequests = new List<Object>(); }
        if (snTasks == null)    { snTasks = new List<Object>(); }
        // Absent rather than empty when running against a ServiceNow instance
        // whose snapshot resource predates catalogue support. Treating that as
        // "no controls" would report every mirrored control as an orphan, so the
        // comparison is skipped entirely instead.
        Boolean haveControls = snControls != null;
        if (!haveControls) { snControls = new List<Object>(); }

        r.snRequests = snRequests.size();
        r.snTasks    = snTasks.size();
        r.snControls = snControls.size();

        compareRequests(snRequests, r);
        compareTasks(snTasks, r);
        if (haveControls) { compareControls(snControls, r); }

        r.comparedCount = r.snRequests + r.snTasks + r.snControls;
        r.inSync = r.differences.isEmpty();
        return r;
    }

    /**
     * Re-push one record from ServiceNow. Never called automatically — the panel
     * exposes it as a button next to a difference someone is looking at.
     */
    @AuraEnabled
    public static String resync(String recordType, String sysId) {
        if (String.isBlank(recordType) || String.isBlank(sysId)) {
            throw new AuraHandledException('recordType and sysId are both required.');
        }

        HttpRequest req = new HttpRequest();
        req.setEndpoint(RESYNC + recordType.toLowerCase() + '/' + sysId);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody('{}');
        req.setTimeout(120000);

        HttpResponse res;
        try {
            res = new Http().send(req);
        } catch (Exception e) {
            throw new AuraHandledException('Could not reach ServiceNow: ' + e.getMessage());
        }

        Integer code = res.getStatusCode();
        if (code >= 200 && code < 300) {
            return res.getBody();
        }
        throw new AuraHandledException('ServiceNow returned ' + code + ': ' + res.getBody());
    }

    // ---------------------------------------------------------------- private

    private static Map<String, Object> fetchSnapshot() {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(SNAPSHOT);
        req.setMethod('GET');
        req.setHeader('Accept', 'application/json');
        req.setTimeout(120000);

        HttpResponse res;
        try {
            res = new Http().send(req);
        } catch (Exception e) {
            throw new AuraHandledException('Could not reach ServiceNow: ' + e.getMessage());
        }

        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw new AuraHandledException(
                'ServiceNow returned ' + res.getStatusCode() + ': ' + res.getBody());
        }

        Map<String, Object> body =
            (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

        // Scripted REST wraps the returned object in "result".
        if (body.containsKey('result') && body.get('result') instanceof Map<String, Object>) {
            return (Map<String, Object>) body.get('result');
        }
        return body;
    }

    private static void compareRequests(List<Object> snRows, Report r) {
        Map<String, Map<String, Object>> sn = byNumber(snRows);

        Map<String, CAF_Request__c> sf = new Map<String, CAF_Request__c>();
        for (CAF_Request__c c : [
            SELECT Id, SN_Number__c, CAF_Status__c, State__c, Short_Description__c,
                   ServiceNow_Sys_Id__c
            FROM CAF_Request__c
            LIMIT 2000
        ]) {
            sf.put(c.SN_Number__c, c);
        }
        r.sfRequests = sf.size();

        for (String num : sn.keySet()) {
            Map<String, Object> row = sn.get(num);
            CAF_Request__c mirror = sf.get(num);

            if (mirror == null) {
                r.differences.add(missing('Request', num, str(row.get('sys_id')),
                    'Missing in Salesforce'));
                continue;
            }
            compareField(r, 'Request', num, str(row.get('sys_id')), 'Status',
                str(row.get('caf_status')), mirror.CAF_Status__c);
            compareField(r, 'Request', num, str(row.get('sys_id')), 'State',
                str(row.get('state')), mirror.State__c);
            compareField(r, 'Request', num, str(row.get('sys_id')), 'Description',
                str(row.get('short_description')), mirror.Short_Description__c);
        }

        for (String num : sf.keySet()) {
            if (!sn.containsKey(num)) {
                r.differences.add(missing('Request', num, null, 'Missing in ServiceNow'));
            }
        }
    }

    private static void compareTasks(List<Object> snRows, Report r) {
        Map<String, Map<String, Object>> sn = byNumber(snRows);

        Map<String, CAF_Task__c> sf = new Map<String, CAF_Task__c>();
        for (CAF_Task__c c : [
            SELECT Id, SN_Number__c, State__c, Approval__c, Met_Criteria__c,
                   Short_Description__c, ServiceNow_Sys_Id__c
            FROM CAF_Task__c
            LIMIT 2000
        ]) {
            sf.put(c.SN_Number__c, c);
        }
        r.sfTasks = sf.size();

        for (String num : sn.keySet()) {
            Map<String, Object> row = sn.get(num);
            CAF_Task__c mirror = sf.get(num);

            if (mirror == null) {
                r.differences.add(missing('Task', num, str(row.get('sys_id')),
                    'Missing in Salesforce'));
                continue;
            }
            compareField(r, 'Task', num, str(row.get('sys_id')), 'State',
                str(row.get('state')), mirror.State__c);
            compareField(r, 'Task', num, str(row.get('sys_id')), 'Approval',
                str(row.get('approval')), mirror.Approval__c);
            compareField(r, 'Task', num, str(row.get('sys_id')), 'Criteria met',
                str(row.get('met_criteria')), mirror.Met_Criteria__c);
        }

        for (String num : sf.keySet()) {
            if (!sn.containsKey(num)) {
                r.differences.add(missing('Task', num, null, 'Missing in ServiceNow'));
            }
        }
    }

    /**
     * The control catalogue.
     *
     * Keyed on sys_id, not on number, unlike the two comparisons above. Control
     * numbers are not unique on this instance — CNFTYPE0001004 and CNFTYPE0001005
     * each name two different controls — so keying on number would compare the
     * wrong pairs and report drift that is really a collision.
     *
     * The asymmetry below is the point of the whole method. A Salesforce row with
     * no ServiceNow counterpart is only a defect when it is still active: a
     * deleted control is deliberately mirrored as Active__c = false and the row is
     * kept as evidence it once existed, so a retired orphan is the design working.
     * An *active* orphan is a retire push that failed, and it renders as a column
     * of N/A for a control nobody can see — which happened on 2026-08-08 and was
     * invisible to this class until it learned to look here.
     */
    private static void compareControls(List<Object> snRows, Report r) {
        Map<String, Map<String, Object>> sn = new Map<String, Map<String, Object>>();
        for (Object o : snRows) {
            Map<String, Object> row = (Map<String, Object>) o;
            sn.put(str(row.get('sys_id')), row);
        }

        Map<String, CAF_Control_Catalog__c> sf = new Map<String, CAF_Control_Catalog__c>();
        for (CAF_Control_Catalog__c c : [
            SELECT Id, Name, SN_Number__c, Active__c, ServiceNow_Sys_Id__c
            FROM CAF_Control_Catalog__c
            LIMIT 2000
        ]) {
            sf.put(c.ServiceNow_Sys_Id__c, c);
        }
        r.sfControls = sf.size();

        for (String sysId : sn.keySet()) {
            Map<String, Object> row = sn.get(sysId);
            String label = str(row.get('name'));
            CAF_Control_Catalog__c mirror = sf.get(sysId);

            if (mirror == null) {
                r.differences.add(missing('Control', label, sysId, 'Missing in Salesforce'));
                continue;
            }
            compareField(r, 'Control', label, sysId, 'Name', label, mirror.Name);
            compareField(r, 'Control', label, sysId, 'Active',
                str(row.get('active')), String.valueOf(mirror.Active__c));
        }

        for (String sysId : sf.keySet()) {
            if (sn.containsKey(sysId)) {
                continue;
            }
            CAF_Control_Catalog__c orphan = sf.get(sysId);
            if (orphan.Active__c != true) {
                // Retired and gone from ServiceNow. Exactly what a mirrored
                // delete is supposed to look like.
                continue;
            }
            Difference d = missing('Control', orphan.Name, null, 'Missing in ServiceNow');
            d.kind = 'Active in Salesforce, deleted in ServiceNow';
            r.differences.add(d);
        }
    }

    private static Map<String, Map<String, Object>> byNumber(List<Object> rows) {
        Map<String, Map<String, Object>> out = new Map<String, Map<String, Object>>();
        for (Object o : rows) {
            Map<String, Object> row = (Map<String, Object>) o;
            out.put(str(row.get('number')), row);
        }
        return out;
    }

    /**
     * Blank and null mean the same thing across the two systems — ServiceNow
     * returns null for an empty field, Salesforce may hold either — so treating
     * them as different would report drift on every record with an empty
     * approval, which is most of them.
     */
    private static void compareField(Report r, String recordType, String num,
                                     String sysId, String fieldLabel,
                                     String snValue, String sfValue) {
        if (String.isBlank(snValue) && String.isBlank(sfValue)) {
            return;
        }
        if (snValue == sfValue) {
            return;
        }
        Difference d = new Difference();
        d.recordType   = recordType;
        d.recordNumber = num;
        d.kind         = fieldLabel + ' differs';
        d.fieldLabel   = fieldLabel;
        d.servicenow   = String.isBlank(snValue) ? '(empty)' : snValue;
        d.salesforce   = String.isBlank(sfValue) ? '(empty)' : sfValue;
        d.sysId        = sysId;
        d.canResync    = true;
        r.differences.add(d);
    }

    private static Difference missing(String recordType, String num,
                                      String sysId, String kind) {
        Difference d = new Difference();
        d.recordType   = recordType;
        d.recordNumber = num;
        d.kind         = kind;
        d.fieldLabel   = '';
        d.servicenow   = (sysId == null) ? 'not present' : 'present';
        d.salesforce   = (sysId == null) ? 'present' : 'not present';
        d.sysId        = sysId;
        // Nothing to re-push when ServiceNow is the side that lacks the record.
        // That is a deletion to mirror, not drift to repair, and it needs a
        // human decision rather than a button.
        d.canResync    = (sysId != null);
        return d;
    }

    private static String str(Object o) {
        return (o == null) ? null : String.valueOf(o);
    }
}
