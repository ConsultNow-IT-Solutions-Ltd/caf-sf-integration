@IsTest
private class CafDashboardControllerTest {

    @IsTest
    static void requestsWithoutAnApplicationOrControlAreLeftOut() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            insert new List<CAF_Request__c>{
                CafTestSupport.request('r1', 'SAP Fiori', 'Backup'),
                CafTestSupport.request('r2', null,        'Backup'),    // like RCAF0001001
                CafTestSupport.request('r3', 'SAP HANA',  null)
            };

            List<CAF_Request__c> rows = CafDashboardController.getRequests();

            Assert.areEqual(1, rows.size());
            Assert.areEqual('r1', rows[0].ServiceNow_Sys_Id__c);
        }
    }

    @IsTest
    static void onlyActiveControlsAreColumnsInNameOrder() {
        User caf = CafTestSupport.cafUser();
        System.runAs(caf) {
            insert new List<CAF_Control_Catalog__c>{
                new CAF_Control_Catalog__c(Name = 'Patching', ServiceNow_Sys_Id__c = 'c1', Active__c = true),
                new CAF_Control_Catalog__c(Name = 'Backup',   ServiceNow_Sys_Id__c = 'c2', Active__c = true),
                new CAF_Control_Catalog__c(Name = 'Retired',  ServiceNow_Sys_Id__c = 'c3', Active__c = false)
            };

            List<CAF_Control_Catalog__c> columns = CafDashboardController.getControls();

            Assert.areEqual(2, columns.size());
            Assert.areEqual('Backup', columns[0].Name);
            Assert.areEqual('Patching', columns[1].Name);
        }
    }

    /**
     * CAF-220: the grid's reads run in user mode, so a user without the CAF
     * permission set is refused outright rather than shown a partial grid.
     */
    @IsTest
    static void userWithoutCafAccessIsRefused() {
        insert CafTestSupport.request('r1', 'SAP Fiori', 'Backup');
        User outsider = CafTestSupport.userWithoutCafAccess();

        System.runAs(outsider) {
            Boolean refused = false;
            try {
                CafDashboardController.getRequests();
            } catch (Exception e) {
                refused = true;
            }
            Assert.isTrue(refused);
        }
    }
}
