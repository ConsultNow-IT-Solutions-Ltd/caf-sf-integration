@IsTest
private class CafAccessTest {

    @IsTest
    static void integrationHoldsBothPermissions() {
        Integer granted = [
            SELECT COUNT() FROM SetupEntityAccess
            WHERE Parent.Name = 'CAF_Integration'
              AND SetupEntityId IN (SELECT Id FROM CustomPermission
                                    WHERE DeveloperName IN (:CafAccess.WORK_TASKS, :CafAccess.ATTEST))
        ];
        Assert.areEqual(2, granted, 'CAF_Integration must keep both actions so no current user loses them');
    }

    @IsTest
    static void viewerHoldsNeither() {
        User viewer = CafTestSupport.userWithoutCafAccess();
        CafTestSupport.grant(viewer, 'CAF_Viewer');
        System.runAs(viewer) {
            Assert.isFalse(CafAccess.has(CafAccess.WORK_TASKS));
            Assert.isFalse(CafAccess.has(CafAccess.ATTEST));
        }
    }

    @IsTest
    static void ownerWorksTasksButDoesNotAttest() {
        User owner = CafTestSupport.userWithoutCafAccess();
        CafTestSupport.grant(owner, 'CAF_Viewer');
        CafTestSupport.grant(owner, 'CAF_Owner');
        System.runAs(owner) {
            Assert.isTrue(CafAccess.has(CafAccess.WORK_TASKS));
            Assert.isFalse(CafAccess.has(CafAccess.ATTEST));
        }
    }

    @IsTest
    static void approverAttestsButDoesNotWorkTasks() {
        User approver = CafTestSupport.userWithoutCafAccess();
        CafTestSupport.grant(approver, 'CAF_Viewer');
        CafTestSupport.grant(approver, 'CAF_Approver');
        System.runAs(approver) {
            Assert.isFalse(CafAccess.has(CafAccess.WORK_TASKS));
            Assert.isTrue(CafAccess.has(CafAccess.ATTEST));
        }
    }

    @IsTest
    static void requireNamesThePermissionSetToAskFor() {
        CafAccess.overrides.put(CafAccess.ATTEST, false);
        try {
            CafAccess.require(CafAccess.ATTEST, 'attest tasks');
            Assert.fail('expected a refusal');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('CAF Approver'), e.getMessage());
        }
    }

    @IsTest
    static void refusedActionsNeverCallServiceNow() {
        CafTestSupport.ServiceNowMock mock = CafTestSupport.respondWith(200, '{}');
        CafAccess.overrides.put(CafAccess.WORK_TASKS, false);
        CafAccess.overrides.put(CafAccess.ATTEST, false);

        Integer refused = 0;
        try { CafTaskService.applyChange('abc123', 'state', '2'); } catch (AuraHandledException e) { refused++; }
        try { CafAttestationService.attest('abc123', 'yes', 'approved', ''); } catch (AuraHandledException e) { refused++; }

        Assert.areEqual(2, refused);
        Assert.areEqual(0, mock.received.size());
    }
}
