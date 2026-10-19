@IsTest
private class CafReportsControllerTest {

    @IsTest
    static void tasksAreCountedByStateAndApproval() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Request__c parent = CafTestSupport.request('r1', 'SAP Fiori', 'Backup');
            insert parent;

            List<CAF_Task__c> tasks = new List<CAF_Task__c>();
            for (Integer i = 0; i < 3; i++) {
                CAF_Task__c t = CafTestSupport.task(parent, 'o' + i, 'CAFT000000' + i);
                t.State__c = 'Open';
                tasks.add(t);
            }
            CAF_Task__c done = CafTestSupport.task(parent, 'c1', 'CAFT0000009');
            done.State__c = 'Closed Complete';
            done.Approval__c = 'approved';
            tasks.add(done);
            insert tasks;

            Map<String, Integer> counts = new Map<String, Integer>();
            for (CafReportsController.TaskBucket b : CafReportsController.getTaskSummary()) {
                counts.put(b.state + '|' + b.approval, b.total);
            }

            Assert.areEqual(3, counts.get('Open|null'));
            Assert.areEqual(1, counts.get('Closed Complete|approved'));
        }
    }

    @IsTest
    static void userWithoutCafAccessIsRefused() {
        User outsider = CafTestSupport.userWithoutCafAccess();
        System.runAs(outsider) {
            Boolean refused = false;
            try {
                CafReportsController.getTaskSummary();
            } catch (Exception e) {
                refused = true;
            }
            Assert.isTrue(refused);
        }
    }
}
