import { createElement } from 'lwc';
import CafEvidence from 'c/cafEvidence';
import getEvidence from '@salesforce/apex/CafEvidenceService.getEvidence';

jest.mock(
    '@salesforce/apex/CafEvidenceService.getEvidence',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafEvidenceService.pushEvidence',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

const SYS_ID = '0123456789abcdef0123456789abcdef';

function files(n, prefix) {
    return Array.from({ length: n }, (_, i) => ({
        id: prefix + i,
        name: prefix + i + '.pdf',
        sizeLabel: '1 KB',
        createdBy: 'test',
        createdOn: '2026-10-17'
    }));
}

/** Let the awaited Apex call settle and the template re-render. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Mount the panel the way the dashboard does: sys_id handed in, so it loads
 * from connectedCallback and never waits on the record wire.
 */
async function mount(view, props = {}) {
    getEvidence.mockResolvedValue({ maxBytes: 2097152, ...view });
    const el = createElement('c-caf-evidence', { is: CafEvidence });
    Object.assign(el, { snSysId: SYS_ID, taskNumber: 'CAFT0001022' }, props);
    document.body.appendChild(el);
    await flush();
    return el;
}

function warning(el) {
    const p = el.shadowRoot.querySelector('.ev__msg--warn');
    return p ? p.textContent : null;
}

describe('c-caf-evidence', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-001
    it('tells the user to re-upload when Salesforce holds more (a failed push)', async () => {
        const el = await mount({ salesforceFiles: files(2, 'sf'), serviceNowFiles: files(1, 'sn') });

        const text = warning(el);
        expect(text).toContain('2 in Salesforce, 1 in ServiceNow.');
        expect(text).toMatch(/re-?upload/i);
    });

    // TC-UNIT-002 - the CAFT0001022 shape TC-INT-071 was written against
    it('does not tell the user to re-upload when ServiceNow holds more', async () => {
        const el = await mount({ salesforceFiles: files(1, 'sf'), serviceNowFiles: files(2, 'sn') });

        const text = warning(el);
        expect(text).toContain('1 in Salesforce, 2 in ServiceNow.');
        expect(text).not.toMatch(/re-?upload/i);
        expect(text).toMatch(/system of record/i);
    });

    // TC-UNIT-003
    it('shows no warning when both sides hold the same number of files', async () => {
        const el = await mount({ salesforceFiles: files(2, 'sf'), serviceNowFiles: files(2, 'sn') });

        expect(warning(el)).toBeNull();
    });

    // TC-UNIT-004 - an unreachable ServiceNow is not a mismatch
    it('shows no mismatch warning when ServiceNow could not be read', async () => {
        const el = await mount({
            salesforceFiles: files(1, 'sf'),
            serviceNowFiles: [],
            serviceNowError: 'Read timed out'
        });

        expect(warning(el)).toBeNull();
        expect(el.shadowRoot.querySelector('.ev__msg--error').textContent).toBe('Read timed out');
    });

    // TC-UNIT-005 - the attestation gate counts the ServiceNow copy only
    it('reports the ServiceNow count upward, not the Salesforce count', async () => {
        getEvidence.mockResolvedValue({
            maxBytes: 2097152,
            salesforceFiles: files(3, 'sf'),
            serviceNowFiles: files(1, 'sn')
        });
        const el = createElement('c-caf-evidence', { is: CafEvidence });
        el.snSysId = SYS_ID;
        const handler = jest.fn();
        el.addEventListener('evidencecount', handler);
        document.body.appendChild(el);
        await flush();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({ sysId: SYS_ID, count: 1 });
    });

    // TC-UNIT-006
    it('drops the upload control when read-only', async () => {
        const el = await mount(
            { salesforceFiles: [], serviceNowFiles: [] },
            { hideUpload: true }
        );

        expect(el.shadowRoot.querySelector('lightning-file-upload')).toBeNull();
        expect(el.shadowRoot.textContent).toContain('There is no evidence to review.');
    });
});
