/**
 * Evidence for a CAF Task.
 *
 * A file uploaded here lands twice on purpose. Salesforce keeps the
 * ContentVersion, which is what makes the native file UI - preview, download,
 * thumbnails - work without a round trip; ServiceNow keeps a sys_attachment
 * against the task, which is the copy an auditor is entitled to and the one the
 * attestation gate counts.
 *
 * The two copies are not reconciled and are not meant to be. Unlike a mirrored
 * field, a file has no value to disagree about: it is present or it is not, and
 * getEvidence() returns both lists side by side so a missing one is visible
 * rather than inferred.
 *
 * Nothing here writes CAF state. Evidence is a fact about a task, not a
 * transition of it; the transition is CafAttestationService's job.
 */
public with sharing class CafEvidenceService {

    private static final String BASE = 'callout:ServiceNow_CAF/api/x_gskn2_caf_compli/caf/task/';

    /**
     * Apex holds the file's Blob and its base64 expansion in the same 6MB heap,
     * and caps a callout body at 6MB as well. Two megabytes of file is about
     * 2.7MB encoded and clears both. The ServiceNow resource repeats the check,
     * so a caller that bypasses this class still cannot exceed it.
     */
    @TestVisible
    private static final Integer MAX_BYTES = 2097152;

    // ------------------------------------------------------------------ types

    public class EvidenceFile {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String sizeLabel;
        @AuraEnabled public String createdBy;
        @AuraEnabled public String createdOn;
        @AuraEnabled public String downloadUrl;   // Salesforce files only
    }

    public class EvidenceView {
        @AuraEnabled public List<EvidenceFile> salesforceFiles = new List<EvidenceFile>();
        @AuraEnabled public List<EvidenceFile> serviceNowFiles = new List<EvidenceFile>();
        @AuraEnabled public Integer serviceNowCount = 0;
        @AuraEnabled public String serviceNowError;
        @AuraEnabled public Integer maxBytes = MAX_BYTES;
    }

    // ----------------------------------------------------------------- public

    /**
     * Both sides of the evidence picture for one task.
     *
     * Not cacheable: it makes a callout, and an Apex method that makes one
     * cannot be. That is also what keeps the ServiceNow column honest - it is
     * read at the moment it is shown, not remembered from earlier.
     *
     * A ServiceNow outage degrades to an empty column and a message rather than
     * an exception, because the Salesforce half is still worth showing.
     */
    @AuraEnabled
    public static EvidenceView getEvidence(String taskRecordId, String taskSysId) {
        EvidenceView view = new EvidenceView();

        if (String.isNotBlank(taskRecordId)) {
            view.salesforceFiles = loadSalesforceFiles(taskRecordId);
        }

        if (String.isBlank(taskSysId)) {
            view.serviceNowError = 'This task carries no ServiceNow sys_id, so its ' +
                                   'evidence in the system of record cannot be read.';
            return view;
        }

        try {
            HttpResponse res = call('GET', BASE + taskSysId + '/evidence', null);
            if (res.getStatusCode() == 200) {
                Map<String, Object> parsed = unwrap(res.getBody());
                for (Object item : (List<Object>) parsed.get('files')) {
                    Map<String, Object> f = (Map<String, Object>) item;
                    EvidenceFile file = new EvidenceFile();
                    file.id        = (String) f.get('sys_id');
                    file.name      = (String) f.get('file_name');
                    file.sizeLabel = sizeLabel(f.get('size_bytes'));
                    file.createdBy = (String) f.get('sys_created_by');
                    file.createdOn = (String) f.get('sys_created_on');
                    view.serviceNowFiles.add(file);
                }
                view.serviceNowCount = view.serviceNowFiles.size();
            } else {
                view.serviceNowError = 'ServiceNow returned ' + res.getStatusCode() +
                                       ': ' + res.getBody();
            }
        } catch (Exception e) {
            view.serviceNowError = 'Could not reach ServiceNow: ' + e.getMessage();
        }

        return view;
    }

    /**
     * Push one already-uploaded Salesforce file into ServiceNow.
     *
     * One file per call, deliberately. Each transaction then holds exactly one
     * Blob and one base64 string, so the heap ceiling is a property of the
     * largest single file rather than of how many were dropped at once.
     */
    @AuraEnabled
    public static String pushEvidence(String taskSysId, String contentDocumentId) {
        if (String.isBlank(taskSysId) || String.isBlank(contentDocumentId)) {
            throw new AuraHandledException('taskSysId and contentDocumentId are both required.');
        }

        List<ContentVersion> versions = [
            SELECT Id, Title, FileExtension, ContentSize, VersionData
            FROM ContentVersion
            WHERE ContentDocumentId = :contentDocumentId
              AND IsLatest = true
            LIMIT 1
        ];
        if (versions.isEmpty()) {
            throw new AuraHandledException('That file could not be read back from Salesforce.');
        }

        ContentVersion cv = versions[0];
        if (cv.ContentSize > MAX_BYTES) {
            throw new AuraHandledException(
                cv.Title + ' is ' + sizeLabel(cv.ContentSize) + '. The limit for evidence ' +
                'pushed to ServiceNow is ' + sizeLabel(MAX_BYTES) + '.');
        }

        String fileName = String.isBlank(cv.FileExtension)
            ? cv.Title
            : cv.Title + '.' + cv.FileExtension;

        Map<String, Object> body = new Map<String, Object>{
            'file_name'    => fileName,
            'content_type' => contentTypeFor(cv.FileExtension),
            'data'         => EncodingUtil.base64Encode(cv.VersionData)
        };

        HttpResponse res;
        try {
            res = call('POST', BASE + taskSysId + '/evidence', JSON.serialize(body));
        } catch (Exception e) {
            throw new AuraHandledException(
                fileName + ' is stored in Salesforce but did not reach ServiceNow: ' +
                e.getMessage());
        }

        Integer code = res.getStatusCode();
        if (code >= 200 && code < 300) {
            return res.getBody();
        }
        // The Salesforce copy already exists at this point. Say so, or the user
        // sees the file in the list and an error and cannot tell which is true.
        throw new AuraHandledException(
            fileName + ' is stored in Salesforce but ServiceNow refused it (' + code +
            '): ' + res.getBody());
    }

    // ---------------------------------------------------------------- private

    private static List<EvidenceFile> loadSalesforceFiles(String taskRecordId) {
        List<EvidenceFile> files = new List<EvidenceFile>();

        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :taskRecordId
            LIMIT 200
        ]) {
            documentIds.add(link.ContentDocumentId);
        }
        if (documentIds.isEmpty()) {
            return files;
        }

        for (ContentVersion cv : [
            SELECT Id, ContentDocumentId, Title, FileExtension, ContentSize,
                   CreatedDate, CreatedBy.Name
            FROM ContentVersion
            WHERE ContentDocumentId IN :documentIds
              AND IsLatest = true
            ORDER BY CreatedDate DESC
        ]) {
            EvidenceFile file = new EvidenceFile();
            file.id        = cv.ContentDocumentId;
            file.name      = String.isBlank(cv.FileExtension)
                                 ? cv.Title
                                 : cv.Title + '.' + cv.FileExtension;
            file.sizeLabel = sizeLabel(cv.ContentSize);
            file.createdBy = cv.CreatedBy.Name;
            file.createdOn = cv.CreatedDate.format('yyyy-MM-dd HH:mm');
            // The shepherd servlet, rather than a /lightning/r/ record URL,
            // because this component is targeted at Experience Cloud too and
            // the Lightning path does not resolve there.
            file.downloadUrl = '/sfc/servlet.shepherd/document/download/' + cv.ContentDocumentId;
            files.add(file);
        }
        return files;
    }

    /**
     * Scripted REST wraps whatever the resource returns in "result". Same
     * unwrap as CafSyncHealth does, and for the same reason: reading the top
     * level instead gives a Map with one key and a null for every field the
     * caller actually wanted.
     */
    private static Map<String, Object> unwrap(String responseBody) {
        Map<String, Object> body =
            (Map<String, Object>) JSON.deserializeUntyped(responseBody);
        if (body.containsKey('result') && body.get('result') instanceof Map<String, Object>) {
            return (Map<String, Object>) body.get('result');
        }
        return body;
    }

    private static HttpResponse call(String method, String endpoint, String body) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod(method);
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Accept', 'application/json');
        if (body != null) {
            req.setBody(body);
        }
        req.setTimeout(120000);
        return new Http().send(req);
    }

    /**
     * ServiceNow stores whatever content type it is handed and serves the file
     * back with it, so a wrong one here means a PDF that downloads as an
     * unnamed binary. Only the types evidence actually arrives as are mapped;
     * anything else is left to the browser to sniff.
     */
    private static String contentTypeFor(String extension) {
        if (String.isBlank(extension)) {
            return 'application/octet-stream';
        }
        switch on extension.toLowerCase() {
            when 'pdf'          { return 'application/pdf'; }
            when 'png'          { return 'image/png'; }
            when 'jpg', 'jpeg'  { return 'image/jpeg'; }
            when 'gif'          { return 'image/gif'; }
            when 'csv'          { return 'text/csv'; }
            when 'txt', 'log'   { return 'text/plain'; }
            when 'json'         { return 'application/json'; }
            when 'xml'          { return 'application/xml'; }
            when 'doc'          { return 'application/msword'; }
            when 'docx'         { return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
            when 'xls'          { return 'application/vnd.ms-excel'; }
            when 'xlsx'         { return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
            when else           { return 'application/octet-stream'; }
        }
    }

    /**
     * ServiceNow returns size_bytes as a string and Salesforce as an Integer,
     * so this takes an Object rather than making both callers convert.
     */
    private static String sizeLabel(Object bytes) {
        if (bytes == null) {
            return '';
        }
        Decimal value;
        try {
            value = Decimal.valueOf(String.valueOf(bytes));
        } catch (Exception e) {
            return String.valueOf(bytes);
        }
        if (value < 1024) {
            return value.setScale(0) + ' B';
        }
        if (value < 1048576) {
            return (value / 1024).setScale(0) + ' KB';
        }
        return (value / 1048576).setScale(1) + ' MB';
    }
}
