@IsTest
private class CafAdminControllerTest {

    @IsTest
    static void everySettingCafConfigReadsIsListedWithItsEffectiveValue() {
        CafConfig.overrides.put('Callout_Timeout_Ms', '999999');   // above the ceiling
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            Map<String, CafAdminController.Setting> byName = new Map<String, CafAdminController.Setting>();
            for (CafAdminController.Setting s : CafAdminController.getOverview().settings) {
                byName.put(s.name, s);
            }

            Assert.isTrue(byName.containsKey('ServiceNow_Task_Path'));
            Assert.isTrue(byName.containsKey('Evidence_Max_Bytes'));
            Assert.isTrue(byName.containsKey('Logging_Enabled'));
            Assert.areEqual('120000', byName.get('Callout_Timeout_Ms').effective);
        }
    }

    @IsTest
    static void controlsIncludeInactiveOnesWithTheirRequestCounts() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            insert new List<CAF_Control_Catalog__c>{
                new CAF_Control_Catalog__c(Name = 'Backup',  ServiceNow_Sys_Id__c = 'c1', Active__c = true),
                new CAF_Control_Catalog__c(Name = 'Retired', ServiceNow_Sys_Id__c = 'c2', Active__c = false)
            };
            CAF_Request__c bySysId = CafTestSupport.request('r1', 'SAP Fiori', 'Backup');
            bySysId.CAF_Control_Sys_Id__c = 'c1';
            CAF_Request__c byName = CafTestSupport.request('r2', 'SAP HANA', 'Backup');  // pre sys_id
            CAF_Request__c onRetired = CafTestSupport.request('r3', 'SAP HANA', 'Retired');
            onRetired.CAF_Control_Sys_Id__c = 'c2';
            insert new List<CAF_Request__c>{ bySysId, byName, onRetired };

            List<CafAdminController.Control> controls = CafAdminController.getOverview().controls;

            Assert.areEqual(2, controls.size());
            Assert.areEqual('Backup', controls[0].name);
            Assert.areEqual(2, controls[0].requests);
            Assert.isFalse(controls[1].active);
            Assert.areEqual(1, controls[1].requests);
        }
    }

    /** CAF_Integration alone does not read the callout log; the rest still loads. */
    @IsTest
    static void callLogNeedsCafAdmin() {
        insert new CAF_Integration_Log__c(Operation__c = 'task.update', Succeeded__c = true,
                                          Called_At__c = System.now());
        User caf = CafTestSupport.cafUser();

        System.runAs(caf) {
            CafAdminController.Overview o = CafAdminController.getOverview();
            Assert.isFalse(o.logAccess);
            Assert.areEqual(0, o.calls.size());
        }

        CafTestSupport.grant(caf, 'CAF_Admin');
        System.runAs(caf) {
            CafAdminController.Overview o = CafAdminController.getOverview();
            Assert.isTrue(o.logAccess);
            Assert.areEqual(1, o.calls.size());
        }
    }
}
