/**
 * headerWatermarks: the ONLY place a screen's header watermark icon is chosen.
 *
 * Every <app-page-header> carries one oversized outline icon, low-contrast, bleeding off its right edge. The icon
 * is picked here, once per screen, from the small curated set below; a screen file never draws or imports one.
 * The key is the screen's template name (`campaign-register.html` -> 'campaign-register'), so it can be read
 * straight off the folder tree.
 *
 * WHY THE ICONS ARE DRAWN HERE. The app's icon set (Remix Icon) ships as a glyph font and as filled-outline SVGs;
 * neither can be stroked, and the watermark is line-art (`fill: none`, one stroke width). So the set is a small
 * group of stroke-only icons on a 24 x 24 grid in the same visual language as Remix's `-line` icons, built from a
 * few primitives. No icon library is added.
 *
 * ADDING A SCREEN. Add ONE entry to `headerWatermarks`, pointing at ONE icon from `WATERMARK_ICONS`. There is
 * no way to give an entry two icons: the type is a single `WatermarkIcon`, not a list.
 */

declare const watermarkBrand: unique symbol;

/**
 * One line-art icon on a 24 x 24 grid. The brand makes it impossible to build one anywhere but in this file
 * (the factory below is not exported), and an array of icons is not assignable to it.
 */
export interface WatermarkIcon {
  readonly [watermarkBrand]: true;
  readonly label: string;
  /** SVG path data, stroke only. */
  readonly paths: readonly string[];
}

// ---------- drawing helpers (24 x 24 grid) ----------
const icon = (label: string, ...paths: string[]): WatermarkIcon =>
  ({ label, paths }) as unknown as WatermarkIcon;

