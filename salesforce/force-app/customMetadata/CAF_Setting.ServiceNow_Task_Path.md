<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <label>ServiceNow Task Path</label>
    <protected>false</protected>
    <values>
        <field>Value__c</field>
        <value xsi:type="xsd:string">callout:ServiceNow_CAF/api/x_gskn2_caf_compli/caf/task/</value>
    </values>
    <values>
        <field>Notes__c</field>
        <value xsi:type="xsd:string">Base of the CAF task resource, ending in a slash. The task sys_id is appended to it. Change only if the named credential or the scoped app's API path changes.</value>
    </values>
</CustomMetadata>
