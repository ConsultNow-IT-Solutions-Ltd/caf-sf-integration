/**
 * Task figures for the CAF Home tiles (CAF-224).
 *
 * The application tiles are not computed here. cafHome reads the same rows as
 * the grid (CafDashboardController.getRequests / getControls) and applies the
 * grid's rule, so Home and the grid cannot disagree about which applications
 * are compliant. Tasks have no such screen to agree with, and the tiles need
 * counts rather than records, so they are aggregated here.
 *
 * Definitions:
 *   open                 - State__c Open or In Progress
 *   overdue              - open, and Planned_Completion_Date__c is in the past
 *   awaiting attestation - In Progress, the Approvals screen's definition. The
 *                          plan's tighter version (In Progress with evidence
 *                          in ServiceNow) needs a callout per task and waits
 *                          for the evidence count to be pushed.
 */
public with sharing class CafHomeController {

    private static final Set<String> OPEN_STATES = new Set<String>{ 'Open', 'In Progress' };

    public class TaskFigures {
        @AuraEnabled public Integer open = 0;
        @AuraEnabled public Integer overdue = 0;
        @AuraEnabled public Integer awaitingAttestation = 0;
    }

    /**
     * @return the three task counts; never null, each zero or more
     * @throws QueryException when the user lacks read access to CAF_Task__c
     *         or one of the fields (WITH USER_MODE)
     */
    @AuraEnabled(cacheable=true)
    public static TaskFigures getTaskFigures() {
        TaskFigures figures = new TaskFigures();
        for (AggregateResult row : [
            SELECT State__c state, COUNT(Id) total
            FROM CAF_Task__c
            WHERE State__c IN :OPEN_STATES
            WITH USER_MODE
            GROUP BY State__c
        ]) {
            Integer total = (Integer) row.get('total');
            figures.open += total;
            if ((String) row.get('state') == 'In Progress') {
                figures.awaitingAttestation += total;
            }
        }
        Datetime now = System.now();
        figures.overdue = [
            SELECT COUNT()
            FROM CAF_Task__c
            WHERE State__c IN :OPEN_STATES
              AND Planned_Completion_Date__c < :now
            WITH USER_MODE
        ];
        return figures;
    }
}
