import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, map, Subject, takeUntil } from 'rxjs';
import { LayoutService } from '../../Service/layout-service';
import { SIDEBAR_ICON_CLASS } from './sidebar-icon-classes';
import { ThemedLogo } from '../components/themed-logo/themed-logo';
import { MenuNode } from '../models/auth.model';
import { AuthTokenService } from '../services/auth-token.service';
import { CurrentUserService } from '../services/current-user.service';
import { NavigationService } from '../services/navigation.service';

/**
 * The sidebar.
 *
 * EVERY ITEM COMES FROM THE SERVER. This used to be a twelve-hundred-line hand-written tree, and
 * the trouble with that is not its length — it is that a hand-written menu shows every link to
 * everybody. What a person may see depends on what the product has, what their Organisation has
 * enabled, what their role was given and what permissions they hold, and only the server knows
 * all four. See `NavigationService` for the rest of that reasoning.
 *
 * THREE LEVELS, RENDERED AS THREE LEVELS. Menu, submenu and child submenu each have their own
 * markup in the theme, so the template handles them explicitly rather than recursing — which
 * also means a fourth level, if one ever appeared, would be visibly missing rather than silently
 * flattened.
 *
 * IT NO LONGER FETCHES ANYTHING ON MOUNT. It used to load the tree when it found the menu empty,
 * which is a rule that reads sensibly and is wrong in the one case that matters: after an
 * Organisation switch the menu is not empty, it is FULL — of the previous Organisation's items —
 * so the condition was false and the stale tree stayed. Loading is `NavigationService`'s job now,
 * keyed to the Organisation rather than to emptiness. This component renders what it is given.
 */
const SidebarComponentIcons: Record<string, string> = {
  'ri-dashboard-line': 'grid',
  'ri-settings-3-line': 'settings',
  'ri-home-4-line': 'home',
  'ri-heart-line': 'heart',
  'ri-money-dollar-circle-line': 'dollar-sign',
  'ri-bank-card-line': 'credit-card',
  'ri-database-2-line': 'database',
  'ri-building-4-line': 'building',
  'ri-notification-3-line': 'bell',
  'ri-book-2-line': 'book',
  'ri-briefcase-line': 'briefcase',
  'ri-calendar-line': 'calendar',
  'ri-checkbox-circle-line': 'check-circle',
  'ri-checkbox-line': 'check-square',
  'ri-clipboard-line': 'clipboard',
  'ri-time-line': 'clock',
  'ri-edit-line': 'edit',
  'ri-eye-line': 'eye',
  'ri-file-line': 'file',
  'ri-file-text-line': 'file-text',
  'ri-flag-line': 'flag',
  'ri-git-branch-line': 'git-branch',
  'ri-global-line': 'globe',
  'ri-inbox-line': 'inbox',
  'ri-information-line': 'info',
  'ri-key-2-line': 'key',
  'ri-stack-line': 'layers',
  'ri-layout-line': 'layout',
  'ri-lifebuoy-line': 'life-buoy',
  'ri-list-check': 'list',
  'ri-lock-line': 'lock',
  'ri-map-2-line': 'map',
  'ri-map-pin-line': 'map-pin',
  'ri-message-3-line': 'message-circle',
  'ri-box-3-line': 'package',
  'ri-add-circle-line': 'plus-circle',
  'ri-refresh-line': 'refresh-cw',
  'ri-search-line': 'search',
  'ri-send-plane-line': 'send',
  'ri-share-line': 'share-2',
  'ri-shield-check-line': 'shield',
  'ri-shuffle-line': 'shuffle',
  'ri-equalizer-line': 'sliders',
  'ri-price-tag-3-line': 'tag',
  'ri-line-chart-line': 'trending-up',
  'ri-truck-line': 'truck',
  'ri-user-line': 'user',
  'ri-user-add-line': 'user-plus',
  'ri-group-line': 'users',
  'ri-circle-line': 'dot',
};

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [ThemedLogo, CommonModule, RouterModule],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.css', './sidebar-icons.css'],
  host: { '(mouseover)': 'placeFlyout($event)' },
})
export class SidebarComponent implements OnDestroy {
  readonly layoutService = inject(LayoutService);
  readonly navigation = inject(NavigationService);
  private readonly tokens = inject(AuthTokenService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);

