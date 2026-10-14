import { Component, ElementRef, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { MenuNode } from '../../models/iam-contract.model';
import { NavigationService } from '../../services/navigation.service';

export interface Crumb { label: string; link?: string; }

const HOME = '/app/dashboard';

/**
 * Detail screens that live OUTSIDE the menu but belong UNDER a menu page.
 *
 * A cold deep link / refresh-ku journey history irukkadhu — appodhaan indha map use aagum:
 * profile-ku menu entry kedayadhu, so opening one directly must still attach it to its parent
 * directory (User Directory). Menu-la irundhu navigate panna journey dhaan trail, so indha map
 * fallback-ku mattum.
 */
const PARENT_ROUTE_OF: Record<string, string> = {
  '/app/administration/access/user-profile-and-access': '/app/administration/access/user-directory',
  '/app/administration/access/user-details': '/app/administration/access/user-directory',
  '/app/administration/users/bulk-actions': '/app/administration/access/user-directory',
  '/app/administration/access/create-user': '/app/administration/access/user-directory',
  // Withdrawn from the sidebar; reached from a person's profile and from Organisation Settings.
  '/app/administration/access/access-preview': '/app/administration/access/user-directory',
  '/app/configuration/payment/gateways': '/app/administration/organisation/settings',
  '/app/administration/users/security': '/app/administration/access/user-directory',
  '/app/administration/users/login-identifier-change': '/app/administration/access/user-directory',
  // Campaign detail: "All Campaigns" register page-ku keezha varanum —
  // kicker first span "Campaign" mattum dhaan, so menu path dhaan full trail tharum.
  // Tracking Asset Manager is NOT here: it is a menu row of its own beside All Campaigns, so its
  // trail is its own menu path (Home / Campaigns / Tracking Asset Manager), as the sidebar shows it.
  '/app/fundraising/campaigns/campaign-detail': '/app/fundraising/campaigns/campaign-register',
  '/app/fundraising/campaigns/campaign-wizard': '/app/fundraising/campaigns/campaign-register',
  '/app/fundraising/campaigns/campaign-readiness-checklist': '/app/fundraising/campaigns/campaign-register',
  '/app/fundraising/campaigns/pause-resume-and-close-campaign': '/app/fundraising/campaigns/campaign-register',
};

/**
 * Donors & Leads screens whose parent is the menu GROUP "Donors & Leads" (code FR_RELATIONSHIPS).
 *
 * That group is route-less (route: null — a nesting row the sidebar only draws), so PARENT_ROUTE_OF
 * can never reach it: no route ever matches. The parent is named by menu node CODE instead. Every
 * relationship screen is listed — menu rows and detail pages alike — so a detail page still resolves
 * under its group. The group itself NEVER shows in the trail (only menu PAGES do), so the trail reads
 * "Home / <screen>", with or without a row of its own in the menu.
 */
const PARENT_NODE_CODE_OF: Record<string, string> = {
  '/app/fundraising/relationships/lead-work-queue': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/lead-capture': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/my-leads': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/communication-timeline': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/follow-up-queue': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/follow-up-planner': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/follow-up-execution': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/donor-list': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/my-donor-list': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/donor-360': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/donor-360/edit': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/consent-and-preference-centre': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/assignment-board': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/donor-identity-verification': 'FR_RELATIONSHIPS',
  '/app/fundraising/relationships/identity-verification': 'FR_RELATIONSHIPS',
  '/app/don/donor-identity-verification': 'FR_RELATIONSHIPS',
  '/app/don/follow-up-planner': 'FR_RELATIONSHIPS',
};

/**
 * Route-less GROUP segments, dropped by the menu-less fallback (fromUrl).
 * The whole module sits on the "relationships" route segment — the fallback must neither spell it
 * "Relationships" nor show any group name. Journey trail-la group eppovum varaadhu.
 */
const GROUP_SEGMENT_PREFIXES: string[] = [
  '/app/fundraising/relationships',
  '/app/don',
];

/**
 * Detail screens whose breadcrumb ends at the screen label — the person's name/id is never appended.
 * e.g. "... / User Profile And Access" — NOT "... / User Profile And Access / Ramesh Chandran".
 */
const NO_NAME_TAIL_PREFIXES = [
  '/app/administration/access/user-profile-and-access',
  '/app/administration/access/user-details',
];

/** Static screen label used when a detail screen falls back to its parent's menu trail. */
const SCREEN_LABEL_OF: Record<string, string> = {
  '/app/administration/access/user-profile-and-access': 'User Profile And Access',
  '/app/administration/access/user-details': 'User Details',
  '/app/administration/users/bulk-actions': 'Bulk Actions',
  '/app/administration/access/create-user': 'Create User',
  '/app/administration/access/access-preview': 'Access Preview',
  '/app/configuration/payment/gateways': 'Payment Gateways',
  '/app/administration/users/security': 'User Security',
  '/app/administration/users/login-identifier-change': 'Login Identifier Change',
  '/app/fundraising/campaigns/campaign-detail': 'Campaign',
  '/app/fundraising/campaigns/campaign-wizard': 'Campaign Wizard',
  '/app/fundraising/campaigns/tracking-asset-manager': 'Tracking Asset Manager',
  '/app/fundraising/campaigns/campaign-readiness-checklist': 'Campaign Readiness Checklist',
  '/app/fundraising/campaigns/pause-resume-and-close-campaign': 'Pause Resume And Close Campaign',
  // Donors and Leads: every relationship screen ends its trail at the SCREEN name — the person's
  // name (the Donor 360 / Communication Timeline h1) never becomes the tail.
  '/app/fundraising/relationships/lead-work-queue': 'Lead Work Queue',
  '/app/fundraising/relationships/lead-capture': 'Lead Capture',
  '/app/fundraising/relationships/my-leads': 'My Leads',
  '/app/fundraising/relationships/communication-timeline': 'Communication Timeline',
  '/app/fundraising/relationships/follow-up-queue': 'Follow-ups',
  '/app/fundraising/relationships/follow-up-planner': 'Follow-up Planner',
  '/app/fundraising/relationships/follow-up-execution': 'Follow-up Execution',
  '/app/fundraising/relationships/donor-list': 'All Donors',
  '/app/fundraising/relationships/my-donor-list': 'My Donors',
  '/app/fundraising/relationships/donor-360': 'Donor 360',
  '/app/fundraising/relationships/donor-360/edit': 'Donor 360 Edit',
  '/app/fundraising/relationships/consent-and-preference-centre': 'Consent And Preference Centre',
  '/app/fundraising/relationships/assignment-board': 'Assignment Board',
  '/app/fundraising/relationships/donor-identity-verification': 'Donor Identity Verification',
  '/app/fundraising/relationships/identity-verification': 'Identity Verification',
  '/app/don/donor-identity-verification': 'Donor Identity Verification',
  '/app/don/follow-up-planner': 'Follow-up Planner',
};

/**
 * The one breadcrumb every screen shows, in the same place: directly under the top bar, above the routed page.
 *
 * Screens used to carry their own gold uppercase "kicker" inside their header ("Access & identity · Users").
 * This bar reads that kicker, shows it here as `Access & identity / Users`, and hides the in-header copy
 * (`[data-crumb-src]`, see styles.css), so no screen has to be edited and none can drift out of place.
 * A screen with no kicker gets a trail built from its URL.
 */
const KICKER_SELECTORS = [
  '.ph__eyebrow', '.ydot-kicker:not(.cu-head-kicker)', '.pg-kicker', '.cr-kicker', '.tam-deck-kicker', '.mc-kicker',
  '.pc-kicker', '.dpe-kicker', '.fp-kicker', '.lcp-kicker', '.mf-kicker', '.cd-fol-kicker', '.crc-docket-kicker',
  '.prc-eyebrow', '.cn-eyebrow', '.pf-kicker', '.od-eyebrow',
].join(',');

/** Kickers that also carry a reference / status / loading note after the label; only the first span is the label. */
const LABEL_ONLY_FIRST_SPAN = '.cd-fol-kicker, .lcp-kicker';

/** Anything inside these is a pop-up / drawer, never a screen masthead. */
const OVERLAY = '[role="dialog"], [aria-modal="true"], app-popup, .modal, .offcanvas, .cdk-overlay-container';

@Component({
  selector: 'app-breadcrumb-bar',
  templateUrl: './breadcrumb-bar.html',
  styleUrl: './breadcrumb-bar.css',
  imports: [RouterLink],
})
export class BreadcrumbBarComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly navigation = inject(NavigationService);

  protected readonly crumbs = signal<Crumb[]>([]);

  constructor() {
    // The trail follows the menu: remap a screen under another parent and its breadcrumb moves with it.
    effect(() => { this.navigation.menu(); this.schedule(); });
  }

  private observer?: MutationObserver;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private marked: Element | null = null;

  /** Vandha vazhi: last screens (url + adhoda screen label), oldest first, capped. */
  private readonly journey: { url: string; label: string }[] = [];

  ngOnInit(): void {
    const area = this.host.nativeElement.parentElement;
    if (area) {
      this.observer = new MutationObserver(records => {
        // The bar's own updates must not re-trigger a scan.
        if (records.every(r => this.host.nativeElement.contains(r.target))) return;
        this.schedule();
      });
      this.observer.observe(area, { childList: true, subtree: true, characterData: true });
    }
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.schedule());
    this.schedule();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    clearTimeout(this.timer);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.scan(), 30);
  }

  private scan(): void {
    const area = this.host.nativeElement.parentElement;
    if (!area) return;
    const source = Array.from(area.querySelectorAll(KICKER_SELECTORS))
      .find(el => !this.host.nativeElement.contains(el) && !el.closest(OVERLAY) && this.labelOf(el).length > 0) ?? null;

    if (this.marked !== source) {
      this.marked?.removeAttribute('data-crumb-src');
      source?.setAttribute('data-crumb-src', '');
      this.marked = source;
    }
    const page = source ? this.labelOf(source) : this.fromUrl();
    // The screen's own title: the kicker's last step, or the page heading when the kicker names only the module.
    // Kicker-e illadha screen (profile madhiri) h1-la irundhey edukkanum — illana tail missing aayidum.
    let own = page[page.length - 1] ?? '';
    const h1 = Array.from(area.querySelectorAll('h1')).find(h => !this.host.nativeElement.contains(h) && !h.closest(OVERLAY));
    const h1Title = (h1?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (source && page.length === 1) {
      if (h1Title && h1Title.length <= 60 && h1Title.toLowerCase() !== own.toLowerCase()) own = h1Title;
    } else if (!source) {
      // Kicker kedayadhu: URL parts-la last part id/GUID-ah irundha, h1 dhaan screen name.
      if (h1Title && h1Title.length <= 60) own = h1Title;
    }
    const url = this.router.url.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    const next = this.build(page, own);
    this.recordJourney(url, own || this.lastSegment(url));
    const prevCrumbs = this.crumbs();
    if (next.length !== prevCrumbs.length || next.some((c, i) => c.label !== prevCrumbs[i].label || c.link !== prevCrumbs[i].link)) this.crumbs.set(next);
  }

  /** Home, then the page you came FROM (link back), then the current screen (text only).
   *
   *  - Menu-la irukura page-ah MENU-la click panna: "Home / <screen>" mattum. Vandha vazhi seraadhu.
   *    (Follow-ups-la irundhu All Donors-ah menu-la click panna "Home / All Donors" dhaan —
   *    "Home / Follow-ups / All Donors" nu reverse aaga koodadhu.)
   *  - Page-kulla irundhu oru ACTION mooliyama pona (Lead Work Queue → Communicate):
   *    "Home / Lead Work Queue / Communication Timeline".
   *  - Refresh / deep link (vandha vazhi theriyadhu): PARENT_ROUTE_OF parent + own label.
   *  Group/module headers (Donors & Leads madhiri) eppovum trail-la varaadhu — pages mattum.
   */
  private build(page: string[], own: string): Crumb[] {
    const url = this.router.url.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    // DASHBOARD-ku breadcrumb vaendaam — page-ku thani header (date / greeting / actions) irukkaala
    // trail theva illa. Empty trail-ah rendu: bar-kulla nav-e render aagadhu (breadcrumb-bar.html @if).
    if (url === HOME) return [];

    const trail: Crumb[] = [{ label: 'Home', link: HOME }];
    const current = this.title(own || this.lastSegment(url));

    // Menu row exact-ah match aana — idhu MENU click (illa) direct open. Vandha vazhi sera koodadhu:
    // "Home / <screen>" mattum. Menu-kulla ulla pages-ku idhu dhaan rule (Lead Work Queue,
    // All Donors, Follow-ups ellamey).
    if (this.isMenuPage(url)) {
      trail.push({ label: current });
      return trail;
    }

    // Vandha vazhi (previous page): page-kulla ACTION mooliyama vandha detail screens-ku mattum.
    const prev = this.journeyPrev(url);
    if (prev) {
      const prevLabel = this.title(prev.label);
      if (prevLabel.toLowerCase() !== current.toLowerCase() && prevLabel.toLowerCase() !== 'home') {
        trail.push({ label: prevLabel, link: prev.url });
      }
    } else {
      // Refresh / deep link: vandha vazhi theriyadhu — PARENT_ROUTE_OF parent page (pages mattum).
      const parent = this.journeyParent(url);
      if (parent) {
        const parentCrumb = this.menuCrumbOf(parent);
        if (parentCrumb && parentCrumb.toLowerCase() !== current.toLowerCase()) {
          trail.push({ label: this.title(parentCrumb), link: parent });
        }
      }
    }
    trail.push({ label: current });
    return trail;
  }

  /**
   * Sidebar-odae group rule: group header trail-la vara koodadhu, menu PAGES mattum dhaan.
   * isGroupOnly flag irundha — route irundhalum — adhu heading dhaan, page illa.
   */
  private isGroup(node: MenuNode): boolean {
    return node.isGroupOnly === true || !this.norm(node.route);
  }

  /** Longest parent-map prefix for this URL (parameterised detail URLs-um match aagum), or null. */
  private parentRouteOf(url: string): string | null {
    let best: string | null = null;
    let bestLen = 0;
    for (const key of Object.keys(PARENT_ROUTE_OF)) {
      const k = key.toLowerCase();
      if ((url === k || url.startsWith(k + '/')) && k.length > bestLen) { best = PARENT_ROUTE_OF[key]; bestLen = k.length; }
    }
    return best;
  }

  /** Longest parent-code-map prefix for this URL (route-less group parents), or null. */
  private parentNodeCodeOf(url: string): string | null {
    let best: string | null = null;
    let bestLen = 0;
    for (const key of Object.keys(PARENT_NODE_CODE_OF)) {
      const k = key.toLowerCase();
      if ((url === k || url.startsWith(k + '/')) && k.length > bestLen) { best = PARENT_NODE_CODE_OF[key]; bestLen = k.length; }
    }
    return best;
  }

  /** Static screen label for this URL (longest parent-map prefix), or ''. */
  private screenLabelOf(url: string): string {
    let best = '';
    let bestLen = 0;
    for (const key of Object.keys(SCREEN_LABEL_OF)) {
      const k = key.toLowerCase();
      if ((url === k || url.startsWith(k + '/')) && k.length > bestLen) { best = SCREEN_LABEL_OF[key]; bestLen = k.length; }
    }
    return best;
  }

  /** True when the breadcrumb must stop at the screen label and never append the person's name/id. */
  private suppressTail(url: string): boolean {
    return NO_NAME_TAIL_PREFIXES.some(p => {
      const k = p.toLowerCase();
      return url === k || url.startsWith(k + '/');
    });
  }

  /** Indha screen-ah record pannu — adutha page-ku idhu dhaan "vandha vazhi" (previous page). */
  private recordJourney(url: string, label: string): void {
    const clean = (label ?? '').replace(/\s+/g, ' ').trim() || this.lastSegment(url);
    const i = this.journey.findIndex(j => j.url === url);
    if (i >= 0) this.journey.splice(i, 1);
    this.journey.push({ url, label: clean });
    if (this.journey.length > 12) this.journey.shift();
  }

  /** Current screen-ku munnadi irundha page (same URL re-scan step illa). */
  private journeyPrev(url: string): { url: string; label: string } | null {
    if (url === HOME) return null;
    const prev = [...this.journey].reverse().find(j => j.url !== url && j.url !== HOME);
    return prev ?? null;
  }

  /** Refresh / deep link fallback: PARENT map-la irukura parent route (param ids strip panni). */
  private journeyParent(url: string): string | null {
    const parent = this.parentRouteOf(url);
    return parent ? parent.toLowerCase() : null;
  }

  /** Menu-la oru route-oda display name (group headers skip — routable page mattum). */
  private menuCrumbOf(route: string): string {
    const path = this.menuPath(route);
    if (!path) return '';
    const shown = path.filter(n => !this.isGroup(n));
    return shown[shown.length - 1]?.name ?? path[path.length - 1]?.name ?? '';
  }

  /**
   * URL menu-la oru page row-va (exact route match)? Aana vandha vazhi sera koodadhu —
   * menu click / direct open eppovum "Home / <screen>" mattum. Detail screens (menu-la illadhadhu)
   * ku dhaan journey trail.
   */
  private isMenuPage(url: string): boolean {
    let hit = false;
    const walk = (nodes: MenuNode[] | null | undefined): void => {
      for (const n of nodes ?? []) {
        if (hit) return;
        if (!this.isGroup(n) && this.norm(n.route) === url) { hit = true; return; }
        walk(n.children);
      }
    };
    walk(this.navigation.menu());
    return hit;
  }

  /** Last URL segment as a readable label (ids / GUIDs skip panni). */
  private lastSegment(url: string): string {
    const segs = url.split('/').filter(s => s && !/^\d+$/.test(s) && !/^[0-9a-f-]{20,}$/i.test(s));
    return decodeURIComponent(segs[segs.length - 1] ?? '').replace(/[-_]+/g, ' ');
  }

  private norm(route: string | null | undefined): string {
    return (route ?? '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  }

  /** The chain of menu nodes (parent first) whose route is the longest match for this URL, or null. */
  private menuPath(url: string): MenuNode[] | null {
    let best: MenuNode[] | null = null;
    let bestLen = 0;
    const walk = (nodes: MenuNode[] | null | undefined, parents: MenuNode[]): void => {
      for (const n of nodes ?? []) {
        const chain = [...parents, n];
        const r = this.norm(n.route);
        if (r && (url === r || url.startsWith(r + '/')) && r.length > bestLen) { best = chain; bestLen = r.length; }
        walk(n.children, chain);
      }
    };
    walk(this.navigation.menu(), []);
    return best;
  }

  /** The chain of menu nodes (parent first) ending at the node whose CODE matches — route-less groups. */
  private menuPathByCode(code: string): MenuNode[] | null {
    const want = code.trim().toUpperCase();
    const walk = (nodes: MenuNode[] | null | undefined, parents: MenuNode[]): MenuNode[] | null => {
      for (const n of nodes ?? []) {
        const chain = [...parents, n];
        if ((n.code ?? '').trim().toUpperCase() === want) return chain;
        const hit = walk(n.children, chain);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this.navigation.menu(), []);
  }

  /**
   * First Letter Of Every Word Capital, the rest small.
   *
   * TWO EXCEPTIONS, so the trail spells a screen the way the menu does. A word with a capital inside
   * it is a name and is kept as written ("WhatsApp", not "Whatsapp"), and the letter after a hyphen
   * stays small ("Follow-ups", not "Follow-Ups").
   */
  private title(text: string): string {
    return text.replace(/\S+/g, (word) => /[a-z][A-Z]/.test(word)
      ? word
      : word.toLowerCase().replace(/(^|[\/(])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase()));
  }

  private labelOf(el: Element): string[] {
    const node = el.matches(LABEL_ONLY_FIRST_SPAN) ? (el.querySelector(':scope > span') ?? el) : el;
    return this.split(node.textContent);
  }

  private split(text: string | null): string[] {
    return (text ?? '').replace(/\s+/g, ' ').trim().split(/\s*[·•\/]\s*/).map(s => s.trim()).filter(Boolean);
  }

  private fromUrl(): string[] {
    const raw = this.router.url.split(/[?#]/)[0].replace(/^\/app\/?/, '').split('/');
    // Group segment-ai (relationships madhiri) drop pannidu — menu illaadha fallback trail-layum
    // group name vara koodadhu, menu pages mattum dhaan.
    const url = this.router.url.split(/[?#]/)[0].toLowerCase();
    for (const key of GROUP_SEGMENT_PREFIXES) {
      const k = key.toLowerCase();
      if (url === k || url.startsWith(k + '/')) {
        const idx = key.split('/').filter(s => s && s.toLowerCase() !== 'app').length - 1;
        if (idx >= 0 && idx < raw.length) raw.splice(idx, 1);
        break;
      }
    }
    return raw
      .filter(s => s && !/^\d+$/.test(s) && !/^[0-9a-f-]{20,}$/i.test(s))
      .map(s => decodeURIComponent(s).replace(/[-_]+/g, ' '))
      // Fallback-layum page mattum dhaan — middle URL segments (module/group names) crumbs aaga koodadhu.
      .slice(-1);
  }
}
