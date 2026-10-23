<?xml version="1.0" encoding="UTF-8"?>
<!--
    The CAF Compliance Lightning app (CAF-222).

    Navigation follows the plan as far as the pieces exist today: Home,
    Dashboard, Requests, Tasks and Controls. My Work
    waits for the assignee fields (CAF-225, needs CAF-232). Sync Health and
    Admin are not separate tabs: they are screens inside the Dashboard tab
    (?c__view=admin), which already gates them by permission set.

    The header colour is a neutral placeholder until the client supplies the
    logo and brand colours; replace both here, nowhere else.

    Visibility comes from CAF_Viewer and CAF_Integration, not profiles.
-->
<CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionOverrides>
        <actionName>View</actionName>
        <comment>CAF task record page (CAF-229)</comment>
        <content>CAF_Task_Record_Page</content>
        <formFactor>Large</formFactor>
        <skipRecordTypeSelect>false</skipRecordTypeSelect>
        <type>Flexipage</type>
        <pageOrSobjectType>CAF_Task__c</pageOrSobjectType>
    </actionOverrides>
    <brand>
        <headerColor>#0B5CAB</headerColor>
        <shouldOverrideOrgTheme>false</shouldOverrideOrgTheme>
    </brand>
    <defaultLandingTab>CAF_Home</defaultLandingTab>
    <description>CAF compliance: the controls grid, requests and tasks mirrored from ServiceNow.</description>
    <formFactors>Small</formFactors>
    <formFactors>Large</formFactors>
    <isNavAutoTempTabsDisabled>false</isNavAutoTempTabsDisabled>
    <isNavPersonalizationDisabled>false</isNavPersonalizationDisabled>
    <label>CAF Compliance</label>
    <navType>Standard</navType>
    <tabs>CAF_Home</tabs>
    <tabs>CAF_Dashboard</tabs>
    <tabs>CAF_Request__c</tabs>
    <tabs>CAF_Task__c</tabs>
    <tabs>CAF_Control_Catalog__c</tabs>
    <uiType>Lightning</uiType>
</CustomApplication>