const n = (v: number) => Math.round(v * 100) / 100;
const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx - r)} ${cy}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0Z`;
const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  r
    ? `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}` +
      `a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`
    : `M${x} ${y}h${w}v${h}h${-w}Z`;
const dot = (x: number, y: number) => `M${x} ${y}h.01`;

const PERSON = 'M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2';
const DOC = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z';
const PACKAGE = 'M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z';
const CALENDAR_FRAME = [rect(3, 4, 18, 18, 2), 'M16 2v4', 'M8 2v4', 'M3 10h18'];
const CLIPBOARD_FRAME = [rect(8, 2, 8, 4, 1), 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'];

/** The approved set. Nothing outside this object can be a watermark. */
export const WATERMARK_ICONS = {
  eye: icon('Eye', 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', circle(12, 12, 3)),
  userCheck: icon('User check', circle(9, 7, 4), PERSON, 'M16 11l2 2 4-4'),
  history: icon('History', 'M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l4 2'),
  users: icon('Users', circle(9, 7, 4), PERSON, 'M16 3.1a4 4 0 0 1 0 7.8', 'M22 21v-2a4 4 0 0 0-3-3.9'),
  userPlus: icon('User plus', circle(9, 7, 4), PERSON, 'M19 8v6', 'M22 11h-6'),
  atSign: icon('At sign', circle(12, 12, 4), 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8'),
  sliders: icon('Sliders', 'M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'),
  gitBranch: icon('Branch', 'M6 3v12', circle(18, 6, 3), circle(6, 18, 3), 'M18 9a9 9 0 0 1-9 9'),
  shield: icon('Shield', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  shieldAlert: icon('Shield alert', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M12 8v4', dot(12, 16)),
  building: icon('Building', rect(4, 2, 16, 20, 2), 'M9 22v-4h6v4', 'M8 6h2', 'M14 6h2', 'M8 10h2', 'M14 10h2', 'M8 14h2', 'M14 14h2'),
  network: icon('Network', rect(16, 16, 6, 6, 1), rect(2, 16, 6, 6, 1), rect(9, 2, 6, 6, 1), 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3', 'M12 12V8'),
  idCard: icon('ID card', rect(2, 4, 20, 16, 2), circle(9, 11, 2), 'M6 17c0-2 1.5-3 3-3s3 1 3 3', 'M15 9h4', 'M15 13h3'),
  user: icon('User', circle(12, 7, 4), 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'),
  circleUser: icon('Profile', circle(12, 12, 10), circle(12, 10, 3), 'M6.2 18.5a7 7 0 0 1 11.6 0'),
  contactBook: icon('Directory', 'M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M2 7h3', 'M2 12h3', 'M2 17h3', circle(13, 10, 2.5), 'M8.5 17c.5-2 2.3-3 4.5-3s4 1 4.5 3'),
  lock: icon('Lock', rect(4, 11, 16, 10, 2), 'M8 11V7a4 4 0 0 1 8 0v4'),
  key: icon('Key', 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'),
  compass: icon('Compass', circle(12, 12, 10), 'M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z'),
  target: icon('Target', circle(12, 12, 10), circle(12, 12, 6), circle(12, 12, 2)),
  flag: icon('Flag', 'M4 22V4', 'M4 4h13l-2.5 4.5L17 13H4'),
  clipboardCheck: icon('Checklist', ...CLIPBOARD_FRAME, 'M9 14l2 2 4-4'),
  clipboardList: icon('Count sheet', ...CLIPBOARD_FRAME, 'M12 11h4', 'M12 16h4', dot(8, 11), dot(8, 16)),
  megaphone: icon('Megaphone', 'M3 11l18-5v12L3 14v-3z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'),
  rocket: icon('Rocket', 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z', 'M12 15l-3-3a22 22 0 0 1 2-4A13 13 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z', 'M9 12H4s.55-3 2-4c1.6-1.1 5 0 5 0', 'M12 15v5s3-.55 4-2c1.1-1.6 0-5 0-5'),
  link: icon('Link', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'),
  alertTriangle: icon('Alert', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', dot(12, 17)),
  octagonAlert: icon('Exception', 'M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z', 'M12 8v4', dot(12, 16)),
  messageWarning: icon('Complaint', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'M12 7v4', dot(12, 14)),
  message: icon('Message', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'M8 9h8', 'M8 13h5'),
  send: icon('Send', 'M22 2L11 13', 'M22 2l-7 20-4-9-9-4z'),
  calendar: icon('Calendar', ...CALENDAR_FRAME),
  calendarCheck: icon('Scheduled', ...CALENDAR_FRAME, 'M9 16l2 2 4-4'),
  ban: icon('Ban', circle(12, 12, 10), 'M4.9 4.9l14.2 14.2'),
  fileText: icon('Document', DOC, 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'),
  fileSearch: icon('Audit', DOC, 'M14 2v6h6', circle(11.5, 14.5, 2.5), 'M13.3 16.3L15 18'),
  inbox: icon('Inbox', 'M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z'),
  creditCard: icon('Card', rect(2, 5, 20, 14, 2), 'M2 10h20', 'M6 15h4'),
  home: icon('Home', 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'),
  activity: icon('Activity', 'M22 12h-4l-3 9L9 3l-3 9H2'),
  heart: icon('Heart', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z'),
  kanban: icon('Board', rect(3, 3, 18, 18, 2), 'M8 7v9', 'M12 7v5', 'M16 7v11'),
  clock: icon('Clock', circle(12, 12, 10), 'M12 6v6l4 2'),
  toggle: icon('Toggle', rect(1, 5, 22, 14, 7), circle(16, 12, 3)),
  globe: icon('Globe', circle(12, 12, 10), 'M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20'),
  badgeCheck: icon('Verified', 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76z', 'M9 12l2 2 4-4'),
  list: icon('List', 'M8 6h13', 'M8 12h13', 'M8 18h13', dot(3, 6), dot(3, 12), dot(3, 18)),
  listChecks: icon('Checks', 'M11 6h10', 'M11 12h10', 'M11 18h10', 'M3 6l1.5 1.5L7 5', 'M3 12l1.5 1.5L7 11', 'M3 18l1.5 1.5L7 17'),
  copy: icon('Duplicates', rect(9, 9, 13, 13, 2), 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'),
  phone: icon('Phone', 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z'),
  funnel: icon('Funnel', 'M22 3H2l8 9.5V19l4 2v-8.5z'),
  briefcase: icon('Briefcase', rect(2, 7, 20, 14, 2), 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2', 'M2 13h20'),
  star: icon('Star', 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'),
  calculator: icon('Calculator', rect(4, 2, 16, 20, 2), 'M8 6h8', dot(8, 10), dot(12, 10), dot(16, 10), dot(8, 14), dot(12, 14), dot(16, 14), dot(8, 18), dot(12, 18), dot(16, 18)),
  rotateBack: icon('Reversal', 'M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'),
  circleCheck: icon('Approved', circle(12, 12, 10), 'M9 12l2 2 4-4'),
  banknote: icon('Cash', rect(2, 6, 20, 12, 2), circle(12, 12, 2), dot(6, 12), dot(18, 12)),
  archive: icon('Archive', rect(2, 3, 20, 5, 1), 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'),
  arrowsLeftRight: icon('Reconcile', 'M8 3L4 7l4 4', 'M4 7h16', 'M16 21l4-4-4-4', 'M20 17H4'),
  receipt: icon('Receipt', 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z', 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8', 'M12 17.5v-11'),
  bookOpen: icon('Ledger', 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'),
  package: icon('Package', PACKAGE, 'M3.3 7L12 12l8.7-5', 'M12 22V12'),
  bookmark: icon('Bookmark', 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'),
  scale: icon('Balance', 'M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z', 'M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z', 'M7 21h10', 'M12 3v18', 'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'),
  truck: icon('Truck', 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2', 'M15 18H9', 'M19 18h2a1 1 0 0 0 1-1v-3.7a1 1 0 0 0-.2-.6l-3.3-4.4a1 1 0 0 0-.8-.4H14', circle(17, 18, 2), circle(7, 18, 2)),
  warehouse: icon('Warehouse', 'M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35z', 'M6 18h12', 'M6 14h12', rect(6, 10, 12, 12)),
  mapPin: icon('Place', 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z', circle(12, 10, 3)),
  map: icon('Map', 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z', 'M8 2v16', 'M16 6v16'),
  landmark: icon('Landmark', 'M3 22h18', 'M6 18v-7', 'M10 18v-7', 'M14 18v-7', 'M18 18v-7', 'M12 2l8 5H4z'),
  circleDollar: icon('Currency', circle(12, 12, 10), 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8', 'M12 18V6'),
  menu: icon('Menu', 'M4 6h16', 'M4 12h16', 'M4 18h16'),
  barChart: icon('Bar chart', 'M12 20V10', 'M18 20V4', 'M6 20v-4'),
  search: icon('Search', circle(11, 11, 8), 'M21 21l-4.3-4.3'),
  layoutDashboard: icon('Workspace', rect(3, 3, 7, 9, 1), rect(14, 3, 7, 5, 1), rect(14, 12, 7, 9, 1), rect(3, 16, 7, 5, 1)),
  bell: icon('Bell', 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'),
  panelLeft: icon('Shell', rect(3, 3, 18, 18, 2), 'M9 3v18'),
  table: icon('Table', rect(3, 3, 18, 18, 2), 'M3 9h18', 'M3 15h18', 'M9 3v18'),
  layers: icon('Layers', 'M12 2L2 7l10 5 10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'),
  stickyNote: icon('Templates', 'M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z', 'M15 3v6h6', 'M8 13h8', 'M8 17h5'),
} as const satisfies Record<string, WatermarkIcon>;

const I = WATERMARK_ICONS;

/** Screen -> its one watermark icon. Keyed by template name. One entry, one icon. */
export const headerWatermarks = {
  // Administration
  'access-preview': I.eye,
  'access-request': I.userCheck,
  'audit-trail': I.fileSearch,
  'bulk-user-administration': I.users,
  'create-user': I.userPlus,
  'login-identifier-change': I.atSign,
  'menu-configuration': I.sliders,
  'menu-mapping': I.gitBranch,
  'my-security': I.shield,
  'organisation-structure': I.network,
  'role-catalogue': I.idCard,
  'user-details': I.user,
  'user-directory': I.contactBook,
  'user-profile': I.circleUser,
  'user-security': I.lock,

  // Organisation: organisation-detail has its own identity header (no PageHeader) since the 2026-09-23 redesign.

  // Campaigns
  'attribution-explorer': I.compass,
  'budget-and-target-plan': I.target,
  'campaign-detail': I.flag,
  'campaign-readiness-checklist': I.clipboardCheck,
  'campaign-register': I.megaphone,
  'campaign-wizard': I.rocket,
  'tracking-asset-manager': I.link,

  // Communications
  'communication-exception-queue': I.alertTriangle,
  'complaint-case': I.messageWarning,
  'conversation-detail': I.message,
  'outbound-message-composer': I.send,
  'sla-policy-calendar': I.calendar,
  'suppression-and-contact-restriction': I.ban,
  'template-catalogue': I.stickyNote,
  'unified-inbox': I.inbox,

  // Configuration, dashboard, payments
  'payment-gateway-configuration': I.creditCard,
  'dashboard': I.home,
  'payment-event-queue': I.activity,
  'public-donation-initiation': I.heart,

  // Donors and leads
  'assignment-board': I.kanban,
  'communication-timeline': I.history,
  'consent-preference-centre': I.toggle,
  'donor-360': I.globe,
  'donor-identity-verification': I.badgeCheck,
  'donor-list': I.list,
  'duplicate-review': I.copy,
  'follow-up-execution': I.phone,
  'follow-up-planner': I.calendarCheck,
  'follow-up-queue': I.listChecks,
  'lead-capture': I.funnel,
  'lead-work-queue': I.briefcase,
  'my-leads': I.star,

  // Finance
  'finance-exception-case': I.octagonAlert,
  'finance-workbench': I.calculator,
  'financial-correction-or-reversal': I.rotateBack,
  'maker-checker-review': I.circleCheck,
  'offline-donation-entry': I.banknote,
  'period-campaign-close': I.archive,
  'reconciliation-workspace': I.arrowsLeftRight,
  'settlement-batch-detail': I.receipt,

  // Inventory
  'batch-ledger': I.bookOpen,
  'inventory-exception-queue': I.shieldAlert,
  'inventory-overview': I.package,
  'reservation-manager': I.bookmark,
  'stock-adjustment-approval': I.scale,
  'stock-count-session': I.clipboardList,
  'stock-movement-form': I.truck,
  'warehouse-transfer': I.warehouse,

  // Masters
  'city': I.mapPin,
  'country': I.landmark,
  'currency': I.circleDollar,
  'state': I.map,
  'time-zone': I.clock,

  // Platform
  'business-unit': I.building,
  'menu-catalogue': I.menu,
  'permission-catalogue': I.key,

  // Workspace
  'executive-dashboard': I.barChart,
  'global-search': I.search,
  'work-space': I.layoutDashboard,
  'notification-centre': I.bell,
  'role-aware-application-shell': I.panelLeft,
  'saved-view-builder': I.layers,
  'standard-list-page': I.table,
  'standard-record-detail': I.fileText,
} as const satisfies Record<string, WatermarkIcon>;

/** Every screen that has a watermark. Passing anything else to `<app-page-header screen="...">` will not compile. */
export type HeaderScreenKey = keyof typeof headerWatermarks;
