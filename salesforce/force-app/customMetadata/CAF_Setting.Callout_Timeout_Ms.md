<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <label>Callout Timeout Ms</label>
    <protected>false</protected>
    <values>
        <field>Value__c</field>
        <value xsi:type="xsd:string">120000</value>
    </values>
    <values>
        <field>Notes__c</field>
        <value xsi:type="xsd:string">Timeout for every call to ServiceNow, in milliseconds. 120000 is the Apex maximum and the right value: the update and attest resources reconcile records synchronously before they answer.</value>
    </values>
</CustomMetadata>
