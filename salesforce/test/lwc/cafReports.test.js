import { createElement } from 'lwc';
import CafReports, { csvCell } from 'c/cafReports';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getTaskSummary from '@salesforce/apex/CafReportsController.getTaskSummary';

jest.mock(
    '@salesforce/apex/CafDashboardController.getRequests',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafDashboardController.getControls',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafReportsController.getTaskSummary',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

function iso(offsetDays) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const CONTROLS = [
    { Name: 'Backup', ServiceNow_Sys_Id__c: 'c0' },
    { Name: 'DRP', ServiceNow_Sys_Id__c: 'c1' }
];

let seq = 0;
function request(app, control, status, due) {
    seq += 1;
    return {
        Business_Application__c: app,
        CAF_Control__c: CONTROLS[control] ? CONTROLS[control].Name : 'Retired',
        CAF_Control_Sys_Id__c: CONTROLS[control] ? CONTROLS[control].ServiceNow_Sys_Id__c : 'gone',
        CAF_Status__c: status,
        Planned_Completion_Date__c: due || null,
        ServiceNow_Sys_Id__c: 'r' + seq,
        SN_Number__c: 'RCAF' + String(seq).padStart(7, '0')
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(requests, buckets = []) {
    const el = createElement('c-caf-reports', { is: CafReports });
    document.body.appendChild(el);
    getControls.emit(CONTROLS);
    getRequests.emit(requests);
    getTaskSummary.emit(buckets);
    await flush();
    return el;
}

const tile = (el, label) => {
    const t = Array.from(el.shadowRoot.querySelectorAll('.tile')).find((x) =>
        x.querySelector('.tile__label').textContent === label
    );
    return t.querySelector('span').textContent;
};

describe('c-caf-reports', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-040
    it('waits for both request and control wires', async () => {
        const el = createElement('c-caf-reports', { is: CafReports });
        document.body.appendChild(el);
        getRequests.emit([request('CRM', 0, 'in_compliance')]);
        await flush();
        expect(el.shadowRoot.textContent).toContain('Loading report data');
    });

    // TC-UNIT-041
    it('computes the headline figures from the request rows', async () => {
        const el = await render([
            request('CRM', 0, 'in_compliance'),
            request('CRM', 1, 'out_of_compliance'),
            request('HR', 0, 'approaching_due'),
            request('HR', 1, 'in_compliance')
        ]);

        expect(tile(el, 'Requests assessed')).toBe('4');
        expect(tile(el, 'Business applications')).toBe('2');
        expect(tile(el, 'Requests in compliance')).toBe('50%');
        expect(tile(el, 'Out of compliance')).toBe('1');
    });

    // TC-UNIT-042
    it('draws one bar per control and keeps unmatched requests in an extra row', async () => {
        const el = await render([
            request('CRM', 0, 'in_compliance'),
            request('CRM', 0, 'out_of_compliance'),
            request('HR', 9, 'in_compliance')
        ]);

        const names = Array.from(el.shadowRoot.querySelectorAll('table.bars tbody th')).map((t) => t.textContent);
        expect(names).toEqual(['Backup', 'DRP', 'Not in the active catalogue']);
        const backupSegs = el.shadowRoot.querySelectorAll('table.bars tbody tr')[0].querySelectorAll('.seg');
        expect(backupSegs).toHaveLength(2);
    });

    // TC-UNIT-043
    it('lists applications least compliant first, with the grid\'s Overall rule', async () => {
        const el = await render([
            request('Good', 0, 'in_compliance'),
            request('Bad', 0, 'out_of_compliance'),
            request('Bad', 1, 'in_compliance')
        ]);

        const rows = Array.from(el.shadowRoot.querySelectorAll('.cols section:first-child tbody tr'));
        expect(rows.map((r) => r.querySelector('th').textContent)).toEqual(['Bad', 'Good']);
        expect(rows[0].querySelector('.pill').textContent).toBe('1 of 2');
        expect(rows[1].querySelector('.pill').textContent).toBe('Compliant');
    });

    // TC-UNIT-044
    it('reports overdue and due-soon requests, leaving settled ones out', async () => {
        const el = await render([
            request('CRM', 0, 'out_of_compliance', iso(-2)),
            request('CRM', 1, 'approaching_due', iso(10)),
            request('HR', 0, 'in_compliance', iso(-5)),
            request('HR', 1, 'out_of_compliance', iso(90))
        ]);

        expect(el.shadowRoot.textContent).toContain('1 overdue, 1 due in the next 30 days');
        expect(el.shadowRoot.querySelector('.due--late').textContent).toBe('2d overdue');
    });

    // TC-UNIT-045
    it('totals tasks by state and counts attestations', async () => {
        const el = await render([request('CRM', 0, 'in_compliance')], [
            { state: 'Open', approval: null, total: 5 },
            { state: 'Closed Complete', approval: 'approved', total: 3 },
            { state: 'Closed Complete', approval: 'rejected', total: 1 }
        ]);

        expect(el.shadowRoot.textContent).toContain('3 approved');
        expect(el.shadowRoot.textContent).toContain('1 rejected');
        const closed = Array.from(el.shadowRoot.querySelectorAll('.cols section:last-child tbody tr')).find(
            (r) => r.querySelector('th').textContent === 'Closed Complete'
        );
        expect(closed.querySelector('.num').textContent).toBe('4');
    });

    // TC-UNIT-046
    it('scopes every figure to the selected application', async () => {
        const el = await render([
            request('CRM', 0, 'in_compliance'),
            request('CRM', 1, 'in_compliance'),
            request('HR', 0, 'out_of_compliance')
        ]);
        const select = el.shadowRoot.querySelector('select.filters__app');
        select.value = 'HR';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();

        expect(tile(el, 'Requests assessed')).toBe('1');
        expect(tile(el, 'Requests in compliance')).toBe('0%');
        expect(el.shadowRoot.querySelectorAll('.cols section:first-child tbody tr')).toHaveLength(1);
    });

    // TC-UNIT-047
    it('defuses spreadsheet formulas and quotes separators in the CSV', () => {
        expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
        expect(csvCell('+1')).toBe("'+1");
        expect(csvCell('-2')).toBe("'-2");
        expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(csvCell('a, b')).toBe('"a, b"');
        expect(csvCell('plain')).toBe('plain');
        expect(csvCell(null)).toBe('');
    });

    // TC-UNIT-048
    it('exports the filtered rows, with the application in the file name', async () => {
        const clicked = [];
        const spy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            clicked.push({ href: this.href, download: this.download });
        });
        const el = await render([request('CRM', 0, 'in_compliance'), request('HR Portal', 0, 'out_of_compliance')]);
        const select = el.shadowRoot.querySelector('select.filters__app');
        select.value = 'HR Portal';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
        el.shadowRoot.querySelectorAll('.actions button')[1].click();
        spy.mockRestore();

        expect(clicked).toHaveLength(1);
        expect(clicked[0].download).toMatch(/^caf-compliance-hr-portal-\d{4}-\d{2}-\d{2}\.csv$/);
        const csv = decodeURIComponent(clicked[0].href.split(',').slice(1).join(','));
        const lines = csv.split('\r\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('HR Portal');
    });

    // TC-UNIT-049
    it('shows a task-count failure in its panel and keeps the rest of the report', async () => {
        const el = createElement('c-caf-reports', { is: CafReports });
        document.body.appendChild(el);
        getControls.emit(CONTROLS);
        getRequests.emit([request('CRM', 0, 'in_compliance')]);
        getTaskSummary.error({ message: 'boom' });
        await flush();

        expect(el.shadowRoot.textContent).toContain('Task counts could not be loaded');
        expect(tile(el, 'Requests assessed')).toBe('1');
    });
});
