import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** The screens whose pop-ups and drawers take the shared dialog design (styles/ydot-dialogs.css). */
const DIALOG_HOSTS = [
  'app-access-preview',
  'app-access-request',
  'app-bulk-user-administration',
  'app-create-user',
  'app-login-identifier-change',
  'app-menu-configuration',
  'app-menu-mapping',
  'app-mfa-enrollment',
  'app-my-security',
  'app-role-catalogue',
  'app-user-details',
  'app-user-directory',
  'app-user-profile',
  'app-user-security',
  'app-communication-exception-queue',
  'app-complaint-case',
  'app-conversation-detail',
  'app-outbound-message-composer',
  'app-sla-policy-calendar',
  'app-suppression-and-contact-restriction',
  'app-template-catalogue',
  'app-unified-inbox',
  'app-payment-gateway-configuration',
  'app-payment-event-queue',
  'app-payment-result',
  'app-public-donation-initiation',
  'app-assignment-board',
  'app-communication-timeline',
  'app-consent-preference-centre',
  'app-donor-360',
  'app-donor-identity-verification',
  'app-donor-list',
  'app-duplicate-review',
  'app-follow-up-execution',
  'app-follow-up-planner',
  'app-follow-up-queue',
  'app-lead-capture',
  'app-lead-capture-confirm',
  'app-lead-work-queue',
  'app-my-leads',
  'app-finance-exception-case',
  'app-finance-workbench',
  'app-financial-correction-or-reversal',
  'app-maker-checker-review',
  'app-offline-donation-entry',
  'app-period-campaign-close',
  'app-reconciliation-workspace',
  'app-settlement-batch-detail',
  'app-batch-ledger',
  'app-inventory-exception-queue',
  'app-inventory-overview',
  'app-reservation-manager',
  'app-stock-adjustment-approval',
  'app-stock-count-session',
  'app-stock-movement-form',
  'app-warehouse-transfer',
  'app-city',
  'app-country',
  'app-currency',
  'app-state',
  'app-time-zone',
  'app-business-unit',
  'app-menu-catalogue',
  'app-permission-catalogue',
  'app-organisation-owner-view',
  'app-verification-approval',
  'app-organisation-detail',
  'app-organisation-details',
  'app-department-form',
  'app-executive-dashboard',
  'app-global-search',
  'app-work-space',
  'app-notification-centre',
  'app-role-aware-application-shell',
  'app-saved-view-builder',
  'app-standard-list-page',
  'app-standard-record-detail',
];

/**
 * STAMPS `data-dg-host` ON THE SCREENS THE SHARED DIALOG DESIGN APPLIES TO.
 *
 * ydot-dialogs.css used to scope every rule with `:is(app-access-preview, app-access-request, ... )`
 * - eighty tag names. A browser has to test each ancestor of an element against that whole list, and
 * with a hundred and fifty such rules that was about 130 ms of style recalculation on every page
 * navigation, which is the lag people felt moving between menu items. One attribute is a single
 * lookup, so the rules now say `[data-dg-host]`, and this service puts the attribute on exactly the
 * same tags as they appear. The observer callback runs before the next paint, so nothing flashes
 * unstyled.
 */
@Injectable({ providedIn: 'root' })
export class DialogHostMarkerService {
  private readonly doc = inject(DOCUMENT);
  private installed = false;

  install(): void {
    if (this.installed || typeof MutationObserver === 'undefined') return;
    this.installed = true;

    const hosts = new Set(DIALOG_HOSTS);
    const selector = DIALOG_HOSTS.join(',');
    const mark = (root: ParentNode): void => {
      if (root instanceof Element && hosts.has(root.localName)) root.setAttribute('data-dg-host', '');
      root.querySelectorAll(selector).forEach((el) => el.setAttribute('data-dg-host', ''));
    };

    mark(this.doc);
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) mark(node);
        });
      }
    }).observe(this.doc.documentElement, { childList: true, subtree: true });
  }
}
