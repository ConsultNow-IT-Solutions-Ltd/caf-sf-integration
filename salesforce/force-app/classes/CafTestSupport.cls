/**
 * Shared fixtures for the CAF Apex tests: a ServiceNow stand-in, a user who
 * holds CAF_Integration, and mirror records.
 *
 * Tests that read through WITH USER_MODE run as cafUser(), not as the test
 * runner. The runner is usually an admin whose profile grants everything, so a
 * missing field permission would pass in a test and fail for real users - the
 * defect CAF-220 found.
 *
 * Tests that insert records and then call out do the inserts before
 * Test.startTest(); a callout after uncommitted DML is refused even when
 * mocked.
 */
@IsTest
public class CafTestSupport {

    /** Answers every callout with one canned response, and keeps the requests. */
    public class ServiceNowMock implements HttpCalloutMock {
        public Integer status;
        public String body;
        public Boolean unreachable = false;
        public List<HttpRequest> received = new List<HttpRequest>();

        public ServiceNowMock(Integer status, String body) {
            this.status = status;
            this.body = body;
        }

        public HttpResponse respond(HttpRequest req) {
            received.add(req);
            if (unreachable) {
                throw new CalloutException('Read timed out');
            }
            HttpResponse res = new HttpResponse();
            res.setStatusCode(status);
            res.setBody(body == null ? '' : body);
            return res;
        }
    }

    /**
     * Callout tests are about the callout, so they act with both CAF
     * permissions. CafAccessTest covers who really holds them.
     */
    public static ServiceNowMock respondWith(Integer status, String body) {
        permitActions();
        ServiceNowMock mock = new ServiceNowMock(status, body);
        Test.setMock(HttpCalloutMock.class, mock);
        return mock;
    }

    public static ServiceNowMock unreachable() {
        permitActions();
        ServiceNowMock mock = new ServiceNowMock(0, null);
        mock.unreachable = true;
        Test.setMock(HttpCalloutMock.class, mock);
        return mock;
    }

    /**
     * A Minimum Access user holding CAF_Integration and nothing else, so every
     * permission the test relies on comes from the permission set rather than
     * a profile. Created as the running user to keep the setup-object insert
     * out of the caller's transaction, which would otherwise fail with
     * MIXED_DML_OPERATION.
     */
    public static User cafUser() {
        return newUser(true);
    }

    /** A Minimum Access user with no CAF access at all. */
    public static User userWithoutCafAccess() {
        return newUser(false);
    }

    /** Adds a permission set to a user made by cafUser(), e.g. CAF_Admin. */
    public static void grant(User user, String permissionSet) {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = :permissionSet LIMIT 1];
            insert new PermissionSetAssignment(AssigneeId = user.Id, PermissionSetId = ps.Id);
        }
    }

    public static CAF_Request__c request(String sysId, String application, String control) {
        return new CAF_Request__c(
            Name                   = 'RCAF-' + sysId,
            SN_Number__c           = 'RCAF-' + sysId,
            ServiceNow_Sys_Id__c   = sysId,
            Business_Application__c = application,
            CAF_Control__c         = control
        );
    }

    public static CAF_Task__c task(CAF_Request__c parent, String sysId, String num) {
        return new CAF_Task__c(
            Name                 = num,
            SN_Number__c         = num,
            ServiceNow_Sys_Id__c = sysId,
            CAF_Request__c       = parent.Id
        );
    }

    // ---------------------------------------------------------------- private

    private static void permitActions() {
        CafAccess.overrides.put(CafAccess.WORK_TASKS, true);
        CafAccess.overrides.put(CafAccess.ATTEST, true);
    }

    private static User newUser(Boolean withCafAccess) {
        User created;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Profile profile = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
            String unique = String.valueOf(Math.abs(Crypto.getRandomInteger()));
            created = new User(
                Alias             = 'caft' + unique.left(4),
                Email             = 'caf.test@example.com',
                EmailEncodingKey  = 'UTF-8',
                LastName          = 'CafTest',
                LanguageLocaleKey = 'en_US',
                LocaleSidKey      = 'en_GB',
                ProfileId         = profile.Id,
                TimeZoneSidKey    = 'Europe/London',
                Username          = 'caf.test.' + unique + '@example.com'
            );
            insert created;
            if (withCafAccess) {
                PermissionSet caf = [SELECT Id FROM PermissionSet WHERE Name = 'CAF_Integration' LIMIT 1];
                insert new PermissionSetAssignment(AssigneeId = created.Id, PermissionSetId = caf.Id);
            }
        }
        return created;
    }
}
