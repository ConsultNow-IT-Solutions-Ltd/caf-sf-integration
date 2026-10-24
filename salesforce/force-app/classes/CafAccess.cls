/**
 * What a CAF user may do, as opposed to what they may read.
 *
 * Class access cannot draw that line: CafTaskService serves both the task list
 * every viewer needs and the Start action only an owner should have. So the
 * actions check a custom permission instead, granted by CAF_Owner
 * (CAF_Work_Tasks) and CAF_Approver (CAF_Attest). CAF_Integration holds both,
 * so nobody who could act before CAF-221 loses anything.
 *
 * The check runs after argument validation and before the callout: a refused
 * user never reaches ServiceNow, and a malformed call still gets the message
 * that says what is wrong with it.
 */
public with sharing class CafAccess {

    /** Start, Criteria met and Upload evidence. */
    public static final String WORK_TASKS = 'CAF_Work_Tasks';

    /** Approve or reject a task. */
    public static final String ATTEST = 'CAF_Attest';

    /** Answers set by tests, consulted before the user's real permissions. */
    @TestVisible
    private static Map<String, Boolean> overrides = new Map<String, Boolean>();

    /**
     * @param permission a custom permission API name, e.g. WORK_TASKS
     * @return true when the running user holds it
     */
    public static Boolean has(String permission) {
        if (overrides.containsKey(permission)) {
            return overrides.get(permission);
        }
        return FeatureManagement.checkPermission(permission);
    }

    /**
     * @param permission a custom permission API name
     * @param action     what the user tried, for the message, e.g. 'attest tasks'
     * @throws AuraHandledException when the running user does not hold it
     */
    public static void require(String permission, String action) {
        if (!has(permission)) {
            String message = 'You can view CAF records but not ' + action + '. Ask a CAF administrator ' +
                             'for the ' + (permission == ATTEST ? 'CAF Approver' : 'CAF Owner') + ' permission set.';
            // Without setMessage, getMessage() reads "Script-thrown exception" everywhere but the UI.
            AuraHandledException e = new AuraHandledException(message);
            e.setMessage(message);
            throw e;
        }
    }
}
