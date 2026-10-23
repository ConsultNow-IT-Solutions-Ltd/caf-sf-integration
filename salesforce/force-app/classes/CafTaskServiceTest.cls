@IsTest
private class CafTaskServiceTest {

    @IsTest
    static void applyChangeSendsAPatchAndReturnsTheBody() {
        CafTestSupport.ServiceNowMock mock =
            CafTestSupport.respondWith(200, '{"result":{"state":"2"}}');

        Test.startTest();
        String body = CafTaskService.applyChange('abc123', 'state', '2');
        Test.stopTest();

        Assert.areEqual('{"result":{"state":"2"}}', body);
        HttpRequest sent = mock.received[0];
        Assert.areEqual('PATCH', sent.getMethod());
        Assert.isTrue(sent.getEndpoint().endsWith('/caf/task/abc123'), sent.getEndpoint());
        Assert.areEqual('{"state":"2"}', sent.getBody());

        CAF_Integration_Log__c log = [SELECT Operation__c, Status_Code__c FROM CAF_Integration_Log__c WITH SYSTEM_MODE];
        Assert.areEqual('task.update', log.Operation__c);
        Assert.areEqual(200, log.Status_Code__c);
    }

    @IsTest
    static void refusalIsRaisedAndStillLogged() {
        CafTestSupport.respondWith(400, '{"result":{"error":"number is not writable"}}');

        Test.startTest();
        Boolean raised = false;
        try {
            CafTaskService.applyChange('abc123', 'number', 'HACKED');
        } catch (AuraHandledException e) {
            raised = true;
        }
        Test.stopTest();

        Assert.isTrue(raised);
        CAF_Integration_Log__c log = [SELECT Status_Code__c, Error__c FROM CAF_Integration_Log__c WITH SYSTEM_MODE];
        Assert.areEqual(400, log.Status_Code__c);
        Assert.isTrue(log.Error__c.contains('not writable'));
    }

    @IsTest
    static void unreachableServiceNowIsRaised() {
        CafTestSupport.unreachable();

        Test.startTest();
        Boolean raised = false;
        try {
            CafTaskService.applyChange('abc123', 'state', '2');
        } catch (AuraHandledException e) {
            raised = true;
        }
        Test.stopTest();

        Assert.isTrue(raised);
        Assert.isNull([SELECT Status_Code__c FROM CAF_Integration_Log__c WITH SYSTEM_MODE].Status_Code__c);
    }

    @IsTest
    static void missingArgumentsAreRefusedBeforeAnyCallout() {
        CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(200, '{}');

        Boolean raised = false;
        try {
            CafTaskService.applyChange('', 'state', '2');
        } catch (AuraHandledException e) {
            raised = true;
        }

        Assert.isTrue(raised);
        Assert.areEqual(0, mock.received.size());
    }

    @IsTest
    static void getTasksReturnsTheRequestsTasksInNumberOrder() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Request__c parent = CafTestSupport.request('req1', 'SAP Fiori', 'Backup');
            CAF_Request__c other  = CafTestSupport.request('req2', 'SAP Fiori', 'Patching');
            insert new List<CAF_Request__c>{ parent, other };
            insert new List<CAF_Task__c>{
                CafTestSupport.task(parent, 't2', 'CAFT0000002'),
                CafTestSupport.task(parent, 't1', 'CAFT0000001'),
                CafTestSupport.task(other,  't3', 'CAFT0000003')
            };

            List<CAF_Task__c> tasks = CafTaskService.getTasks('req1');

            Assert.areEqual(2, tasks.size());
            Assert.areEqual('CAFT0000001', tasks[0].SN_Number__c);
            Assert.areEqual('CAFT0000002', tasks[1].SN_Number__c);
        }
    }
}
