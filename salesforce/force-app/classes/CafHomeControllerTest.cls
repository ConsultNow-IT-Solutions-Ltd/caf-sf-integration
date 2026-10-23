@IsTest
private class CafHomeControllerTest {

    @IsTest
    static void countsOpenOverdueAndAwaiting() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Request__c parent = CafTestSupport.request('req1', 'SAP Fiori', 'Backup');
            insert parent;
            Datetime past = System.now().addDays(-2);
            Datetime future = System.now().addDays(5);
            insert new List<CAF_Task__c>{
                withState(CafTestSupport.task(parent, 't1', 'CAFT0000001'), 'Open', future),
                withState(CafTestSupport.task(parent, 't2', 'CAFT0000002'), 'Open', past),
                withState(CafTestSupport.task(parent, 't3', 'CAFT0000003'), 'In Progress', past),
                withState(CafTestSupport.task(parent, 't4', 'CAFT0000004'), 'In Progress', null),
                withState(CafTestSupport.task(parent, 't5', 'CAFT0000005'), 'Closed Complete', past)
            };

            CafHomeController.TaskFigures figures = CafHomeController.getTaskFigures();

            Assert.areEqual(4, figures.open, 'Open and In Progress, not Closed Complete');
            Assert.areEqual(2, figures.overdue, 'open and past due; the closed late task does not count');
            Assert.areEqual(2, figures.awaitingAttestation);
        }
    }

    @IsTest
    static void noTasksIsAllZeros() {
        System.runAs(CafTestSupport.cafUser()) {
            CafHomeController.TaskFigures figures = CafHomeController.getTaskFigures();
            Assert.areEqual(0, figures.open);
            Assert.areEqual(0, figures.overdue);
            Assert.areEqual(0, figures.awaitingAttestation);
        }
    }

    @IsTest
    static void aViewerCanReadTheFigures() {
        User viewer = CafTestSupport.userWithoutCafAccess();
        CafTestSupport.grant(viewer, 'CAF_Viewer');
        System.runAs(viewer) {
            Assert.isNotNull(CafHomeController.getTaskFigures());
        }
    }

    @IsTest
    static void withoutCafAccessTheReadIsRefused() {
        Boolean refused = false;
        System.runAs(CafTestSupport.userWithoutCafAccess()) {
            try {
                CafHomeController.getTaskFigures();
            } catch (Exception e) {
                refused = true;
            }
        }
        Assert.isTrue(refused);
    }

    private static CAF_Task__c withState(CAF_Task__c task, String state, Datetime due) {
        task.State__c = state;
        task.Planned_Completion_Date__c = due;
        return task;
    }
}
