/**
 * The landing page's contract - the TypeScript side of `DashboardResponse`, which IAM, CAM, DON
 * and PAY each serve from their own `.../dashboard` endpoint.
 *
 * MIRRORS `Features/Dashboard/DTOs/DashboardDtos.cs`, which is copied verbatim into the four
 * services. Change the C# and change this file. The services omit nulls, so every nullable C#
 * field is optional here.
 */

export type DashboardModuleCode = 'IAM' | 'CAM' | 'DON' | 'PAY';

/** "money", "count" or "percent". Money is formatted on the page in the panel's currency. */
export type DashboardUnit = 'money' | 'count' | 'percent' | string;

export interface DashboardResponse {
  module: DashboardModuleCode;
  generatedAtUtc: string;
  timeZone: string;
  scopeLabel?: string;
  headlines: DashboardHeadline[];
  counters: DashboardCounter[];
  attention: DashboardAttentionItem[];
  actions: DashboardAction[];
  panels: DashboardPanels;
  viewer?: DashboardViewer;
}

export interface DashboardViewer {
  displayName: string;
  organisationName?: string;
  roleNames: string[];
  scopeLabel?: string;
  isPlatform: boolean;
}

export interface DashboardLink {
  label: string;
  route: string;
  queryParams?: Record<string, string>;
}

export interface DashboardEmptyState {
  title: string;
  hint: string;
  action?: DashboardLink;
}

export interface DashboardSpark {
  kind: 'line' | 'bars' | 'stages' | 'split' | string;
  values: number[];
  highlightIndex?: number;
}

export interface DashboardHeadline {
  key: string;
  rank: number;
  label: string;
  icon: string;
  tone: string;
  display: string;
  caption: string;
  meterPercent: number;
  foot: string;
  route?: string;
  spark?: DashboardSpark;
}

export interface DashboardCounter {
  key: string;
  rank: number;
  label: string;
  icon: string;
  value: number;
  route?: string;
}

export interface DashboardAttentionItem {
  key: string;
  rank: number;
  label: string;
  hint: string;
  count: number;
  icon: string;
  route?: string;
  queryParams?: Record<string, string>;
}

export interface DashboardAction {
  key: string;
  rank: number;
  label: string;
  icon: string;
  route: string;
  isPrimary: boolean;
  queryParams?: Record<string, string>;
}

export interface DashboardStat {
  label: string;
  value: number;
  unit: DashboardUnit;
  note?: string;
  isAlert: boolean;
  route?: string;
}

export interface DashboardChip {
  label: string;
  value: number;
  tone: string;
  icon: string;
}

export interface DashboardPanels {
  trend?: DashboardTrendPanel;
  health?: DashboardHealthPanel;
  activity?: DashboardActivityPanel;
  agenda?: DashboardAgendaPanel;
  pipeline?: DashboardPipelinePanel;
  ranking?: DashboardRankingPanel;
  leaders?: DashboardRankingPanel;
  feed?: DashboardFeedPanel;
  sources?: DashboardSharePanel;
  funnel?: DashboardFunnelPanel;
}

export type DashboardPanelKey = keyof DashboardPanels;

export interface DashboardTrendPoint {
  date: string;
  label: string;
  value: number;
  count: number;
  isToday: boolean;
}

export interface DashboardTrendPanel {
  rank: number;
  title: string;
  caption: string;
  unit: DashboardUnit;
  currencyCode: string;
  countSingular: string;
  countPlural: string;
  points: DashboardTrendPoint[];
  stats: DashboardStat[];
  link?: DashboardLink;
  pointRoute?: string;
  empty: DashboardEmptyState;
}

export interface DashboardSlice {
  key: string;
  label: string;
  count: number;
  tone: string;
  route?: string;
}

export interface DashboardRing {
  key: string;
  label: string;
  caption: string;
  percent?: number;
  tone: string;
  route?: string;
}

export interface DashboardHealthPanel {
  rank: number;
  title: string;
  link?: DashboardLink;
  slices: DashboardSlice[];
  centrePercent?: number;
  centreCaption: string;
  rings: DashboardRing[];
}

export interface DashboardActivityItem {
  id: string;
  actor: string;
  action: string;
  kindKey: string;
  kindLabel: string;
  icon: string;
  target?: string;
  occurredAtUtc: string;
  isFailure: boolean;
}

export interface DashboardActivityPanel {
  rank: number;
  title: string;
  caption?: string;
  items: DashboardActivityItem[];
  stats: DashboardStat[];
  itemRoute?: string;
  link?: DashboardLink;
  empty: DashboardEmptyState;
}

export interface DashboardAgendaItem {
  id: string;
  atUtc?: string;
  title: string;
  subtitle?: string;
  whenLabel: string;
  isLate: boolean;
  route?: string;
  queryParams?: Record<string, string>;
}

export interface DashboardAgendaPanel {
  rank: number;
  title: string;
  items: DashboardAgendaItem[];
  figures: DashboardStat[];
  link?: DashboardLink;
  empty: DashboardEmptyState;
}

export interface DashboardMeta {
  icon: string;
  text: string;
  isUrgent: boolean;
  amount?: number;
  currencyCode?: string;
}

export interface DashboardPipelineRow {
  id: string;
  code: string;
  name: string;
  kicker: string;
  detail: string;
  dialPercent?: number;
  meta: DashboardMeta[];
  progressPercent: number;
  whenLabel: string;
  isUrgent: boolean;
  route?: string;
  queryParams?: Record<string, string>;
}

export interface DashboardPipelineStage {
  key: string;
  label: string;
  count: number;
  emptyTitle: string;
  rows: DashboardPipelineRow[];

  /** The campaign stage whose colour this stage borrows; absent when the key is one already. */
  palette?: string;
}