  private readonly destroy$ = new Subject<void>();

  /**
   * Folded rail: a group's flyout is placed beside its own icon. It drops down from the icon when it fits
   * below, otherwise it rises so its foot is level with the icon; a panel taller than the window is capped
   * and scrolls. The position is computed from the icon's place on screen and written as `top` relative to
   * the panel's real containing block (it is not the list item), so it cannot drift to the rail's foot.
   * Done on hover, when the panel is displayed and measurable.
   */
  placeFlyout(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const item = target?.closest?.('.pe-main-menu > .pe-slide.pe-has-sub') as HTMLElement | null;
    const panel = item?.querySelector(':scope > .pe-slide-menu') as HTMLElement | null;
    const link = item?.querySelector(':scope > .pe-nav-link') as HTMLElement | null;
    if (!item || !panel || !link || document.documentElement.getAttribute('data-sidebar') !== 'icon') return;
    const margin = 8;
    const pad = 11; // the panel's own padding + border, so its first/last row lines up with the icon
    panel.style.maxHeight = '';
    item.classList.remove('sb-fly-scroll');
    const height = panel.offsetHeight;
    const row = link.getBoundingClientRect();
    const win = window.innerHeight;
    let top: number;
    if (height > win - margin * 2) {
      panel.style.maxHeight = `${win - margin * 2}px`;
      item.classList.add('sb-fly-scroll');
      top = margin;
    } else if (row.top - pad + height <= win - margin) {
      top = row.top - pad;
    } else {
      top = Math.max(margin, row.bottom + pad - height);
    }
    const parent = (panel.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    panel.style.setProperty('top', `${top - (parent?.top ?? 0)}px`, 'important');
    panel.style.setProperty('bottom', 'auto', 'important');
    panel.style.setProperty('margin-top', '0', 'important');
  }

  /**
   * The server tree, with three presentation-only overrides applied on top.
   *
   * THESE ARE LABEL/LAYOUT CHANGES, NOT PERMISSION CHANGES. The menu is still exactly what the
   * server decided this person may see (see the class doc); this only renames one node's label,
   * drops another, and mirrors Campaign Overview's entry under a new label so Tracking Asset
   * Manager has a way in from the sidebar. None of the three touches `requiredPermissionCode`,
   * `route`, or anything the server sent for access control — a node that would not have
   * appeared still will not, and a node that appears is still gated exactly as the server gated
   * it. See `overrideMenu` for the mechanics.
   */
  readonly menu = computed(() => this.withWhatsApp(this.overrideMenu(this.navigation.menu())));
  readonly loading = computed(() => this.navigation.loading());
  readonly failed = computed(() => this.navigation.failed());

  /**
   * The route the person is on right now, kept current as a signal.
   *
   * WHY THE SIDEBAR READS THE URL ITSELF. `routerLinkActive` marks only the one link it is
   * declared on, which is enough for the row that opens the page but says nothing to the rows that
   * page sits *under*. The menu showed exactly that: "User Directory" turned green while the two
   * groups leading to it — "Access and Identity" and "Administration" — stayed their resting
   * colour, so an open page left no visible trail back up the tree. The ancestors need the same
   * answer the leaf gets, and deriving it once here is simpler than asking each level separately.
   *
   * `toSignal` tears its subscription down with the component, so no manual unsubscribe is needed
   * even though the sidebar is recreated on sign-out.
   */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Absolute route of the campaign wizard's "Create Campaign" link, dropped from the sidebar. */
  private static readonly CREATE_CAMPAIGN_ROUTE_RE = /\/campaign-wizard$/;
  /** Absolute route of the campaign list — relabelled "Campaign Overview" here. */
  private static readonly CAMPAIGN_REGISTER_ROUTE_RE = /\/campaign-register$/;
  /** Where the injected Tracking Asset Manager link points. */
  private static readonly TRACKING_ASSET_ROUTE = '/app/fundraising/campaigns/tracking-asset-manager';
  private static readonly CHECK_NUMBER_ROUTE = '/app/whatsapp/check-number';
  private static readonly WATI_ROUTE = '/app/whatsapp/wati';

  private isCreateCampaignNode(node: MenuNode): boolean {
    return !!node.route && SidebarComponent.CREATE_CAMPAIGN_ROUTE_RE.test(node.route);
  }

  private isCampaignRegisterNode(node: MenuNode): boolean {
    return !!node.route && SidebarComponent.CAMPAIGN_REGISTER_ROUTE_RE.test(node.route);
  }

  /**
   * Drops "Create Campaign", relabels "Campaign Register" to "Campaign Overview", and adds a
   * "Tracking Asset Manager" link right beside it — recursively, so it applies at whichever
   * depth the server nested the campaigns group.
   */
  private overrideMenu(nodes: readonly MenuNode[]): MenuNode[] {
    return nodes.filter((n) => !this.isCreateCampaignNode(n)).map((n) => this.overrideNode(n));
  }

  private overrideNode(node: MenuNode): MenuNode {
    if (!node.children || node.children.length === 0) {
      return this.isCampaignRegisterNode(node) ? { ...node, name: 'Campaign Overview' } : node;
    }

    let children = this.overrideMenu(node.children);

    const registerIndex = children.findIndex((c) => this.isCampaignRegisterNode(c));
    const alreadyHasTrackingLink = children.some(
      (c) => c.route === SidebarComponent.TRACKING_ASSET_ROUTE,
    );
    // Gated the same way the campaign-detail page gates its own link to this screen: a person
    // without `cam.tracking-assets.view` would only reach a route guard that turns them away.
    const canSeeTrackingAssets = this.currentUser.hasPermission('cam.tracking-assets.view');
    if (registerIndex !== -1 && !alreadyHasTrackingLink && canSeeTrackingAssets) {
      const register = children[registerIndex];
      const trackingNode: MenuNode = {
        ...register,
        id: 'client-tracking-asset-manager',
        code: 'client-tracking-asset-manager',
        name: 'Tracking Asset Manager',
        route: SidebarComponent.TRACKING_ASSET_ROUTE,
        icon: 'clipboard',
        children: null,
        isGroupOnly: false,
        hasChildren: false,
      };
      children = [
        ...children.slice(0, registerIndex + 1),
        trackingNode,
        ...children.slice(registerIndex + 1),
      ];
    }

    return { ...node, children };
  }

  /**
   * Adds CheckNumber and Wati directly below Dashboard.
   *
   * CLIENT-SIDE ENTRIES, like the Tracking Asset Manager link above: these two screens run on in-browser data
   * and have no server menu node yet, so they are placed here. When the menu catalogue gains them, the
   * `already` check below stops this from adding a second copy.
   */
  private withWhatsApp(nodes: MenuNode[]): MenuNode[] {
    if (nodes.length === 0 || nodes.some((n) => n.route === SidebarComponent.CHECK_NUMBER_ROUTE)) {
      return nodes;
    }
    const entry = (code: string, name: string, route: string, icon: string): MenuNode => ({
      id: code, code, name, route, icon, children: null, isGroupOnly: false, hasChildren: false, opensInNewTab: false,
    });
    const added = [
      entry('client-check-number', 'CheckNumber', SidebarComponent.CHECK_NUMBER_ROUTE, 'ri-shield-check-line'),
      entry('client-wati', 'Wati', SidebarComponent.WATI_ROUTE, 'ri-message-3-line'),
    ];
    const dashboard = nodes.findIndex((n) => !!n.route && /\/dashboard\/?$/.test(n.route));
    const at = dashboard === -1 ? 0 : dashboard + 1;
    return [...nodes.slice(0, at), ...added, ...nodes.slice(at)];
  }

  /** Shown in the sidebar footer so a root user always knows whose data they are looking at. */
  readonly organisationName = computed(() => this.tokens.organisationName());
  readonly isActingInOrganisation = computed(() => this.tokens.isActingInOrganisation());

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  retry(): void {
    this.navigation.load().pipe(takeUntil(this.destroy$)).subscribe({ error: () => undefined });
  }

  /**
   * Menu icons are a custom hairline set (see `sidebar-icons.css`, generated by tools/gen_sidebar_icons.js).
   * Resolved through the same neutral-name mapping first, so the stored icon names do not change;
   * anything without a counterpart gets the quiet ring-and-dot.
   */
  iconClass(node: MenuNode): string {
    const remix = this.navigation.iconClass(node.icon);
    return this.glyph(SidebarComponentIcons[remix] ?? 'dot');
  }

  /** The class pair for a hairline glyph, by its neutral name. */
  glyph(name: string): string {
    return `sbm ${SIDEBAR_ICON_CLASS[name] ?? SIDEBAR_ICON_CLASS['dot']}`;
  }

  collapseId(node: MenuNode): string {
    return this.navigation.collapseId(node);
  }

  /**
   * Whether a node opens a page or only opens a group.
   *
   * A group with no route is a heading; giving it a link would navigate somewhere that does not
   * exist. The server marks these explicitly rather than leaving it to be inferred from a
   * missing route, so the two cannot disagree.
   */
  isGroup(node: MenuNode): boolean {
    return node.isGroupOnly === true || (node.hasChildren === true && !node.route);
  }

  children(node: MenuNode): MenuNode[] {
    return node.children ?? [];
  }

  /**
   * Whether this node — or anything beneath it — is the page currently open.
   *
   * THE WHOLE LADDER ANSWERS TRUE, and that is the point: for an open "User Directory" the page
   * itself, the group holding it ("Access and Identity") and the top-level group above that
   * ("Administration") all report active, so the menu shows the trail rather than only its last
   * step. A group with no route of its own still lights up because one of its children matches.
   */
  isNodeActive(node: MenuNode): boolean {
    return this.nodeMatchesOpenPage(node) || this.children(node).some((child) => this.isNodeActive(child));
  }

  /**
   * A node sits on the open page when its route IS the current path or is a PREFIX of it, so a
   * detail screen such as `/user-directory/{id}/edit` keeps its list item lit.
   *
   * The separator is required on the prefix test, or `/user-directory` would also claim a sibling
   * `/user-directory-archive`. Route comparison ignores the query string, fragment and any
   * trailing slash: the menu stores a bare path, while the router reports `?created=…` and the
   * like after a redirect, and the two must still agree.
   */
  private nodeMatchesOpenPage(node: MenuNode): boolean {
    const route = SidebarComponent.routePath(node.route);
    if (!route) {
      return false;
    }
    const current = SidebarComponent.routePath(this.currentUrl());
    return current === route || current.startsWith(route + '/');
  }

  /** A route stripped of its query string, fragment and trailing slash, for the test above. */
  private static routePath(url: string | null | undefined): string {
    const path = (url ?? '').split(/[?#]/)[0];
    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  }

  trackByCode(_index: number, node: MenuNode): string {
    return node.code ?? node.id ?? String(_index);
  }

  // ---- Theme panel, unchanged ------------------------------------------------------------

  get themePanelOpen(): boolean {
    return this.layoutService.themePanelOpen;
  }

  get themeMenuOpen(): boolean {
    return this.layoutService.themeMenuOpen;
  }

  toggleThemePanel(): void {
    this.layoutService.toggleThemePanel();
  }

  /** Toggles only the Theme Settings dropdown, without opening the panel. */
  toggleThemeMenu(): void {
    this.layoutService.toggleThemeMenu();
  }

  /** Opens the theme panel with a specific section active. */
  openThemeSection(section: string): void {
    this.layoutService.openThemeSection(section);
  }
}
