/**
 * The shape of the demo estate.
 *
 * One place, so the ServiceNow seed and any later verification read the same
 * matrix rather than two copies that drift. Every phase of the seed is keyed off
 * this and is idempotent against it, so re-running after an edit converges on
 * whatever this file says rather than creating a second set of records.
 */

/** The six active CAF Controls, keyed short. The values are the control names
 *  as they stand in `caf_conformance_type`, which is what both grids column on. */
export const CONTROLS = {
  HA: 'Confirm & Execute High Availability Plan',
  BK: 'Confirm Backup & Restore Policy',
  DR: 'Confirm Disaster Recovery Plan',
  RT: 'Confirm RTO & RPO',
  EN: 'Encryption',
  TB: 'Test Backup & Restore',
} as const;

export type ControlKey = keyof typeof CONTROLS;

/**
 * Cell status codes.
 *
 * G / A / R / X map onto the four `caf_status` values the Salesforce grid knows
 * how to colour; a control simply absent from an app's map renders N/A in both
 * grids, which is the fifth state and the reason this is a sparse map rather
 * than a fixed six-slot array.
 */
export const STATUS: Record<string, string> = {
  G: 'in_compliance',
  A: 'approaching_due',
  R: 'out_of_compliance',
  X: 'archer_exception_approved',
};

export interface SeedApp {
  /** Business application name — the row label in both grids. */
  name: string;
  /** Already present in cmdb_ci_business_app; do not create, only use. */
  existing?: boolean;
  /**
   * An application whose requests already exist and are simply being repointed
   * onto this name. Names the current business application to move off.
   */
  repointFrom?: string;
  /**
   * Specific requests to move onto this application, by number.
   *
   * Needed where `repointFrom` cannot express the selection because the source
   * application holds requests destined for two different rows.
   */
  repointNumbers?: string[];
  cells: Partial<Record<ControlKey, 'G' | 'A' | 'R' | 'X'>>;
}

/**
 * Eighteen applications: generic, recognisable, and deliberately uneven.
 *
 * The first three carry the existing 19 CAF Requests, moved off SAP Fiori,
 * SAP HANA and Zscalar App. That keeps the 31 tasks, the uploaded evidence and
 * the open attestation on CAFT0001001 intact — the whole end-to-end demo still
 * works, it just happens under a name a non-technical audience recognises.
 * Nothing is deleted anywhere.
 *
 * The spread is intentional: four fully compliant apps, several partial, two
 * clearly failing, one carrying an approved Archer exception, and four with
 * controls never assessed so N/A appears in the grid as well.
 */
export const APPS: SeedApp[] = [
  // --- the three repointed applications -------------------------------------
  {
    name: 'Office 365',
    repointFrom: 'Zscalar App',
    cells: { HA: 'G', BK: 'G', DR: 'G', RT: 'G', EN: 'G', TB: 'G' },
  },
  {
    // Takes SAP Fiori's requests, which is where the evidence and the open
    // attestation live. Its Disaster Recovery cell is deliberately the red one:
    // that is RCAF0001022, the request with CAFT0001001 sitting open on it, so
    // the obvious cell to click in a demo is also the one that has something to
    // show.
    name: 'Zoho HR System',
    existing: true,
    repointFrom: 'SAP Fiori',
    cells: { HA: 'A', BK: 'A', DR: 'R', RT: 'G', EN: 'G', TB: 'G' },
  },
  {
    // Its six requests were raised fresh against the Tier 0 relationship set.
    name: 'Employee Shift Tracking',
    cells: { HA: 'R', BK: 'A', DR: 'A', RT: 'R', EN: 'G', TB: 'R' },
  },
  {
    // SAP HANA's six requests, which date from January 2025 and were raised
    // against the Tier 1 relationships. They landed on Employee Shift Tracking
    // first — see the note on requestForControl — and are given a row of their
    // own rather than deleted: they are genuine records with real task history,
    // and a delete propagates to neither Salesforce nor anywhere else.
    name: 'Zoho Email',
    existing: true,
    repointNumbers: [
      'RCAF0001037',
      'RCAF0001038',
      'RCAF0001039',
      'RCAF0001040',
      'RCAF0001041',
      'RCAF0001042',
    ],
    cells: { HA: 'R', BK: 'R', DR: 'A', RT: 'R', EN: 'A', TB: 'R' },
  },

  // --- new applications ------------------------------------------------------
  { name: 'Leave Planner',               cells: { HA: 'G', BK: 'G', DR: 'G', RT: 'G', EN: 'G', TB: 'A' } },
  { name: 'Payroll Portal',              cells: { HA: 'G', BK: 'G', DR: 'G', RT: 'G', EN: 'G', TB: 'G' } },
  { name: 'Expense Claims',              cells: { HA: 'G', BK: 'G', DR: 'A', RT: 'G', EN: 'R', TB: 'G' } },
  { name: 'Recruitment Portal',          cells: { HA: 'A', BK: 'A', DR: 'G', RT: 'G' } },
  { name: 'Learning Management System',  cells: { HA: 'G', BK: 'G', DR: 'G', EN: 'G' } },
  { name: 'Employee Helpdesk',           cells: { HA: 'R', BK: 'A', DR: 'R', RT: 'G', EN: 'G', TB: 'A' } },
  { name: 'Travel Booking',              cells: { HA: 'G', BK: 'G', RT: 'G', TB: 'G' } },
  { name: 'IT Asset Management',         cells: { HA: 'A', BK: 'G', DR: 'G', RT: 'G', EN: 'G', TB: 'G' } },
  { name: 'Customer CRM',                cells: { HA: 'G', BK: 'G', DR: 'G', RT: 'G', EN: 'G', TB: 'G' } },
  { name: 'Invoicing & Billing',         cells: { HA: 'R', BK: 'R', DR: 'A', RT: 'R', EN: 'G', TB: 'R' } },
  { name: 'Vendor Management',           cells: { HA: 'X', BK: 'G', DR: 'G', RT: 'A', EN: 'G', TB: 'G' } },
  { name: 'Document Management',         cells: { HA: 'G', BK: 'G', DR: 'G', RT: 'A', EN: 'G', TB: 'G' } },
  { name: 'Intranet Portal',             cells: { BK: 'A', RT: 'G', TB: 'A' } },
  { name: 'Meeting Room Booking',        cells: { HA: 'G', RT: 'G', EN: 'G' } },
  { name: 'Timesheet System',            cells: { HA: 'A', BK: 'R', DR: 'G', RT: 'G', EN: 'A', TB: 'G' } },
];

/** Applications whose CI has to be created. */
export const APPS_TO_CREATE = APPS.filter((a) => !a.existing).map((a) => a.name);

/** Moves phase 2 performs: whole-application, then named individual requests. */
export const REPOINTS = APPS.filter((a) => a.repointFrom || a.repointNumbers).map((a) => ({
  from: a.repointFrom || '',
  numbers: a.repointNumbers || [],
  to: a.name,
}));
