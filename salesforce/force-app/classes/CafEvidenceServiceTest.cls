@IsTest
private class CafEvidenceServiceTest {

    private static final String ONE_FILE = JSON.serialize(new Map<String, Object>{
        'result' => new Map<String, Object>{
            'files' => new List<Object>{
                new Map<String, Object>{
                    'sys_id'         => 'att1',
                    'file_name'      => 'TEST-evidence.pdf',
                    'size_bytes'     => '2048',
                    'sys_created_by' => 'sf.integration',
                    'sys_created_on' => '2026-10-14 10:00:00'
                }
            }
        }
    });

    @IsTest
    static void bothSidesAreListed() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Task__c task = taskWithFile(20);
            CafTestSupport.respondWith(200, ONE_FILE);

            Test.startTest();
            CafEvidenceService.EvidenceView view = CafEvidenceService.getEvidence(task.Id, 'tsk1');
            Test.stopTest();

            Assert.areEqual(1, view.salesforceFiles.size());
            Assert.areEqual('TEST-evidence.pdf', view.salesforceFiles[0].name);
            Assert.areEqual(1, view.serviceNowCount);
            Assert.areEqual('att1', view.serviceNowFiles[0].id);
            Assert.areEqual('2 KB', view.serviceNowFiles[0].sizeLabel);
            Assert.isNull(view.serviceNowError);
            Assert.areEqual('evidence.list', [SELECT Operation__c FROM CAF_Integration_Log__c].Operation__c);
        }
    }

    @IsTest
    static void serviceNowFailureStillShowsTheSalesforceSide() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Task__c task = taskWithFile(20);
            CafTestSupport.respondWith(500, 'Internal error');

            Test.startTest();
            CafEvidenceService.EvidenceView view = CafEvidenceService.getEvidence(task.Id, 'tsk1');
            Test.stopTest();

            Assert.areEqual(1, view.salesforceFiles.size());
            Assert.areEqual(0, view.serviceNowCount);
            Assert.isTrue(view.serviceNowError.contains('500'));
        }
    }

    @IsTest
    static void replyWithoutFileListIsNotReportedAsAnOutage() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CafTestSupport.respondWith(200, '{"result":{}}');

            Test.startTest();
            CafEvidenceService.EvidenceView view = CafEvidenceService.getEvidence(null, 'tsk1');
            Test.stopTest();

            Assert.areEqual(0, view.serviceNowCount);
            Assert.isTrue(view.serviceNowError.contains('could not be read'));
            Assert.isFalse(view.serviceNowError.contains('Could not reach'));
        }
    }

    @IsTest
    static void replyThatIsNotJsonIsNotReportedAsAnOutage() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CafTestSupport.respondWith(200, '<html>Session expired</html>');

            Test.startTest();
            CafEvidenceService.EvidenceView view = CafEvidenceService.getEvidence(null, 'tsk1');
            Test.stopTest();

            Assert.areEqual(0, view.serviceNowCount);
            Assert.isTrue(view.serviceNowError.contains('could not be read'));
        }
    }

    @IsTest
    static void entriesThatAreNotObjectsAreSkipped() {
        List<CafEvidenceService.EvidenceFile> files = CafEvidenceService.readServiceNowFiles(
            '{"result":{"files":[null, "junk", {"sys_id":"att2","size_bytes":"10"}]}}');

        Assert.areEqual(1, files.size());
        Assert.areEqual('att2', files[0].id);
        Assert.areEqual('(unnamed attachment)', files[0].name);
    }

    @IsTest
    static void taskWithoutSysIdMakesNoCallout() {
        CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(200, ONE_FILE);

        CafEvidenceService.EvidenceView view = CafEvidenceService.getEvidence(null, '');

        Assert.isNotNull(view.serviceNowError);
        Assert.areEqual(0, mock.received.size());
    }

    @IsTest
    static void pushSendsTheFileAsBase64() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Task__c task = taskWithFile(20);
            Id documentId = [SELECT ContentDocumentId FROM ContentDocumentLink
                             WHERE LinkedEntityId = :task.Id LIMIT 1].ContentDocumentId;
            CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(201, '{"result":{"sys_id":"att9"}}');

            Test.startTest();
            String body = CafEvidenceService.pushEvidence('tsk1', documentId);
            Test.stopTest();

            Assert.isTrue(body.contains('att9'));
            Map<String, Object> sent =
                (Map<String, Object>) JSON.deserializeUntyped(mock.received[0].getBody());
            Assert.areEqual('TEST-evidence.pdf', sent.get('file_name'));
            Assert.areEqual('application/pdf', sent.get('content_type'));
            Assert.areEqual(EncodingUtil.base64Encode(Blob.valueOf('x'.repeat(20))), sent.get('data'));
            Assert.areEqual('evidence.push', [SELECT Operation__c FROM CAF_Integration_Log__c].Operation__c);
        }
    }

    @IsTest
    static void fileOverTheConfiguredCapIsRefusedBeforeSending() {
        CafConfig.overrides.put('Evidence_Max_Bytes', '10');
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            CAF_Task__c task = taskWithFile(20);
            Id documentId = [SELECT ContentDocumentId FROM ContentDocumentLink
                             WHERE LinkedEntityId = :task.Id LIMIT 1].ContentDocumentId;
            CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(201, '{}');

            Boolean refused = false;
            try {
                CafEvidenceService.pushEvidence('tsk1', documentId);
            } catch (AuraHandledException e) {
                refused = true;
            }

            Assert.isTrue(refused);
            Assert.areEqual(0, mock.received.size());
        }
    }

    @IsTest
    static void pushNeedsBothIds() {
        Boolean refused = false;
        try {
            CafEvidenceService.pushEvidence('tsk1', null);
        } catch (AuraHandledException e) {
            refused = true;
        }
        Assert.isTrue(refused);
    }

    // ---------------------------------------------------------------- helpers

    private static CAF_Task__c taskWithFile(Integer bytes) {
        CAF_Request__c parent = CafTestSupport.request('req1', 'SAP Fiori', 'Backup');
        insert parent;
        CAF_Task__c task = CafTestSupport.task(parent, 'tsk1', 'CAFT0001001');
        insert task;
        insert new ContentVersion(
            Title                  = 'TEST-evidence',
            PathOnClient           = 'TEST-evidence.pdf',
            VersionData            = Blob.valueOf('x'.repeat(bytes)),
            FirstPublishLocationId = task.Id
        );
        return task;
    }
}
