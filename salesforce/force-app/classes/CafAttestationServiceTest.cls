@IsTest
private class CafAttestationServiceTest {

    private static final String APPROVED = JSON.serialize(new Map<String, Object>{
        'result' => new Map<String, Object>{
            'number'         => 'CAFT0001001',
            'approval'       => 'approved',
            'met_criteria'   => 'yes',
            'state'          => '3',
            'active'         => 'false',
            'request'        => 'RCAF0001022',
            'request_status' => 'in_compliance'
        }
    });

    @IsTest
    static void approvalReturnsWhatServiceNowRecorded() {
        CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(200, APPROVED);

        Test.startTest();
        CafAttestationService.AttestationResult result =
            CafAttestationService.attest('tsk1', 'yes', 'approved', 'Evidence reviewed');
        Test.stopTest();

        Assert.areEqual('CAFT0001001', result.taskNumber);
        Assert.areEqual('approved', result.approval);
        Assert.areEqual('yes', result.metCriteria);
        Assert.areEqual('3', result.state);
        Assert.isFalse(result.active);
        Assert.areEqual('RCAF0001022', result.requestNumber);
        Assert.areEqual('in_compliance', result.requestStatus);

        HttpRequest sent = mock.received[0];
        Assert.areEqual('POST', sent.getMethod());
        Assert.isTrue(sent.getEndpoint().endsWith('/caf/task/tsk1/attest'), sent.getEndpoint());
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(sent.getBody());
        Assert.areEqual('approved', body.get('outcome'));
        Assert.areEqual('yes', body.get('met_criteria'));
        Assert.areEqual('Evidence reviewed', body.get('comments'));

        Assert.areEqual('task.attest', [SELECT Operation__c FROM CAF_Integration_Log__c].Operation__c);
    }

    @IsTest
    static void nullCommentsAreSentAsEmpty() {
        CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(200, APPROVED);

        CafAttestationService.attest('tsk1', 'no', 'rejected', null);

        Map<String, Object> body =
            (Map<String, Object>) JSON.deserializeUntyped(mock.received[0].getBody());
        Assert.areEqual('', body.get('comments'));
    }

    @IsTest
    static void evidenceGateRefusalIsRaisedAndLogged() {
        CafTestSupport.respondWith(428,
            '{"result":{"error":"Attach at least one evidence file to CAFT0001024 before attesting."}}');

        Test.startTest();
        Boolean raised = false;
        try {
            CafAttestationService.attest('tsk2', 'yes', 'approved', '');
        } catch (AuraHandledException e) {
            raised = true;
        }
        Test.stopTest();

        Assert.isTrue(raised);
        CAF_Integration_Log__c log = [SELECT Status_Code__c, Error__c FROM CAF_Integration_Log__c];
        Assert.areEqual(428, log.Status_Code__c);
        Assert.isTrue(log.Error__c.contains('evidence file'));
    }

    @IsTest
    static void nonJsonResponseIsRaised() {
        CafTestSupport.respondWith(502, '<html>Bad Gateway</html>');

        Boolean raised = false;
        try {
            CafAttestationService.attest('tsk1', 'yes', 'approved', '');
        } catch (AuraHandledException e) {
            raised = true;
        }
        Assert.isTrue(raised);
    }

    @IsTest
    static void invalidInputIsRefusedBeforeAnyCallout() {
        CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(200, APPROVED);

        List<List<String>> invalid = new List<List<String>>{
            new List<String>{ '',     'yes',      'approved' },
            new List<String>{ 'tsk1', 'yes',      'maybe'    },
            new List<String>{ 'tsk1', 'probably', 'approved' },
            new List<String>{ 'tsk1', null,       'approved' }
        };
        for (List<String> args : invalid) {
            Boolean raised = false;
            try {
                CafAttestationService.attest(args[0], args[1], args[2], '');
            } catch (AuraHandledException e) {
                raised = true;
            }
            Assert.isTrue(raised, 'refused: ' + args);
        }
        Assert.areEqual(0, mock.received.size());
    }
}
