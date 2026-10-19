import { createElement } from 'lwc';
import CafDashboard from 'c/cafDashboard';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import check from '@salesforce/apex/CafSyncHealth.check';
import { CurrentPageReference, navigateCalls } from 'lightning/navigation';

// The stock stub's Navigate does nothing and records nothing; this one keeps
// each call so the tab bar's URL writes can be asserted.
jest.mock('lightning/navigation', () => {
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const calls = [];
    const NavigationMixin = (Base) =>
        class extends Base {
            [Navigate](ref, replace) {
                calls.push({ ref, replace });
            }
        };
    NavigationMixin.Navigate = Navigate;
    return { CurrentPageReference: createTestWireAdapter(jest.fn()), NavigationMixin, navigateCalls: calls };
});

jest.mock(
    '@salesforce/apex/CafDashboardController.getControls',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafDashboardController.getRequests',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafTaskService.getTasks',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafTaskService.applyChange',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
// The sync strip renders inside the dashboard and checks on connect.
jest.mock(
    '@salesforce/apex/CafSyncHealth.check',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafSyncHealth.resync',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

const CONTROLS = ['BCP', 'DRP', 'Backup', 'Access', 'Patching', 'Logging'].map((name, i) => ({
    Name: name,
    ServiceNow_Sys_Id__c: 'ctl' + i
}));

let seq = 0;
function request(app, controlIndex, status, overrides = {}) {
    seq += 1;
    return {
        Business_Application__c: app,
        CAF_Control_Sys_Id__c: 'ctl' + controlIndex,
        CAF_Control__c: CONTROLS[controlIndex].Name,
        CAF_Status__c: status,
        ServiceNow_Sys_Id__c: 'req' + seq,
        SN_Number__c: 'CAFR' + String(seq).padStart(7, '0'),
        ...overrides
    };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function render(controls, requests) {
    const el = createElement('c-caf-dashboard', { is: CafDashboard });
    document.body.appendChild(el);
    getControls.emit(controls);
    getRequests.emit(requests);
    await flush();
    return el;
}

/** Overall label per application, in the order the grid renders them. */
function overall(el) {
    const rows = el.shadowRoot.querySelectorAll('tbody tr');
    return Array.from(rows).map((tr) => ({
        app: tr.querySelector('th').textContent,
        label: tr.querySelector('.grid__overall span').textContent,
        className: tr.querySelector('.grid__overall span').className,
        na: tr.querySelectorAll('.na').length
    }));
}

describe('c-caf-dashboard roll-up', () => {
    beforeEach(() => {
        check.mockResolvedValue({ differences: [] });
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-010 - CAF-78: N/A controls stay out of the denominator
    it('reads Compliant when every control the app has a request for is compliant', async () => {
        const el = await render(CONTROLS, [
            request('Payroll', 0, 'in_compliance'),
            request('Payroll', 1, 'in_compliance')
        ]);

        const [row] = overall(el);
        expect(row.label).toBe('Compliant');
        expect(row.className).toContain('pill--green');
        expect(row.na).toBe(4);
    });

    // TC-UNIT-011 - the CAF-175 shape: 2 of 6 compliant must not read Compliant
    it('reads "2 of 6" when four of six assessed controls are out of compliance', async () => {
        const statuses = ['in_compliance', 'in_compliance', 'out_of_compliance',
            'out_of_compliance', 'out_of_compliance', 'out_of_compliance'];
        const el = await render(CONTROLS, statuses.map((s, i) => request('SAP HANA', i, s)));

        const [row] = overall(el);
        expect(row.label).toBe('2 of 6');
        expect(row.className).toContain('pill--amber');
    });

    // TC-UNIT-012
    it('counts approaching-due and exception-approved as not compliant', async () => {
        const el = await render(CONTROLS, [
            request('CRM', 0, 'in_compliance'),
            request('CRM', 1, 'approaching_due'),
            request('CRM', 2, 'archer_exception_approved')
        ]);

        expect(overall(el)[0].label).toBe('1 of 3');
    });

    // TC-UNIT-013 - a request pushed before CAF_Control_Sys_Id__c existed
    it('joins a request on the control name when it has no control sys_id', async () => {
        const el = await render(CONTROLS, [
            request('Legacy', 0, 'in_compliance', { CAF_Control_Sys_Id__c: null })
        ]);

        const [row] = overall(el);
        expect(row.label).toBe('Compliant');
        expect(row.na).toBe(5);
    });

    // TC-UNIT-014 - adding a control in ServiceNow is not a scoring change
    it('keeps an app Compliant when a new control with no requests is added', async () => {
        const reqs = [request('Payroll', 0, 'in_compliance')];
        const withNew = [...CONTROLS, { Name: 'Encryption', ServiceNow_Sys_Id__c: 'ctl6' }];
        const el = await render(withNew, reqs);

        const [row] = overall(el);
        expect(row.label).toBe('Compliant');
        expect(el.shadowRoot.querySelectorAll('thead th.grid__control')).toHaveLength(7);
    });

    // TC-UNIT-015
    it('sorts applications by name', async () => {
        const el = await render(CONTROLS, [
            request('Zeta', 0, 'in_compliance'),
            request('alpha', 0, 'in_compliance'),
            request('Mid', 0, 'in_compliance')
        ]);

        expect(overall(el).map((r) => r.app)).toEqual(['alpha', 'Mid', 'Zeta']);
    });

    // TC-UNIT-016 - the grid waits for both wires
    it('stays on the loading message until both wires have answered', async () => {
        const el = createElement('c-caf-dashboard', { is: CafDashboard });
        document.body.appendChild(el);
        getRequests.emit([request('Payroll', 0, 'in_compliance')]);
        await flush();

        expect(el.shadowRoot.querySelector('table.grid')).toBeNull();
        expect(el.shadowRoot.textContent).toContain('Loading compliance data');
    });

    // TC-UNIT-017
    it('shows the error when a wire fails', async () => {
        const el = createElement('c-caf-dashboard', { is: CafDashboard });
        document.body.appendChild(el);
        getControls.error({ message: 'Insufficient access' });
        await flush();

        expect(el.shadowRoot.querySelector('.caf__msg--error')).not.toBeNull();
    });
});

// The other screens mount only when selected; their wires are stubbed here so
// switching to them renders without an org.
jest.mock(
    '@salesforce/apex/CafReportsController.getTaskSummary',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

describe('c-caf-dashboard screens', () => {
    beforeEach(() => {
        check.mockResolvedValue({ differences: [] });
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-020
    it('opens on Compliance with four screen tabs', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);
        const tabs = Array.from(el.shadowRoot.querySelectorAll('.views__tab'));

        expect(tabs.map((t) => t.textContent)).toEqual(['Compliance', 'Approvals', 'Reports', 'Admin']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(el.shadowRoot.querySelector('table.grid')).not.toBeNull();
    });

    // TC-UNIT-021
    it('swaps the grid for the selected screen and back', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);

        el.shadowRoot.querySelector('[data-view="reports"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('table.grid')).toBeNull();
        expect(el.shadowRoot.querySelector('c-caf-reports')).not.toBeNull();

        el.shadowRoot.querySelector('[data-view="compliance"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('table.grid')).not.toBeNull();
        expect(el.shadowRoot.querySelector('c-caf-reports')).toBeNull();
    });
});

const PAGE = { type: 'standard__navItemPage', attributes: { apiName: 'CAF_Dashboard' }, state: {} };

describe('c-caf-dashboard screen URLs and keyboard', () => {
    beforeEach(() => {
        check.mockResolvedValue({ differences: [] });
        navigateCalls.length = 0;
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-022
    it('opens on the screen named by c__view', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);
        CurrentPageReference.emit({ ...PAGE, state: { c__view: 'admin' } });
        await flush();

        expect(el.shadowRoot.querySelector('c-caf-admin')).not.toBeNull();
        expect(el.shadowRoot.querySelector('table.grid')).toBeNull();
    });

    // TC-UNIT-023
    it('ignores an unknown c__view and stays on Compliance', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);
        CurrentPageReference.emit({ ...PAGE, state: { c__view: 'nonsense' } });
        await flush();

        expect(el.shadowRoot.querySelector('table.grid')).not.toBeNull();
    });

    // TC-UNIT-024
    it('writes the screen into the URL with replace, and drops it for Compliance', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);
        CurrentPageReference.emit(PAGE);
        await flush();

        el.shadowRoot.querySelector('[data-view="approvals"]').click();
        await flush();
        el.shadowRoot.querySelector('[data-view="compliance"]').click();
        await flush();

        expect(navigateCalls).toHaveLength(2);
        expect(navigateCalls[0].ref.state.c__view).toBe('approvals');
        expect(navigateCalls[0].replace).toBe(true);
        expect('c__view' in navigateCalls[1].ref.state).toBe(false);
    });

    // TC-UNIT-025
    it('moves between screens with the arrow keys, wrapping at the ends', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);
        const nav = el.shadowRoot.querySelector('nav.views');
        const selected = () => el.shadowRoot.querySelector('.views__tab--on').textContent;

        nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        await flush();
        expect(selected()).toBe('Admin');

        nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
        await flush();
        expect(selected()).toBe('Compliance');

        nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        await flush();
        expect(selected()).toBe('Approvals');
        expect(el.shadowRoot.querySelector('.views__tab--on').getAttribute('tabindex')).toBe('0');
        expect(el.shadowRoot.activeElement.textContent).toBe('Approvals');
    });
});

describe('c-caf-dashboard grid filters, totals and panel', () => {
    beforeEach(() => {
        check.mockResolvedValue({ differences: [] });
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    const apps = (el) => Array.from(el.shadowRoot.querySelectorAll('table.grid tbody th.grid__app')).map((t) => t.textContent);

    async function estate() {
        return render(CONTROLS, [
            request('Payroll', 0, 'in_compliance'),
            request('Payroll', 1, 'in_compliance'),
            request('SAP HANA', 0, 'out_of_compliance'),
            request('SAP HANA', 1, 'in_compliance'),
            request('SAP Fiori', 0, 'approaching_due')
        ]);
    }

    // TC-UNIT-070
    it('narrows the grid by application name and says how many are shown', async () => {
        const el = await estate();
        const input = el.shadowRoot.querySelector('input.gridfilter__search');
        input.value = 'sap';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();

        expect(apps(el)).toEqual(['SAP Fiori', 'SAP HANA']);
        expect(el.shadowRoot.querySelector('.gridfilter__count').textContent).toBe('Showing 2 of 3 applications');
    });

    // TC-UNIT-071
    it('hides compliant applications under "Needs attention only"', async () => {
        const el = await estate();
        const box = el.shadowRoot.querySelector('input.gridfilter__attention');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();

        expect(apps(el)).toEqual(['SAP Fiori', 'SAP HANA']);
    });

    // TC-UNIT-072
    it('says so when no application matches, and keeps the filter bar', async () => {
        const el = await estate();
        const input = el.shadowRoot.querySelector('input.gridfilter__search');
        input.value = 'zzz';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();

        expect(el.shadowRoot.querySelector('table.grid')).toBeNull();
        expect(el.shadowRoot.textContent).toContain('No applications match the filter.');
        expect(el.shadowRoot.querySelector('input.gridfilter__search')).not.toBeNull();
    });

    // TC-UNIT-073
    it('totals each control column over assessed applications only, unaffected by the filter', async () => {
        const el = await estate();
        const footer = () => Array.from(el.shadowRoot.querySelectorAll('tfoot td.grid__total')).map((t) => t.textContent);

        // BCP: Payroll green, HANA red, Fiori amber -> 1/3. DRP: Payroll, HANA green -> 2/2. Rest unassessed.
        expect(footer()).toEqual(['1/3', '2/2', '-', '-', '-', '-', '1/3']);

        const input = el.shadowRoot.querySelector('input.gridfilter__search');
        input.value = 'payroll';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(footer()).toEqual(['1/3', '2/2', '-', '-', '-', '-', '1/3']);
    });

    // TC-UNIT-074
    it('counts each status and N/A in the legend', async () => {
        const el = await estate();
        const counts = Array.from(el.shadowRoot.querySelectorAll('.legend li')).map((li) =>
            li.querySelector('.legend__n').textContent
        );
        // green, amber, red, blue, N/A (3 apps x 6 controls = 18 cells, 5 assessed)
        expect(counts).toEqual(['3', '1', '1', '0', '13']);
    });

    // TC-UNIT-075
    it('opens the task panel focused, and Escape closes it', async () => {
        const el = await estate();
        el.shadowRoot.querySelector('button.cellbtn').click();
        await flush();

        const panel = el.shadowRoot.querySelector('section.panel');
        expect(panel).not.toBeNull();
        expect(el.shadowRoot.activeElement).toBe(panel);

        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flush();
        expect(el.shadowRoot.querySelector('section.panel')).toBeNull();
    });
});
