import { DOCUMENT, Injectable, NgZone, inject } from '@angular/core';

/** Screens that keep their own look (the sign-in pages, plus a couple of unused duplicate Organisation
 *  folders). `app-organisation-detail` (Organisation profile / settings) used to be here too - by
 *  request it now follows the same design system as every other screen. */
const EXCLUDED_HOSTS = [
  'app-organisation-details', 'app-organisation-directory',
  'app-organisation-owner-view', 'app-organisation-setup-wizard', 'app-organisations-create',
  'app-owner-login-entry', 'app-registration-verification', 'app-super-admin-view',
  'app-verification-approval', 'app-login', 'app-forgotpassword', 'app-reset-password',
  'app-emailverify', 'app-register', 'app-mfa-challenge', 'app-reauthenticate', 'app-tostep-verify',
  'app-select-organisation', 'app-account-unavailable', 'app-donorform', 'app-theme',
];

/** KPI / stat / summary tiles: they get the strongest wash. */
const STAT_CLASSES = [
  '.stat-card', '.summary-card', '.kpi-card', '.ct-kpi-card', '.inv-stat-card', '.audit-stat-card',
  '.div-kpi-card', '.rwn-summary-card', '.crc-summary-card', '.lq-kpi-card', '.ab-kpi', '.dl-kpi',
  '.sh-stat', '.sec-stat', '.tam-metric', '.pr-tile', '.summary-tile', '.totals-stat', '.detail-metric',
  '.pci-total-card', '.msec-gauge-stat', '.lc-bulk-stat', '.details-summary-card', '.summary-item',
  '.fk-kpi', '.fk-overview-tile',
];

/** Content cards: they get a quieter version of the same design. */
const SURFACE_CLASSES = [
  '.card', '.detail-card', '.fq-card', '.sh-card', '.sec-card', '.ct-card', '.msec-card', '.svb-card',
  '.fup-card', '.qa-card', '.tl-card', '.side-card', '.cpc-card', '.lc-card', '.mc-card', '.ode-card',
  '.pci-card', '.ds-card', '.gs-card', '.details-card', '.form-card', '.filter-card', '.filters-card',
  '.record-card', '.snapshot-card', '.msec-panel', '.ct-panel', '.div-panel', '.pdi-panel',
  '.side-panel', '.review-panel', '.msec-section-card', '.svb-summary-block', '.sidebar-card',
  '.status-card', '.permissions-card', '.msec-info-card', '.msec-action-card', '.msec-mfa-card',
  '.rc-grid-card', '.dir-table-card', '.ae-filters-card', '.rc-compare-card', '.tam-filters-card',
  '.fk-panel', '.fk-rail-card',
];

const TONES = 6;
const NOT_INSIDE = [...EXCLUDED_HOSTS, '.dropdown-menu', '.modal', '.tc-panel'].join(', ');
const STAT_SELECTOR = STAT_CLASSES.join(', ');
const ALL_SELECTOR = [...STAT_CLASSES, ...SURFACE_CLASSES].join(', ');

/**
 * Marks every card on the page with `data-tone` (1..6) and `data-tone-kind` (stat | surface).
 *
 * CSS alone cannot find "every card": Bootstrap wraps cards in `.col`, so every card is the first child of its
 * own column and `:nth-child` sees them all as number one. This service walks the cards in document order and
 * writes the attributes; styles/ydot-premium.css (section 4b) uses them as the one reliable "this is a card"
 * hook. Since the flat-gold pass every card is flat, with no gradient (content cards white, stat tiles a pale gold
 * wash), so the tone NUMBER no longer selects a colour or a pattern; it is kept because screens
 * and the premium layer key off the attribute's presence.
 *
 * Only child-list changes are observed (writing the attribute does not re-trigger it), and the pass is
 * throttled to one per animation frame after a short settle.
 */
@Injectable({ providedIn: 'root' })
export class CardToneService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const body = this.document.body;
    if (!body || typeof MutationObserver === 'undefined') return;

    this.zone.runOutsideAngular(() => {
      new MutationObserver(() => this.schedule()).observe(body, { childList: true, subtree: true });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.document.defaultView?.requestAnimationFrame(() => this.apply());
    }, 60);
  }

  private apply(): void {
    // A document-order pass over every card outside the excluded screens and overlays.
    const nodes = this.document.querySelectorAll<HTMLElement>(ALL_SELECTOR);
    let index = 0;
    nodes.forEach(node => {
      if (node.closest(NOT_INSIDE) || node.matches(EXCLUDED_HOSTS.join(','))) return;
      const tone = String((index % TONES) + 1);
      index += 1;
      if (node.dataset['tone'] !== tone) node.dataset['tone'] = tone;
      const kind = node.matches(STAT_SELECTOR) ? 'stat' : 'surface';
      if (node.dataset['toneKind'] !== kind) node.dataset['toneKind'] = kind;
    });
  }
}
