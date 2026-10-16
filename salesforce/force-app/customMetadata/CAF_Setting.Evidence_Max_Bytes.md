<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <label>Evidence Max Bytes</label>
    <protected>false</protected>
    <values>
        <field>Value__c</field>
        <value xsi:type="xsd:string">2097152</value>
    </values>
    <values>
        <field>Notes__c</field>
        <value xsi:type="xsd:string">Largest evidence file pushed to ServiceNow, in bytes. Can be lowered. Cannot be raised above 2097152 (2 MB): the file and its base64 copy share the 6 MB Apex heap, so CafConfig clamps anything larger.</value>
    </values>
</CustomMetadata>
