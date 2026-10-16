@IsTest
private class CafConfigTest {

    @IsTest
    static void taskPathEndsWithASlash() {
        CafConfig.overrides.put('ServiceNow_Task_Path', 'callout:ServiceNow_CAF/api/x/caf/task');
        Assert.areEqual('callout:ServiceNow_CAF/api/x/caf/task/', CafConfig.serviceNowTaskPath());
    }

    @IsTest
    static void blankValueFallsBackToTheShippedPath() {
        CafConfig.overrides.put('ServiceNow_Task_Path', '  ');
        Assert.areEqual('callout:ServiceNow_CAF/api/x_gskn2_caf_compli/caf/task/',
                        CafConfig.serviceNowTaskPath());
    }

    @IsTest
    static void evidenceCapCanBeLowered() {
        CafConfig.overrides.put('Evidence_Max_Bytes', '1048576');
        Assert.areEqual(1048576, CafConfig.evidenceMaxBytes());
    }

    @IsTest
    static void evidenceCapCannotBeRaisedPastTwoMegabytes() {
        CafConfig.overrides.put('Evidence_Max_Bytes', '9999999');
        Assert.areEqual(CafConfig.EVIDENCE_CEILING, CafConfig.evidenceMaxBytes());
    }

    @IsTest
    static void unreadableOrNegativeCapFallsBack() {
        CafConfig.overrides.put('Evidence_Max_Bytes', 'two MB');
        Assert.areEqual(CafConfig.EVIDENCE_CEILING, CafConfig.evidenceMaxBytes());

        CafConfig.overrides.put('Evidence_Max_Bytes', '-5');
        Assert.areEqual(CafConfig.EVIDENCE_CEILING, CafConfig.evidenceMaxBytes());
    }

    @IsTest
    static void timeoutIsClampedToThePlatformMaximum() {
        CafConfig.overrides.put('Callout_Timeout_Ms', '300000');
        Assert.areEqual(120000, CafConfig.calloutTimeoutMs());

        CafConfig.overrides.put('Callout_Timeout_Ms', '30000');
        Assert.areEqual(30000, CafConfig.calloutTimeoutMs());
    }

    @IsTest
    static void switchesAreOnUnlessExplicitlyFalse() {
        Assert.isTrue(CafConfig.isEnabled('No_Such_Setting'));

        CafConfig.overrides.put('Logging_Enabled', 'yes');
        Assert.isTrue(CafConfig.isEnabled('Logging_Enabled'));

        CafConfig.overrides.put('Logging_Enabled', ' FALSE ');
        Assert.isFalse(CafConfig.isEnabled('Logging_Enabled'));
    }

    @IsTest
    static void deployedRecordsMatchTheDefaults() {
        // No overrides: this reads the CAF_Setting__mdt records that ship with
        // the package, which are meant to repeat the code's defaults.
        Assert.areEqual(2097152, CafConfig.evidenceMaxBytes());
        Assert.areEqual(120000, CafConfig.calloutTimeoutMs());
        Assert.isTrue(CafConfig.serviceNowTaskPath().startsWith('callout:ServiceNow_CAF/'));
    }
}
