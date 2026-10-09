/**
 * SAMPLE DATA FOR THE DASHBOARD - visual reference only.
 *
 * TO REMOVE IT LATER (three steps, nothing else depends on this file):
 *   1. Delete this file.
 *   2. In dashboard.ts delete the import of this file, the `mockOn` field, and the two lines in load()
 *      that choose `feed$` (keep `live$.subscribe(...)`).
 *   3. In dashboard.html delete the `@if (mockOn)` "Sample data" label in the command bar.
 *
 * Or just set DASHBOARD_MOCK_ENABLED to false to see the real figures again.
 *
 * The shapes below match what the payment, campaign, donor, IAM and access-request services return, so
 * the dashboard code path is exactly the real one; only the source of the numbers differs.
 */
// OFF: the dashboard is the landing page for every role, and with this on it showed invented figures
// (318 open leads where the organisation has 64; "No follow-ups waiting" to a DonorCare user with
// three) as though they were the organisation's own. Turn it on only to look at the layout.
export const DASHBOARD_MOCK_ENABLED = false;

const money = (amount: number) => ({
  amount,
  currencyCode: 'INR',
  display: `${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} INR`,
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const donors = [
  'Rahul Varun', 'Anita Suresh', 'Vikram Anand', 'Meera Krishnan', 'Arjun Mohan', 'Sana Firoz',
  'Dev Sanjay', 'Lata Ramesh', 'Karthik Vel', 'Pooja Dinesh', 'Imran Yusuf', 'Divya Prakash',
];
const campaignNames = [
  'Blind-Stick Distribution', 'Education Support', 'Healthcare Aid', 'Women Empowerment', null,
];
const statuses = ['settled', 'settled', 'settled', 'recorded', 'settled', 'refunded', 'settled', 'chargedBack'];
const methods = ['upi', 'upi', 'card', 'netBanking', 'upi', 'card', 'bankTransfer', 'upi'];
const describe = (s: string) =>
  s === 'chargedBack' ? 'Charged back' : s === 'partiallyRefunded' ? 'Partly refunded' : s[0].toUpperCase() + s.slice(1);

/** Ninety-odd gifts spread over the last fourteen days, bigger on weekends, with a lull in the middle. */
function donationSample() {
  const items = [];
  for (let i = 0; i < 96; i++) {
    const k = i % statuses.length;
    const hours = i * 3.4 + 0.5;
    const day = Math.floor(hours / 24);
    const base = 900 + ((i * 1373) % 7200);
    const boost = day % 7 === 5 || day % 7 === 6 ? 1.6 : 1;
    const amount = Math.round(base * boost * (day > 5 && day < 9 ? 0.6 : 1));
    items.push({
      id: `mock-d-${i}`,
      donationReference: `DN-${24100 - i}`,
      donorName: donors[(i * 5) % donors.length],
      donorEmail: '',
      amount: money(amount),
      netAmount: money(amount),
      status: statuses[k],
      statusDescription: describe(statuses[k]),
      settlementStatus: 'settled',
      reconciliationStatus: 'matched',
      donatedAtUtc: hoursAgo(hours),
      methodType: methods[(i * 3) % methods.length],
      campaignId: null,
      campaignName: campaignNames[(i * 7) % campaignNames.length],
      sourceType: 'online',
      hasIssuedReceipt: true,
      receiptNumber: null,
      hasOpenCase: false,
      version: 1,
    });
  }
  return items;
}

const campaignSamples: Record<string, [string, string, string, number, string, string][]> = {
  draft: [
    ['CMP-021', 'Clean Water Wells', 'Water', 0, '2027-02-01', '2027-06-30'],
    ['CMP-022', 'Winter Blanket Drive', 'Relief', 0, '2026-11-20', '2027-01-31'],
    ['CMP-023', 'Digital Classrooms', 'Education', 0, '2027-01-10', '2027-05-31'],
  ],
  submitted: [
    ['CMP-018', 'Cataract Surgery Camp', 'Health', 0, '2026-11-01', '2026-12-20'],
    ['CMP-019', 'Skill Training Centre', 'Livelihood', 0, '2026-12-01', '2027-03-31'],
  ],
  approved: [['CMP-017', 'Flood Relief Fund', 'Relief', 0, '2026-10-25', '2026-12-31']],
  scheduled: [
    ['CMP-015', 'Diwali Food Packs', 'Relief', 0, '2026-10-28', '2026-11-12'],
    ['CMP-016', 'School Kits Drive', 'Education', 0, '2026-11-05', '2027-01-15'],
  ],
  active: [
    ['CMP-001', 'Blind-Stick Distribution Drive', 'Mobility', 72, '2026-04-01', '2026-12-31'],
    ['CMP-004', 'Education Support Programme', 'Education', 35, '2026-07-01', '2027-03-31'],
    ['CMP-007', 'Healthcare Aid', 'Health', 91, '2026-03-01', '2026-11-15'],
    ['CMP-009', 'Women Livelihood Fund', 'Livelihood', 54, '2026-06-01', '2027-01-31'],
    ['CMP-011', 'Rural Library Network', 'Education', 22, '2026-08-15', '2027-04-30'],
    ['CMP-012', 'Elder Care Support', 'Health', 47, '2026-06-20', '2027-02-28'],
  ],
  paused: [['CMP-010', 'Orphanage Renovation', 'Infrastructure', 40, '2026-05-01', '2027-01-31']],
  closing: [['CMP-006', 'Summer Nutrition Drive', 'Health', 98, '2026-04-01', '2026-10-31']],
  closed: [
    ['CMP-002', 'Monsoon Relief 2026', 'Relief', 100, '2026-06-01', '2026-09-15'],
    ['CMP-003', 'Back-to-School Fund', 'Education', 100, '2026-05-01', '2026-08-31'],
  ],
  cancelled: [],
};

/** Campaign rows for one stage, in the shape searchCampaigns returns. */
export function mockCampaignsForStage(stage: string) {
  const items = (campaignSamples[stage] ?? []).map((c, i) => ({
    id: `mock-c-${stage}-${i}`,
    code: c[0],
    name: c[1],
    fundOrProgramme: c[2],
    elapsedPercent: c[3],
    targetAmount: 500_000 * (3 + ((i * 7 + stage.length * 3) % 11)),
    startDate: c[4],
    endDate: c[5],
  }));
  return { items, totalCount: items.length };
}

export function buildDashboardMock() {
  return {
    donations: {
      totalCount: 1286,
      totalAmount: money(18_742_500),
      totalRefunded: money(214_000),
      netAmount: money(18_528_500),
      recordedCount: 94,
      settledCount: 1142,
      refundedCount: 38,
      chargedBackCount: 12,
      awaitingReceiptCount: 31,
      unreconciledCount: 57,
    },
    campaigns: {
      total: 18, draft: 3, submitted: 2, approved: 1, scheduled: 2, active: 6, paused: 1, closing: 1, closed: 2, cancelled: 0,
    },
    donors: { items: [], totalCount: 842 },
    sample: { items: donationSample(), totalCount: 211 },
    activity: {
      items: [
        ['Anita Suresh', 'approved an access request', 'Access request', 'AR-1042', 'Success', 0.4],
        ['Rahul Ganesh', 'created a user', 'User', 'Sana Firoz', 'Success', 1.2],
        ['System', 'processed a gateway event', 'Payment event', 'evt_9f2c1', 'Success', 2.1],
        ['Dev Sanjay', 'signed in', 'Session', 'Chrome on Windows', 'Failed', 3.5],
        ['Lata Ramesh', 'published a campaign', 'Campaign', 'Healthcare Aid', 'Success', 5.8],
        ['Pradeesh Raj', 'recorded a donation', 'Donation', 'DN-24096', 'Success', 7.3],
        ['Meera Krishnan', 'assigned a lead', 'Lead', 'L-0412', 'Success', 9.6],
        ['System', 'issued 14 receipts', 'Receipt', 'Batch 118', 'Success', 12.0],
      ].map((e, i) => ({
        id: `mock-a-${i}`,
        actorDisplayName: e[0],
        actionDisplay: e[1],
        targetType: e[2],
        targetDisplayName: e[3],
        resultDisplay: e[4],
        occurredAtUtc: hoursAgo(e[5] as number),
      })),
      totalCount: 8,
    },
    followUps: {
      followUps: {
        items: [
          ['Rahul Varun', 'Thank-you call after the Rs 50,000 gift', -26, 'phone'],
          ['Anita Suresh', 'Share the education impact report', 3, 'email'],
          ['Karthik Vel', 'Renewal conversation', 20, 'phone'],
          ['Lead L-0412', 'First contact', 28, 'whatsapp'],
          ['Pooja Dinesh', 'Invite to the annual event', 52, 'email'],
          ['Imran Yusuf', 'Confirm pledge instalment', 76, 'phone'],
        ].map((f, i) => ({
          id: `mock-f-${i}`,
          followUpReference: `F-${300 + i}`,
          donorDisplayName: String(f[0]).startsWith('Lead') ? null : f[0],
          leadReference: String(f[0]).startsWith('Lead') ? f[0] : null,
          nextAction: f[1],
          purpose: f[1],
          permittedChannel: f[3],
          status: 'planned',
          completedAtUtc: null,
          dueAtUtc: hoursAhead(f[2] as number),
        })),
        totalCount: 14,
      },
    },
    activeUsers: { items: [], totalCount: 34 },
    invitedUsers: { items: [], totalCount: 5 },
    access: { items: [], totalCount: 4 },
    running: {
      items: [
        { id: 'mc1', code: 'CMP-001', name: 'Blind-Stick Distribution Drive', fundOrProgramme: 'Mobility', endDate: '2026-12-31', elapsedPercent: 72 },
        { id: 'mc2', code: 'CMP-004', name: 'Education Support Programme', fundOrProgramme: 'Education', endDate: '2027-03-31', elapsedPercent: 35 },
        { id: 'mc3', code: 'CMP-007', name: 'Healthcare Aid', fundOrProgramme: 'Health', endDate: '2026-11-15', elapsedPercent: 91 },
        { id: 'mc4', code: 'CMP-009', name: 'Women Livelihood Fund', fundOrProgramme: 'Livelihood', endDate: '2027-01-31', elapsedPercent: 54 },
      ],
      totalCount: 6,
    },
    leads: {
      summary: { totalLeads: 318, unassignedLeads: 12, assignedLeads: 306, hotLeads: 41, convertedLeads: 57, highDonationPotential: 64 },
    },
    receipts: { summary: { totalReceipts: 1190, totalAmount: money(18_300_000), successful: 1152, failed: 38 } },
    sources: {
      attributionRate: 68.4,
      byChannel: [
        { key: 'wa', label: 'WhatsApp', amount: 5_800_000, donationCount: 392, sharePercentage: 31 },
        { key: 'em', label: 'Email', amount: 3_400_000, donationCount: 241, sharePercentage: 18 },
        { key: 'qr', label: 'QR poster', amount: 2_250_000, donationCount: 188, sharePercentage: 12 },
        { key: 'web', label: 'Website', amount: 1_300_000, donationCount: 96, sharePercentage: 7 },
      ],
    },
    refunds: {
      items: [
        { caseReference: 'RF-118', donorName: 'Meera Krishnan', amount: money(1500), statusDescription: 'Requested' },
        { caseReference: 'RF-119', donorName: 'Dev Sanjay', amount: money(4000), statusDescription: 'Approved' },
      ],
      totalCount: 3,
    },
    chargebacks: {
      items: [
        { caseReference: 'CB-31', donorName: 'Arjun Mohan', disputedAmount: money(7500), statusDescription: 'Evidence required', daysUntilEvidenceDue: -2, isOverdue: true },
        { caseReference: 'CB-32', donorName: 'Sana Firoz', disputedAmount: money(3200), statusDescription: 'Under review', daysUntilEvidenceDue: 6, isOverdue: false },
      ],
      totalCount: 2,
    },
    overdue: { items: [], totalCount: 1 },
    events: { items: [], totalCount: 5 },
  };
}
