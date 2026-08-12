/**
 * caf_short_desc
 *
 * GlideAjax helper that builds the CAF Request short description.
 *
 * Scope: x_gskn2_caf_compli
 * Client callable: Yes
 *
 * Called from two places:
 *   - client script "CAF Request - Process name" (onChange of caf_conformance_type)
 *   - CAFUtil.generateCAFRequests(), server side, on request generation
 *
 * ES5 only - the app runs at Helsinki JS level.
 *
 * FIX 2026-08-07: the date token used to come through as the literal string
 * "undefined" in every generated description. cmdb_ci_business_app has no
 * u_drp_last_review_date column on this instance (its only custom fields are
 * u_caf_compliance_status and u_emergency_tier), so ba.u_drp_last_review_date
 * evaluated to undefined, and the old guard `drp_date != ''` is true for
 * undefined - so the "with date" branch ran and concatenated it.
 * isValidField() keeps this correct whether or not the field is ever added.
 */
var caf_short_desc = Class.create();
caf_short_desc.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {

    short_desc: function(businessAppSysId, cafRelationSysId) {
        var cmdb = this.getParameter('sysparam_cmdb') || businessAppSysId;
        var caf_type = this.getParameter('sysparam_caf_type') || cafRelationSysId;
        var drp_date = '';
        var name = '';
        var type = '';

        var ba = new GlideRecord('cmdb_ci_business_app');
        ba.addQuery('sys_id', cmdb);
        ba.query();
        if (ba.next()) {
            name = ba.getValue('name') || '';
            if (ba.isValidField('u_drp_last_review_date')) {
                drp_date = ba.getValue('u_drp_last_review_date') || '';
            }
        }

        var rel = new GlideRecord('x_gskn2_caf_compli_caf_relationship');
        rel.addQuery('sys_id', caf_type);
        rel.query();
        if (rel.next()) {
            type = rel.caf_conformance_type.getDisplayValue() || '';
        }

        // Composed from whatever is actually present, rather than by branching
        // on the date alone. A business app that no longer exists leaves name
        // empty and a relationship with no conformance type leaves type empty,
        // and either one used to produce a description with a dangling ' - ' on
        // one end - which the client script writes straight into the form field.
        //
        // Each part is coerced with '' + before the comparison: getDisplayValue()
        // returns a Java string, and an empty one is not === '' in this engine,
        // so an untouched check passes it through as a separate part.
        var parts = [];
        var candidates = [name, drp_date, type];
        for (var i = 0; i < candidates.length; i++) {
            var value = ('' + (candidates[i] || '')).trim();
            if (value !== '') {
                parts.push(value);
            }
        }
        return parts.join(' - ');
    },

    type: 'caf_short_desc'
});
