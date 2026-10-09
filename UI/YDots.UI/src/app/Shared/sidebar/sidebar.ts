import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, map, Subject, takeUntil } from 'rxjs';
import { LayoutService } from '../../Service/layout-service';
import { ThemedLogo } from '../components/themed-logo/themed-logo';
import { MenuNode } from '../models/auth.model';
import { AuthTokenService } from '../services/auth-token.service';
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
  host: { '(mouseover)': 'placeFlyout($event)' },
})
export class SidebarComponent implements OnDestroy {
  readonly layoutService = inject(LayoutService);
  readonly navigation = inject(NavigationService);
  private readonly tokens = inject(AuthTokenService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly destroy$ = new Subject<void>();

  constructor() {
    // The horizontal slider measures real DOM, so it starts once the view exists (browser only).
    afterNextRender(() => this.initHzSlider());
  }

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
   * The server's tree, as it was sent.
   *
   * THE CAMPAIGNS BRANCH IS NO LONGER REWRITTEN HERE. This renamed Campaign Register to "Campaign
   * Overview", dropped Create Campaign and added a Tracking Asset Manager link of its own, so the
   * menu on screen was not the menu IAM held: an Organisation's own label for the register was
   * overwritten, and the tracking link could not be hidden, renamed or mapped to a role. The
   * catalogue now says all three, and this draws what it is given.
   */
  readonly menu = computed(() => this.withWhatsApp([...this.navigation.menu()]));
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

  private static readonly CHECK_NUMBER_ROUTE = '/app/whatsapp/check-number';
  private static readonly WATI_ROUTE = '/app/whatsapp/wati';

  /**
   * Adds CheckNumber and Wati directly below Dashboard.
   *
   * CLIENT-SIDE ENTRIES, and the only two: these screens run on in-browser data and have no
   * server menu node yet, so they are placed here. When the menu catalogue gains them, the
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

  // ---- Horizontal layout: slide the top-level row when it is wider than the bar -----------
  //
  // THE BUG. With many top-level items the horizontal bar ran past the space left for the header's
  // buttons, and the last items slid under the bell and the avatar. The row now slides instead:
  // CSS clips the bar strip to the nav's width (drop-downs stay unclipped) and moves the row by
  // `--hz-shift`; this code decides that shift. Arrows appear only while the row overflows.

  private readonly menuNav = viewChild<ElementRef<HTMLElement>>('menuNav');

  /** How far (px) the row has been slid towards its end. */
  readonly hzShift = signal(0);
  /** The furthest it can slide; 0 means everything fits. */
  readonly hzMax = signal(0);

  readonly hzOverflowing = computed(() => this.hzMax() > 0);
  readonly hzCanPrev = computed(() => this.hzShift() > 0);
  readonly hzCanNext = computed(() => this.hzShift() < this.hzMax());

  private initHzSlider(): void {
    const nav = this.menuNav()?.nativeElement;
    const list = nav?.querySelector<HTMLElement>('.pe-main-menu');
    if (!nav || !list) return;

    // Re-measure when the bar resizes, the menu grows (items arrive from the API),
    // or the layout / direction is switched in Theme Settings.
    const ro = new ResizeObserver(() => this.measureHz());
    ro.observe(nav);
    ro.observe(list);

    const mo = new MutationObserver(() => this.measureHz());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout', 'dir'] });

    // After each navigation, bring the active top-level item into view.
    const sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => requestAnimationFrame(() => this.revealActiveHz()));

    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      mo.disconnect();
      sub.unsubscribe();
    });

    this.measureHz();
    requestAnimationFrame(() => this.revealActiveHz());
  }

  private isHorizontalDesktop(): boolean {
    return document.documentElement.getAttribute('data-layout') === 'horizontal'
      && window.matchMedia('(min-width: 992px)').matches;
  }

  private measureHz(): void {
    const nav = this.menuNav()?.nativeElement;
    const list = nav?.querySelector<HTMLElement>('.pe-main-menu');

    if (!nav || !list || !this.isHorizontalDesktop()) {
      this.hzMax.set(0);
      this.hzShift.set(0);
      return;
    }

    const overflow = Math.ceil(list.scrollWidth - nav.clientWidth);
    const max = overflow > 2 ? overflow : 0; // ignore sub-pixel rounding
    this.hzMax.set(max);
    this.hzShift.update((s) => Math.min(s, max));
  }

  private setHzShift(value: number): void {
    this.hzShift.set(Math.round(Math.min(this.hzMax(), Math.max(0, value))));
  }

  /** Arrow buttons: slide by most of a bar's width, so one item stays in view for context. */
  slideHz(direction: 1 | -1): void {
    const nav = this.menuNav()?.nativeElement;
    if (!nav) return;
    this.setHzShift(this.hzShift() + direction * nav.clientWidth * 0.7);
  }

  /** Mouse wheel / trackpad over the bar slides it sideways. */
  onHzWheel(event: WheelEvent): void {
    if (!this.hzOverflowing()) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    this.setHzShift(this.hzShift() + delta);
  }

  /** Tabbing onto a hidden item slides it into view. */
  onHzFocus(event: FocusEvent): void {
    if (!this.hzOverflowing()) return;
    const li = (event.target as HTMLElement | null)?.closest<HTMLElement>('.pe-main-menu > li');
    if (li) this.revealHzItem(li);
  }

  private revealActiveHz(): void {
    this.measureHz();
    if (!this.hzOverflowing()) return;
    const nav = this.menuNav()?.nativeElement;
    const li = nav?.querySelector<HTMLElement>('.pe-main-menu > .pe-slide.active');
    if (li) this.revealHzItem(li);
  }

  private revealHzItem(li: HTMLElement): void {
    const nav = this.menuNav()?.nativeElement;
    if (!nav || document.documentElement.getAttribute('dir') === 'rtl') return;

    const pad = 24;
    const left = li.offsetLeft;
    const right = left + li.offsetWidth;
    const shift = this.hzShift();
    const width = nav.clientWidth;

    if (left < shift) {
      this.setHzShift(left - pad);
    } else if (right > shift + width) {
      this.setHzShift(right - width + pad);
    }
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