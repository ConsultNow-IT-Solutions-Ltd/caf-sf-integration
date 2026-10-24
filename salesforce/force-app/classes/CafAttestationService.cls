/**
 * Attestation for a CAF Task.
 *
 * The attestation is a message to ServiceNow, not a record update here. This
 * class posts the outcome and reports back what ServiceNow decided; it writes
 * nothing to CAF_Task__c, because the closure, the actual completion date and
 * the parent request's compliance status are all set by business rules in
 * ServiceNow and arrive in Salesforce by the usual push.
 *
 * The evidence gate is not implemented here either. It lives in the ServiceNow
 * resource, so a task cannot be attested without evidence whichever client
 * asks. What this class does is carry the refusal back intact, because
 * "attach evidence first" is the most useful thing the endpoint ever says.
 */
public with sharing class CafAttestationService {

    /**
     * What ServiceNow made of the attestation, read back from the record after
     * its rules ran rather than assumed from the outcome that was sent.
     */
    public class AttestationResult {
        // Not `number`: that is a reserved identifier in Apex and the class
        // will not compile with a field of that name.
        @AuraEnabled public String taskNumber;
        @AuraEnabled public String approval;
        @AuraEnabled public String metCriteria;
        @AuraEnabled public String state;
        @AuraEnabled public Boolean active;
        @AuraEnabled public String requestNumber;
        @AuraEnabled public String requestStatus;
    }

    /**
     * @param taskSysId   the ServiceNow sys_id, not the Salesforce record Id
     * @param metCriteria 'yes' or 'no' - the attester's claim about the control
     * @param outcome     'approved' or 'rejected' - the approval decision
     * @param comments    appended to the task's activity stream in ServiceNow
     */
    @AuraEnabled
    public static AttestationResult attest(String taskSysId, String metCriteria,
                                           String outcome, String comments) {
        if (String.isBlank(taskSysId)) {
            throw new AuraHandledException('This task carries no ServiceNow sys_id.');
        }
        if (outcome != 'approved' && outcome != 'rejected') {
            throw new AuraHandledException('Outcome must be Approved or Rejected.');
        }
        if (metCriteria != 'yes' && metCriteria != 'no') {
            throw new AuraHandledException('Record whether the success criteria were met.');
        }
        CafAccess.require(CafAccess.ATTEST, 'attest tasks');

        Map<String, Object> body = new Map<String, Object>{
            'met_criteria' => metCriteria,
            'outcome'      => outcome,
            'comments'     => comments == null ? '' : comments
        };

        // The endpoint closes the task, lets the rules cascade to the parent
        // request, and then pushes both records back to Salesforce, all
        // synchronously - hence the long timeout CafCallout applies.
        HttpResponse res;
        try {
            res = CafCallout.send('task.attest', 'POST',
                                  CafConfig.serviceNowTaskPath() + taskSysId + '/attest',
                                  JSON.serialize(body));
        } catch (Exception e) {
            throw new AuraHandledException('Could not reach ServiceNow: ' + e.getMessage());
        } finally {
            CafCallout.flush();
        }

        Map<String, Object> parsed;
        try {
            parsed = unwrap(res.getBody());
        } catch (Exception e) {
            throw new AuraHandledException(
                'ServiceNow returned ' + res.getStatusCode() + ' and a response that ' +
                'was not JSON: ' + res.getBody());
        }

        Integer code = res.getStatusCode();
        if (code < 200 || code >= 300) {
            // 428 is the evidence gate, 409 a task in the wrong state; both
            // carry a message written for the person reading it, so pass it
            // through rather than replacing it with a status code.
            Object message = parsed.get('error');
            throw new AuraHandledException(
                message == null ? 'ServiceNow returned ' + code : String.valueOf(message));
        }

        AttestationResult result = new AttestationResult();
        result.taskNumber    = (String) parsed.get('number');
        result.approval      = (String) parsed.get('approval');
        result.metCriteria   = (String) parsed.get('met_criteria');
        result.state         = (String) parsed.get('state');
        result.active        = 'true'.equals(String.valueOf(parsed.get('active')));
        result.requestNumber = (String) parsed.get('request');
        result.requestStatus = (String) parsed.get('request_status');
        return result;
    }

    /**
     * Scripted REST wraps whatever the resource returns in "result", success
     * and failure alike - which matters most on the failure path, where the
     * message under "error" is the whole value of the response.
     */
    private static Map<String, Object> unwrap(String responseBody) {
        Map<String, Object> body =
            (Map<String, Object>) JSON.deserializeUntyped(responseBody);
        if (body.containsKey('result') && body.get('result') instanceof Map<String, Object>) {
            return (Map<String, Object>) body.get('result');
        }
        return body;
    }
}
