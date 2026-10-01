import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, map, Subject, takeUntil } from 'rxjs';
import { LayoutService } from '../../Service/layout-service';
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
  'ri-dashboard-line': 'squares-four',
  'ri-settings-3-line': 'gear-six',
  'ri-home-4-line': 'house-line',
  'ri-heart-line': 'hand-heart',
  'ri-money-dollar-circle-line': 'wallet',
  'ri-bank-card-line': 'credit-card',
  'ri-database-2-line': 'stack',
  'ri-building-4-line': 'buildings',
  'ri-notification-3-line': 'bell-ringing',
  'ri-book-2-line': 'books',
  'ri-briefcase-line': 'briefcase',
  'ri-calendar-line': 'calendar-dots',
  'ri-checkbox-circle-line': 'check-circle',
  'ri-checkbox-line': 'check-square',
  'ri-clipboard-line': 'clipboard-text',
  'ri-time-line': 'clock',
  'ri-edit-line': 'pencil-simple-line',
  'ri-eye-line': 'eye',
  'ri-file-line': 'file',
  'ri-file-text-line': 'file-text',
  'ri-flag-line': 'flag',
  'ri-git-branch-line': 'git-branch',
  'ri-global-line': 'globe-hemisphere-west',
  'ri-inbox-line': 'tray',
  'ri-information-line': 'info',
  'ri-key-2-line': 'key',
  'ri-stack-line': 'stack',
  'ri-layout-line': 'layout',
  'ri-lifebuoy-line': 'lifebuoy',
  'ri-list-check': 'list-checks',
  'ri-lock-line': 'lock-key',
  'ri-map-2-line': 'map-trifold',
  'ri-map-pin-line': 'map-pin',
  'ri-message-3-line': 'chat-circle-dots',
  'ri-box-3-line': 'package',
  'ri-add-circle-line': 'plus-circle',
  'ri-refresh-line': 'arrows-clockwise',
  'ri-search-line': 'magnifying-glass',
  'ri-send-plane-line': 'paper-plane-tilt',
  'ri-share-line': 'share-network',
  'ri-shield-check-line': 'shield-check',
  'ri-shuffle-line': 'shuffle',
  'ri-equalizer-line': 'sliders-horizontal',
  'ri-price-tag-3-line': 'tag',
  'ri-line-chart-line': 'chart-line-up',
  'ri-truck-line': 'truck',
  'ri-user-line': 'user-circle',
  'ri-user-add-line': 'user-plus',
  'ri-group-line': 'users-three',
  'ri-circle-line': 'circle-dashed',
};

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [ThemedLogo, CommonModule, RouterModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class SidebarComponent implements OnDestroy {
  readonly layoutService = inject(LayoutService);
  readonly navigation = inject(NavigationService);
  private readonly tokens = inject(AuthTokenService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);

  private readonly destroy$ = new Subject<void>();

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
  readonly menu = computed(() => this.overrideMenu(this.navigation.menu()));
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
   * Menu icons are drawn with Phosphor duotone (two-tone, rounded) rather than the Remix line set.
   * Resolved through the same neutral-name mapping first, so the stored icon names do not change;
   * anything without a Phosphor counterpart keeps its Remix glyph.
   */
  iconClass(node: MenuNode): string {
    const remix = this.navigation.iconClass(node.icon);
    const phosphor = SidebarComponentIcons[remix];
    return phosphor ? `ph-duotone ph-${phosphor}` : remix;
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
