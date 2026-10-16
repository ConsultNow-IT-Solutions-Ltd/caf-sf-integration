/**
 * Configuration for the CAF classes, read from CAF_Setting__mdt.
 *
 * Every setting has a default here, and the default is what the code did
 * before the setting existed. A missing record, a blank value or one that will
 * not convert therefore changes nothing; it does not take the integration down.
 *
 * Custom metadata rather than a custom setting because it deploys with the
 * package: a fresh org gets the same values as this one without a data load.
 */
public with sharing class CafConfig {

    private static final String DEFAULT_TASK_PATH =
        'callout:ServiceNow_CAF/api/x_gskn2_caf_compli/caf/task/';

    /**
     * The file and its base64 expansion share the 6MB heap, and the callout
     * body is capped at 6MB too. Two megabytes of file is about 2.7MB encoded
     * and clears both, so the setting may lower the cap but not raise it.
     */
    @TestVisible
    private static final Integer EVIDENCE_CEILING = 2097152;

    private static final Integer MAX_TIMEOUT_MS = 120000;

    /** Values set by tests, consulted before the metadata. */
    @TestVisible
    private static Map<String, String> overrides = new Map<String, String>();

    private static Map<String, String> values;

    public static String serviceNowTaskPath() {
        String path = text('ServiceNow_Task_Path', DEFAULT_TASK_PATH);
        return path.endsWith('/') ? path : path + '/';
    }

    public static Integer evidenceMaxBytes() {
        Integer configured = whole('Evidence_Max_Bytes', EVIDENCE_CEILING);
        return configured > 0 ? Math.min(configured, EVIDENCE_CEILING) : EVIDENCE_CEILING;
    }

    public static Integer calloutTimeoutMs() {
        Integer configured = whole('Callout_Timeout_Ms', MAX_TIMEOUT_MS);
        return configured > 0 ? Math.min(configured, MAX_TIMEOUT_MS) : MAX_TIMEOUT_MS;
    }

    /** Off only when the value is explicitly 'false'. */
    public static Boolean isEnabled(String setting) {
        return !'false'.equalsIgnoreCase(text(setting, 'true').trim());
    }

    // ---------------------------------------------------------------- private

    private static String text(String setting, String fallback) {
        if (overrides.containsKey(setting)) {
            String forced = overrides.get(setting);
            return String.isBlank(forced) ? fallback : forced;
        }
        if (values == null) {
            values = new Map<String, String>();
            for (CAF_Setting__mdt row : CAF_Setting__mdt.getAll().values()) {
                values.put(row.DeveloperName, row.Value__c);
            }
        }
        String value = values.get(setting);
        return String.isBlank(value) ? fallback : value.trim();
    }

    private static Integer whole(String setting, Integer fallback) {
        try {
            return Integer.valueOf(text(setting, String.valueOf(fallback)));
        } catch (TypeException e) {
            return fallback;
        }
    }
}
