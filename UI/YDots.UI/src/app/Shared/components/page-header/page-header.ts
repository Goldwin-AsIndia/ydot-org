import { Component, computed, input } from '@angular/core';
import { HeaderWatermark } from '../header-watermark/header-watermark';
import { HeaderScreenKey, headerWatermarks } from '../header-watermark/header-watermarks';

/**
 * The header every screen opens with: a theme-gradient panel, the title block and a top-right action area.
 *
 * DECORATION is two layers, and a screen controls neither directly:
 *   1. BASE LAYER - a ring and a soft radial glow. Identical on every header and every theme colour; it lives in
 *      page-header.css and is not an input.
 *   2. WATERMARK - exactly one oversized outline icon, chosen for the screen in `headerWatermarks`
 *      (../header-watermark/header-watermarks.ts) and looked up here from `screen`.
 * Nothing else decorates a header: no icon clusters, no grids, no scattered shapes.
 *
 * It reads only --theme-* custom properties, so a theme change repaints every mounted header at once.
 *
 *   <app-page-header screen="campaign-register" title="Campaign register" subtitle="..." ownerLabel="Ravi K" updatedLabel="Updated 2 min ago">
 *     <span meta class="ph-chip">Scope: Organisation</span>
 *     <ng-container actions>
 *       <button type="button" class="ph-btn ph-btn--ghost">Filters</button>
 *       <button type="button" class="ph-btn ph-btn--primary">Create</button>
 *     </ng-container>
 *   </app-page-header>
 *
 * `screen` is the screen's key in `headerWatermarks` (its template name). It is required and typed as the union of
 * those keys, so a header without one, or with an unregistered one, does not compile.
 *
 * Projected content is styled by the global .ph-btn / .ph-chip classes (styles/ydot-theme.css) because
 * component-scoped CSS cannot reach into projected nodes.
 */
const screenModules: Record<string, string> = {
  ...Object.fromEntries(['communication-exception-queue', 'complaint-case', 'conversation-detail', 'outbound-message-composer',
    'sla-policy-calendar', 'suppression-and-contact-restriction', 'template-catalogue', 'unified-inbox'].map(k => [k, 'Communications'])),
  'payment-event-queue': 'Donations & payments',
  ...Object.fromEntries(['consent-preference-centre', 'donor-identity-verification', 'donor-list', 'follow-up-execution',
    'follow-up-queue', 'my-leads'].map(k => [k, 'Donors & leads'])),
  ...Object.fromEntries(['finance-exception-case', 'finance-workbench', 'financial-correction-or-reversal', 'maker-checker-review',
    'offline-donation-entry', 'period-campaign-close', 'reconciliation-workspace', 'settlement-batch-detail'].map(k => [k, 'Finance'])),
  ...Object.fromEntries(['batch-ledger', 'inventory-exception-queue', 'inventory-overview', 'reservation-manager',
    'stock-adjustment-approval', 'stock-count-session', 'stock-movement-form', 'warehouse-transfer'].map(k => [k, 'Inventory'])),
  ...Object.fromEntries(['city', 'country', 'currency', 'state', 'time-zone'].map(k => [k, 'Masters'])),
  ...Object.fromEntries(['executive-dashboard', 'global-search', 'work-space', 'notification-centre', 'role-aware-application-shell',
    'saved-view-builder', 'standard-list-page', 'standard-record-detail'].map(k => [k, 'Workspace'])),
};

@Component({
  selector: 'app-page-header',
  templateUrl: './page-header.html',
  styleUrl: './page-header.css',
  imports: [HeaderWatermark],
  // A static title="..." on <app-page-header> would also stay on the host as a DOM attribute and pop a
  // native tooltip over the whole panel; the value is only wanted as the input.
  host: { '[attr.title]': 'null', '[class.ph-host--card]': "variant() !== 'plain'" },
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null | undefined>('');

  /** Owner's name. The component supplies the "Owner:" prefix. */
  readonly ownerLabel = input<string | null | undefined>('');

  /** Full sentence, e.g. "Data updated 2 min ago" or "Last updated 12 Mar 2026". */
  readonly updatedLabel = input<string | null | undefined>('');

  /** Optional tooltip text for the info icon beside the title. */
  readonly info = input<string | null | undefined>('');
  /** Whether the small info (i) mark shows beside the title. On by default; a screen can turn it off. */
  readonly showInfo = input<boolean>(true);

  /** The screen's key in `headerWatermarks`; it selects the header's one watermark icon. */
  readonly screen = input.required<HeaderScreenKey>();

  /**
   * 'plain' (default) sits directly on the page. 'card' is the Campaign readiness checklist header: a white card
   * with an eyebrow line above the title. Opt-in, so no other module's header changes.
   * 'gold' is the card with the gold uppercase eyebrow and serif title (Payment gateways look); used by Access and Organisation.
   */
  readonly variant = input<'plain' | 'card' | 'gold'>('plain');

  /** Small uppercase label above the title. Shown by the 'card' variant only. */
  readonly eyebrow = input<string | null | undefined>('');

  /**
   * The gold kicker over the title. 'card' / 'gold' headers show the `eyebrow` they are given; a plain header
   * shows the given one too, or "<Module> · <title>" built from the screen's module below, so every
   * screen opens with the same two-line masthead (Campaigns keeps its own look and is left out).
   */
  protected readonly kicker = computed(() => {
    const given = (this.eyebrow() ?? '').trim();
    if (given) return given;
    if (this.variant() !== 'plain') return '';
    const module = screenModules[this.screen() as string];
    return module ? `${module} · ${this.title()}` : '';
  });

  protected readonly watermark = computed(() => headerWatermarks[this.screen()]);
}
