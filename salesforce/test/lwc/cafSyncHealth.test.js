import { createElement } from 'lwc';
import CafSyncHealth, { ago } from 'c/cafSyncHealth';
import check from '@salesforce/apex/CafSyncHealth.check';
import resync from '@salesforce/apex/CafSyncHealth.resync';

jest.mock('@salesforce/apex/CafSyncHealth.check', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CafSyncHealth.resync', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function diff(n, overrides = {}) {
    return {
        recordType: 'request',
        recordNumber: 'RCAF000000' + n,
        sysId: 'sys' + n,
        kind: 'Short description differs',
        fieldLabel: 'Short description',
        servicenow: 'a',
        salesforce: 'b',
        canResync: true,
        ...overrides
    };
}

async function mount(report) {
    check.mockResolvedValue(report);
    const el = createElement('c-caf-sync-health', { is: CafSyncHealth });
    document.body.appendChild(el);
    await flush();
    return el;
}

const headline = (el) => el.shadowRoot.querySelector('.sync__headline').textContent;

describe('c-caf-sync-health', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-080
    it('reads "Out of sync" instead of crashing when the differences list is missing', async () => {
        const el = await mount({ inSync: false, differences: null, comparedCount: 5, snRequests: 2, snTasks: 3 });
        expect(headline(el)).toBe('Out of sync');
    });

    // TC-UNIT-081
    it('shows "?" for counts ServiceNow did not return, never "null"', async () => {
        const el = await mount({ inSync: true, differences: [], comparedCount: null, snRequests: 2, snTasks: undefined });
        const summary = el.shadowRoot.querySelector('.sync__summary').textContent;
        expect(summary).toContain('? records verified');
        expect(summary).toContain('? tasks');
        expect(summary).not.toContain('null');
    });

    // TC-UNIT-082
    it('treats an empty reply as a failed check, not as in sync', async () => {
        const el = await mount(null);
        expect(headline(el)).toBe('Could not check');
        expect(el.shadowRoot.querySelector('.sync__error').textContent).toContain('no comparison');
    });

    // TC-UNIT-083
    it('labels only the row being re-synced, and disables every Re-sync meanwhile', async () => {
        let release;
        resync.mockImplementation(() => new Promise((r) => { release = r; }));
        const el = await mount({ inSync: false, differences: [diff(1), diff(2)], comparedCount: 2, snRequests: 2, snTasks: 0 });

        const buttons = () => Array.from(el.shadowRoot.querySelectorAll('table.drift button.act'));
        buttons()[1].click();
        await flush();

        expect(buttons().map((b) => b.textContent)).toEqual(['Re-sync', 'Re-syncing\u2026']);
        expect(buttons().every((b) => b.disabled)).toBe(true);
        expect(resync).toHaveBeenCalledWith({ recordType: 'request', sysId: 'sys2' });

        check.mockResolvedValue({ inSync: true, differences: [], comparedCount: 2, snRequests: 2, snTasks: 0 });
        release('ok');
        await flush();
        await flush();
        expect(headline(el)).toBe('In sync');
    });

    // TC-UNIT-084
    it('says how long ago the check ran, and omits an unparseable time', async () => {
        expect(ago(0, 30 * 1000)).toBe('just now');
        expect(ago(0, 5 * 60000)).toBe('5 min ago');
        expect(ago(0, 125 * 60000)).toBe('2 h ago');
        expect(ago(NaN, 0)).toBe('');

        const el = await mount({ inSync: true, differences: [], checkedAt: 'not a time', comparedCount: 1, snRequests: 1, snTasks: 0 });
        expect(el.shadowRoot.querySelector('.sync__when')).toBeNull();
    });
});
