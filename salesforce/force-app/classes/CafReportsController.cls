/**
 * Task counts for the Reports screen.
 *
 * Request-level figures come from CafDashboardController.getRequests, which
 * the screen reuses so the report and the grid are computed from the same
 * rows. Tasks are aggregated here instead: the screen needs counts, not the
 * 180-odd records behind them.
 */
public with sharing class CafReportsController {

    /** One (state, approval) combination and how many tasks have it. */
    public class TaskBucket {
        /** CAF_Task__c.State__c; null for tasks with no state. */
        @AuraEnabled public String state;
        /** CAF_Task__c.Approval__c; null for tasks with no approval value. */
        @AuraEnabled public String approval;
        /** Number of tasks in this bucket; never null, never negative. */
        @AuraEnabled public Integer total;
    }

    /**
     * Counts every task by state and approval. A null state or approval is a
     * bucket of its own rather than being merged into another, so the totals
     * always add up to the number of tasks.
     *
     * @return one bucket per (state, approval) pair present; never null
     * @throws QueryException when the user lacks read access to CAF_Task__c
     *         or one of the fields (WITH USER_MODE)
     */
    @AuraEnabled(cacheable=true)
    public static List<TaskBucket> getTaskSummary() {
        List<TaskBucket> buckets = new List<TaskBucket>();
        for (AggregateResult row : [
            SELECT State__c state, Approval__c approval, COUNT(Id) total
            FROM CAF_Task__c
            WITH USER_MODE
            GROUP BY State__c, Approval__c
        ]) {
            buckets.add(bucketOf(row));
        }
        return buckets;
    }

    /**
     * Turns one aggregate row into a bucket.
     *
     * @param row a row from the GROUP BY query
     * @return the bucket, with total defaulted to 0 if the count is missing
     */
    @TestVisible
    private static TaskBucket bucketOf(AggregateResult row) {
        TaskBucket b = new TaskBucket();
        b.state = (String) row.get('state');
        b.approval = (String) row.get('approval');
        Integer total = (Integer) row.get('total');
        b.total = total == null || total < 0 ? 0 : total;
        return b;
    }
}
