/**
 * Task counts for the Reports screen.
 *
 * Request-level figures come from CafDashboardController.getRequests, which
 * the screen reuses so the report and the grid are computed from the same
 * rows. Tasks are aggregated here instead: the screen needs counts, not the
 * 180-odd records behind them.
 */
public with sharing class CafReportsController {

    public class TaskBucket {
        @AuraEnabled public String state;
        @AuraEnabled public String approval;
        @AuraEnabled public Integer total;
    }

    @AuraEnabled(cacheable=true)
    public static List<TaskBucket> getTaskSummary() {
        List<TaskBucket> buckets = new List<TaskBucket>();
        for (AggregateResult row : [
            SELECT State__c state, Approval__c approval, COUNT(Id) total
            FROM CAF_Task__c
            WITH USER_MODE
            GROUP BY State__c, Approval__c
        ]) {
            TaskBucket b = new TaskBucket();
            b.state = (String) row.get('state');
            b.approval = (String) row.get('approval');
            b.total = (Integer) row.get('total');
            buckets.add(b);
        }
        return buckets;
    }
}
