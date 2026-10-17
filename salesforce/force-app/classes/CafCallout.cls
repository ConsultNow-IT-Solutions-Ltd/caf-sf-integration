/**
 * The one place a CAF service calls ServiceNow, so that every call is timed
 * and logged the same way.
 *
 * Logging goes through CAF_Callout_Event__e rather than a direct insert, for
 * two reasons. The callers turn a ServiceNow failure into an
 * AuraHandledException, which rolls the transaction back, and a log row
 * inserted directly would vanish with it; an event published immediately does
 * not. And Apex refuses a callout after uncommitted DML, so writing a row after
 * the first call would break any caller that makes a second one.
 *
 * Events are therefore held here and published by flush(), which each caller
 * runs in a finally block after its last callout.
 */
public with sharing class CafCallout {

    /** Turned off by CAF_Setting.Logging_Enabled = false. */
    private static final String LOGGING_SETTING = 'Logging_Enabled';

    private static final Integer MAX_ERROR = 32000;

    @TestVisible
    private static List<CAF_Callout_Event__e> pending = new List<CAF_Callout_Event__e>();

    /**
     * Send a request to ServiceNow and record it. A connection failure is
     * recorded and then rethrown unchanged, so callers keep their own handling.
     *
     * @param operation short label for the log, such as 'task.update'
     */
    public static HttpResponse send(String operation, String method, String endpoint, String body) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod(method);
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Accept', 'application/json');
        if (body != null) {
            req.setBody(body);
        }
        req.setTimeout(CafConfig.calloutTimeoutMs());

        Long started = System.currentTimeMillis();
        HttpResponse res;
        try {
            res = new Http().send(req);
        } catch (Exception e) {
            record(operation, method, endpoint, null, started, e.getMessage());
            throw e;
        }

        Integer code = res.getStatusCode();
        Boolean ok = code >= 200 && code < 300;
        record(operation, method, endpoint, code, started, ok ? null : res.getBody());
        return res;
    }

    /** Publish what has been recorded. Safe to call when nothing has been. */
    public static void flush() {
        if (pending.isEmpty()) {
            return;
        }
        List<CAF_Callout_Event__e> batch = pending;
        pending = new List<CAF_Callout_Event__e>();
        if (CafConfig.isEnabled(LOGGING_SETTING)) {
            EventBus.publish(batch);
        }
    }

    // ---------------------------------------------------------------- private

    private static void record(String operation, String method, String endpoint,
                               Integer code, Long started, String error) {
        pending.add(new CAF_Callout_Event__e(
            Operation__c     = operation,
            Method__c        = method,
            // The named credential prefix is the same on every row and pushes
            // the useful part of the path towards the 255-character limit.
            Endpoint__c      = endpoint.removeStart('callout:ServiceNow_CAF').abbreviate(255),
            Status_Code__c   = code,
            Latency_Ms__c    = System.currentTimeMillis() - started,
            Error__c         = error == null ? null : error.abbreviate(MAX_ERROR),
            Requested_By__c  = UserInfo.getUserId(),
            Called_At__c     = System.now()
        ));
    }
}