export interface DashboardPipelinePanel {
  rank: number;
  title: string;
  liveLabel?: string;
  totalLabel?: string;
  defaultStage: string;
  stages: DashboardPipelineStage[];
  emptyHint: string;
  createAction?: DashboardLink;
  link?: DashboardLink;
  footNote?: string;
}

export interface DashboardRankingItem {
  key: string;
  label: string;
  value: number;
  count: number;
  share: number;
  route?: string;
  queryParams?: Record<string, string>;
}

export interface DashboardRankingPanel {
  rank: number;
  title: string;
  caption?: string;
  unit: DashboardUnit;
  currencyCode: string;
  countSingular: string;
  countPlural: string;
  items: DashboardRankingItem[];
  figures: DashboardStat[];
  headerLink?: DashboardLink;
  link?: DashboardLink;
  empty: DashboardEmptyState;
}

export interface DashboardFeedItem {
  id: string;
  title: string;
  reference: string;
  atUtc: string;
  tag: string;
  statusLabel: string;
  tone: string;
  value?: number;
  valueDisplay?: string;
  icon: string;
  route?: string;
  queryParams?: Record<string, string>;
}

export interface DashboardFeedPanel {
  rank: number;
  title: string;
  unit: DashboardUnit;
  currencyCode: string;
  eyebrow: string;
  totalValue: number;
  chips: DashboardChip[];
  items: DashboardFeedItem[];
  link?: DashboardLink;
  empty: DashboardEmptyState;
}

export interface DashboardShareItem {
  key: string;
  label: string;
  share: number;
  count: number;
  value: number;
  icon: string;
  route?: string;
}

export interface DashboardSharePanel {
  rank: number;
  title: string;
  unit: DashboardUnit;
  currencyCode: string;
  countPlural: string;
  headlinePercent: number;
  headlineLabel: string;
  leaderNote: string;
  items: DashboardShareItem[];
  rest?: DashboardShareItem;
  restHint?: string;
  headerLink?: DashboardLink;
  empty: DashboardEmptyState;
}

export interface DashboardFunnelStep {
  label: string;
  count: number;
  percent: number;
  tone: string;
  route?: string;
}

export interface DashboardFunnelAlert {
  label: string;
  actionLabel: string;
  route?: string;
  isOk: boolean;
}

export interface DashboardFunnelPanel {
  rank: number;
  title: string;
  headlinePercent: number;
  headlineLabel: string;
  headlineCaption: string;
  steps: DashboardFunnelStep[];
  alert?: DashboardFunnelAlert;
  headerLink?: DashboardLink;
}

/**
 * The four answers merged into the one page the template draws: the four lowest-ranked headline
 * cards, the counters and shortcuts in rank order, every attention row, and for each tile the
 * lowest-ranked panel any service sent.
 */
export interface DashboardPage {
  viewer?: DashboardViewer;
  headlines: DashboardHeadline[];
  counters: DashboardCounter[];
  attention: DashboardAttentionItem[];
  actions: DashboardAction[];
  panels: DashboardPanels;

  /** Which services answered - a section from one that did not is shown as unavailable. */
  answered: DashboardModuleCode[];
  generatedAtUtc?: string;
}

// =============================================================================================
// The Executive dashboard - outcome figures over a chosen period and scope.
//
// MIRRORS `Features/Dashboard/DTOs/DashboardOutcomesDtos.cs` in CAM, DON and PAY, each serving
// GET .../dashboard/outcomes. Merged on the page by rank, like the landing page.
// =============================================================================================

export interface DashboardOutcomesQuery {
  fromDate?: string;
  toDate?: string;
  campaignId?: string;
  comparison?: string;
}

export interface DashboardOutcomesResponse {
  module: DashboardModuleCode;
  generatedAtUtc: string;
  timeZone: string;
  timeZoneLabel: string;
  fromDate: string;
  toDate: string;
  comparisonFromDate?: string;
  comparisonToDate?: string;
  metrics: DashboardOutcomeMetric[];
  series?: DashboardOutcomeSeries;
  scopeOptions: DashboardScopeOption[];
  presets: DashboardPeriod[];
  comparisons: DashboardPeriod[];
}

export interface DashboardOutcomeMetric {
  key: string;
  rank: number;
  label: string;
  value: number;
  unit: DashboardUnit;
  currencyCode: string;
  qualifier: string;
  definition: string;
  comparisonValue?: number;
  drill?: DashboardLink;
}

export interface DashboardOutcomeSeries {
  primaryLabel: string;
  primaryUnit: DashboardUnit;
  secondaryLabel: string;
  secondaryUnit: DashboardUnit;
  currencyCode: string;
  points: DashboardOutcomePoint[];
}

export interface DashboardOutcomePoint {
  date: string;
  label: string;
  primary: number;
  secondary: number;
  comparisonPrimary?: number;
  comparisonSecondary?: number;
}

export interface DashboardScopeOption {
  campaignId: string;
  reference: string;
  name: string;
  context: string;
}

export interface DashboardPeriod {
  key: string;
  label: string;
  fromDate?: string;
  toDate?: string;
}

/** The three answers merged: metrics by rank, the curve, the campaigns, the periods. */
export interface DashboardOutcomes {
  metrics: DashboardOutcomeMetric[];
  series?: DashboardOutcomeSeries;
  scopeOptions: DashboardScopeOption[];
  presets: DashboardPeriod[];
  comparisons: DashboardPeriod[];
  fromDate?: string;
  toDate?: string;
  comparisonFromDate?: string;
  comparisonToDate?: string;
  timeZoneLabel?: string;
  generatedAtUtc?: string;

  /** Modules that did not answer (other than refusing the period). */
  failed: DashboardModuleCode[];

  /** The reason a module refused the period, when one did. */
  refusal?: string;
}
