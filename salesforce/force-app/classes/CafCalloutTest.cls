@IsTest
private class CafCalloutTest {

    private static final String ENDPOINT =
        'callout:ServiceNow_CAF/api/x_gskn2_caf_compli/caf/task/abc';

    @IsTest
    static void successIsLoggedWithoutItsBody() {
        CafTestSupport.respondWith(200, '{"result":{"secret":"record data"}}');

        Test.startTest();
        CafCallout.send('task.update', 'PATCH', ENDPOINT, '{}');
        CafCallout.flush();
        Test.stopTest();   // delivers the event, so the trigger has run

        CAF_Integration_Log__c log = [
            SELECT Operation__c, Method__c, Endpoint__c, Status_Code__c, Succeeded__c,
                   Error__c, Requested_By__c, Latency_Ms__c
            FROM CAF_Integration_Log__c WITH SYSTEM_MODE
        ];
        Assert.areEqual('task.update', log.Operation__c);
        Assert.areEqual('PATCH', log.Method__c);
        Assert.areEqual('/api/x_gskn2_caf_compli/caf/task/abc', log.Endpoint__c,
                        'the named credential prefix is dropped');
        Assert.areEqual(200, log.Status_Code__c);
        Assert.isTrue(log.Succeeded__c);
        Assert.isNull(log.Error__c, 'a successful body is not copied into the log');
        Assert.areEqual(UserInfo.getUserId(), log.Requested_By__c);
        Assert.isNotNull(log.Latency_Ms__c);
    }

    @IsTest
    static void failureKeepsTheResponseBody() {
        CafTestSupport.respondWith(409, '{"result":{"error":"CAFT1 is already approved."}}');

        Test.startTest();
        HttpResponse res = CafCallout.send('task.attest', 'POST', ENDPOINT + '/attest', '{}');
        CafCallout.flush();
        Test.stopTest();

        Assert.areEqual(409, res.getStatusCode(), 'the caller still gets the response');
        CAF_Integration_Log__c log = [SELECT Status_Code__c, Succeeded__c, Error__c FROM CAF_Integration_Log__c WITH SYSTEM_MODE];
        Assert.areEqual(409, log.Status_Code__c);
        Assert.isFalse(log.Succeeded__c);
        Assert.isTrue(log.Error__c.contains('already approved'));
    }

    @IsTest
    static void unreachableIsLoggedAndRethrown() {
        CafTestSupport.unreachable();

        Test.startTest();
        Boolean rethrown = false;
        try {
            CafCallout.send('evidence.list', 'GET', ENDPOINT + '/evidence', null);
        } catch (CalloutException e) {
            rethrown = true;
        }
        CafCallout.flush();
        Test.stopTest();

        Assert.isTrue(rethrown);
        CAF_Integration_Log__c log = [SELECT Status_Code__c, Succeeded__c, Error__c FROM CAF_Integration_Log__c WITH SYSTEM_MODE];
        Assert.isNull(log.Status_Code__c);
        Assert.isFalse(log.Succeeded__c);
        Assert.areEqual('Read timed out', log.Error__c);
    }

    @IsTest
    static void loggingCanBeSwitchedOff() {
        CafConfig.overrides.put('Logging_Enabled', 'false');
        CafTestSupport.respondWith(200, '{}');

        Test.startTest();
        CafCallout.send('task.update', 'PATCH', ENDPOINT, '{}');
        CafCallout.flush();
        Test.stopTest();

        Assert.areEqual(0, [SELECT COUNT() FROM CAF_Integration_Log__c WITH SYSTEM_MODE]);
        Assert.isTrue(CafCallout.pending.isEmpty(), 'nothing is left waiting either');
    }

    @IsTest
    static void flushWithNothingRecordedDoesNothing() {
        Test.startTest();
        CafCallout.flush();
        Test.stopTest();
        Assert.areEqual(0, [SELECT COUNT() FROM CAF_Integration_Log__c WITH SYSTEM_MODE]);
    }

    @IsTest
    static void requestCarriesJsonHeadersAndTheBody() {
        CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(200, '{}');

        CafCallout.send('task.update', 'PATCH', ENDPOINT, '{"state":"2"}');

        HttpRequest sent = mock.received[0];
        Assert.areEqual('application/json', sent.getHeader('Content-Type'));
        Assert.areEqual('application/json', sent.getHeader('Accept'));
        Assert.areEqual('{"state":"2"}', sent.getBody());
    }
}
