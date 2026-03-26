/*
 * Delete the 24 orphan CAF_Task__c records mirrored from ServiceNow.
 *
 * These are flow-development debris created 2025-01-09: no parent request,
 * no business application, no CAF control, all short description
 * "Attach evidence". Diagnosed 2026-08-07, see HANDOFF.md.
 *
 * Already run against both sides on 2026-08-07 and verified; kept as the record
 * of what was deleted. Re-running is a no-op - the assert fails and nothing is
 * touched, because the 24 records no longer exist.
 *
 * ServiceNow numbers: CAFT0001001, CAFT0001002, CAFT0001003, CAFT0001004, CAFT0001005, CAFT0001006, CAFT0001007, CAFT0001008, CAFT0001009, CAFT0001010, CAFT0001011, CAFT0001012, CAFT0001013, CAFT0001014, CAFT0001015, CAFT0001016, CAFT0001017, CAFT0001018, CAFT0001028, CAFT0001029, CAFT0001030, CAFT0001031, CAFT0001032, CAFT0001033
 *
 * Run in Setup -> Developer Console -> Debug -> Open Execute Anonymous Window.
 * Keyed on the External Id so it cannot touch anything else. The assert aborts
 * the whole transaction if the match count is not exactly 24.
 */
Set<String> snIds = new Set<String>{
            '2832a47483431210bd2a5860ceaad3bb',
            '2c32a47483431210bd2a5860ceaad38c',
            'a432a47483431210bd2a5860ceaad3e8',
            '2c32a47483431210bd2a5860ceaad3de',
            'e032a47483431210bd2a5860ceaad3ef',
            '6832a47483431210bd2a5860ceaad3e5',
            '2342687483431210bd2a5860ceaad309',
            'e742687483431210bd2a5860ceaad389',
            '6f42687483431210bd2a5860ceaad3a1',
            'ab42687483431210bd2a5860ceaad398',
            '2742687483431210bd2a5860ceaad390',
            'ab42687483431210bd2a5860ceaad3a8',
            'e96328f483431210bd2a5860ceaad341',
            'e96328f483431210bd2a5860ceaad355',
            'e16328f483431210bd2a5860ceaad336',
            'ad6328f483431210bd2a5860ceaad364',
            'a16328f483431210bd2a5860ceaad35f',
            'ad6328f483431210bd2a5860ceaad370',
            '89f82cbc83431210bd2a5860ceaad360',
            '81f82cbc83431210bd2a5860ceaad355',
            'c1f82cbc83431210bd2a5860ceaad368',
            'c9f82cbc83431210bd2a5860ceaad382',
            '41f82cbc83431210bd2a5860ceaad377',
            '81f82cbc83431210bd2a5860ceaad371'
};

List<CAF_Task__c> doomed = [
    SELECT Id, Name, ServiceNow_Sys_Id__c
    FROM CAF_Task__c
    WHERE ServiceNow_Sys_Id__c IN :snIds
];

System.debug('matched ' + doomed.size() + ' of ' + snIds.size());
System.assertEquals(24, doomed.size(), 'Expected exactly 24 - aborting without deleting');

delete doomed;
System.debug('deleted ' + doomed.size() + ' orphan CAF_Task__c records');