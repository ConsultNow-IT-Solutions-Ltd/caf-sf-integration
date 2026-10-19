@IsTest
private class CafApprovalsControllerTest {

    @IsTest
    static void queueHoldsOnlyInProgressTasksSoonestDueFirst() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Request__c parent = CafTestSupport.request('r1', 'SAP Fiori', 'Backup');
            insert parent;

            CAF_Task__c later = CafTestSupport.task(parent, 't1', 'CAFT0000001');
            later.State__c = 'In Progress';
            later.Planned_Completion_Date__c = Date.today().addDays(10);

            CAF_Task__c sooner = CafTestSupport.task(parent, 't2', 'CAFT0000002');
            sooner.State__c = 'In Progress';
            sooner.Planned_Completion_Date__c = Date.today().addDays(1);

            CAF_Task__c open = CafTestSupport.task(parent, 't3', 'CAFT0000003');
            open.State__c = 'Open';

            insert new List<CAF_Task__c>{ later, sooner, open };

            List<CAF_Task__c> queue = CafApprovalsController.getQueue();

            Assert.areEqual(2, queue.size());
            Assert.areEqual('t2', queue[0].ServiceNow_Sys_Id__c);
            Assert.areEqual('SAP Fiori', queue[0].CAF_Request__r.Business_Application__c);
        }
    }

    @IsTest
    static void recentDecisionsAreApprovedOrRejectedOnly() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Request__c parent = CafTestSupport.request('r1', 'SAP Fiori', 'Backup');
            insert parent;

            CAF_Task__c approved = CafTestSupport.task(parent, 't1', 'CAFT0000001');
            approved.State__c = 'Closed Complete';
            approved.Approval__c = 'approved';

            CAF_Task__c rejected = CafTestSupport.task(parent, 't2', 'CAFT0000002');
            rejected.State__c = 'Closed Complete';
            rejected.Approval__c = 'rejected';

            CAF_Task__c pending = CafTestSupport.task(parent, 't3', 'CAFT0000003');
            pending.State__c = 'In Progress';
            pending.Approval__c = 'requested';

            insert new List<CAF_Task__c>{ approved, rejected, pending };

            Assert.areEqual(2, CafApprovalsController.getRecentDecisions().size());
        }
    }

    @IsTest
    static void userWithoutCafAccessIsRefused() {
        User outsider = CafTestSupport.userWithoutCafAccess();
        System.runAs(outsider) {
            Boolean refused = false;
            try {
                CafApprovalsController.getQueue();
            } catch (Exception e) {
                refused = true;
            }
            Assert.isTrue(refused);
        }
    }
}
