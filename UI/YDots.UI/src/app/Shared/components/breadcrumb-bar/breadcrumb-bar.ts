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
 * A profile has no menu entry of its own: opening one from the User Directory must still show the
 * directory's full trail (Home / Administration / … / User Directory) plus the screen itself, the
 * same as if the profile sat in the menu next to the directory. Without this map the bar only sees
 * the page's own kicker ("Access & identity · User account") and the trail comes out short.
 */
const PARENT_ROUTE_OF: Record<string, string> = {
  '/app/administration/access/user-profile-and-access': '/app/administration/access/user-directory',
  '/app/administration/access/user-details': '/app/administration/access/user-directory',
  '/app/administration/users/bulk-actions': '/app/administration/access/user-directory',
  '/app/administration/access/create-user': '/app/administration/access/user-directory',
  '/app/administration/users/security': '/app/administration/access/user-directory',
  '/app/administration/users/login-identifier-change': '/app/administration/access/user-directory',
  // Campaign detail: "Campaign Overview" register page-ku keezha varanum —
  // kicker first span "Campaign" mattum dhaan, so menu path dhaan full trail tharum.
  '/app/fundraising/campaigns/campaign-detail': '/app/fundraising/campaigns/campaign-register',
  '/app/fundraising/campaigns/campaign-wizard': '/app/fundraising/campaigns/campaign-register',
  '/app/fundraising/campaigns/tracking-asset-manager': '/app/fundraising/campaigns/campaign-register',
  '/app/fundraising/campaigns/campaign-readiness-checklist': '/app/fundraising/campaigns/campaign-register',
  '/app/fundraising/campaigns/pause-resume-and-close-campaign': '/app/fundraising/campaigns/campaign-register',
};

/**
 * Donors and Leads screens whose parent is the menu GROUP "Donors and Leads" (code FR_RELATIONSHIPS).
 *
 * That group is route-less (route: null — a nesting row the sidebar only draws), so PARENT_ROUTE_OF
 * can never reach it: no route ever matches. The parent is named by menu node CODE instead. Every
 * relationship screen is listed — menu rows and detail pages alike — so the trail always reads
 * "Home / Fundraising / Donors And Leads / <screen>", with or without a row of its own in the menu.
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
 * URL segment → trail label, used ONLY by the menu-less fallback trail (fromUrl).
 * The whole module sits on the "relationships" route segment; the trail must never spell it
 * "Relationships" — the menu calls the group "Donors and Leads" and so must the fallback.
 */
const SEGMENT_LABEL_OF: Record<string, string> = {
  '/app/fundraising/relationships': 'Donors And Leads',
  '/app/don': 'Donors And Leads',
};

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
  '/app/fundraising/relationships/follow-up-queue': 'Follow-up Queue',
  '/app/fundraising/relationships/follow-up-planner': 'Follow-up Planner',
  '/app/fundraising/relationships/follow-up-execution': 'Follow-up Execution',
  '/app/fundraising/relationships/donor-list': 'Donor List',
  '/app/fundraising/relationships/my-donor-list': 'My Donor List',
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

  /** Visited screens this session (oldest first, capped) — the journey an individual page was reached from. */
  private readonly visited: { url: string; trail: Crumb[] }[] = [];

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
    const next = this.withJourney(url, this.build(page, own));
    this.recordVisit(url, next);
    const prevCrumbs = this.crumbs();
    if (next.length !== prevCrumbs.length || next.some((c, i) => c.label !== prevCrumbs[i].label || c.link !== prevCrumbs[i].link)) this.crumbs.set(next);
  }

  /** Home, then the menu path to this screen (each parent links to where it goes), then the screen itself.
   *
   *  Menu-la illadha detail screen (profile / create / security) PARENT_ROUTE_OF map-la irukura parent-oda
   *  trail-ah dhaan use pannum: parent full menu path + own title. So directory-la irundhu profile-ku ponaalum
   *  "Home / Administration / Access Governance / User Directory / User Profile & Access" madhiri varum —
   *  menu-la profile-ah click panna varra mathiriye.
   */
  private build(page: string[], own: string): Crumb[] {
    const url = this.router.url.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    if (url === HOME) return [{ label: 'Home' }];

    const trail: Crumb[] = [{ label: 'Home', link: HOME }];

    // PARENT_ROUTE_OF map-ku priority: profile madhiri detail screens eppovum parent (directory)
    // trail-ah dhaan use pannanum — menu-la profile-ku thani entry irundhalum kooda.
    // Illana "User Directory" skip aayidum (unga screenshot-la nadandhadhu adhu dhaan).
    let path: MenuNode[] | null = null;
    let inheritedOwn = '';
    // Code-forced parents come first: a route-less group (Donors and Leads) can only be named by code.
    const forcedCode = this.parentNodeCodeOf(url);
    const forcedParent = forcedCode ? null : this.parentRouteOf(url);
    if (forcedCode) {
      path = this.menuPathByCode(forcedCode);
      if (path) {
        inheritedOwn = this.screenLabelOf(url) || own || page[page.length - 1] || this.lastSegment(url);
      } else {
        // Group menu-la illadhA: screen-ku menu row exact-a irundha athu dhaan saariyana trail.
        // Illaina URL trail-ai (SEGMENT_LABEL_OF-oda) pirayoga — athu dhaan menu panna trail-ai.
        const ownPath = this.menuPath(url);
        if (ownPath && this.norm(ownPath[ownPath.length - 1].route) === url) path = ownPath;
      }
    } else if (forcedParent) {
      path = this.menuPath(forcedParent);
      if (path) inheritedOwn = this.screenLabelOf(url) || own || page[page.length - 1] || this.lastSegment(url);
    }
    if (!path && !forcedCode) path = this.menuPath(url);
    if (path) {
      const exact = this.norm(path[path.length - 1].route) === url;
      path.forEach((node, i) => {
        const last = i === path.length - 1;
        trail.push({ label: this.title(node.name ?? ''), link: node.route && !(last && exact) ? node.route : undefined });
      });
      // A screen reached from a menu item (a detail or edit page) ends with its own title —
      // aana NO_NAME_TAIL screens-ku (profile madhiri) person name append aagadhu, screen label-oda stop.
      let tail = inheritedOwn || own;
      if (this.suppressTail(url)) tail = this.screenLabelOf(url);
      if (!exact && tail && tail.toLowerCase() !== (path[path.length - 1].name ?? '').toLowerCase()) trail.push({ label: this.title(tail) });
      return trail;
    }
    // Not in the menu (or the menu has not loaded): the screen's own breadcrumb text, nothing linked.
    page.forEach(label => trail.push({ label: this.title(label) }));
    if (!page.length && own) trail.push({ label: this.title(own) });
    return trail;
  }

  /**
   * An INDIVIDUAL page (a detail / record / edit screen the menu does not list exactly) also shows the
   * page it was reached from — the journey, not only the menu position. Lead Work Queue → Communicate
   * reads "Home / Fundraising / Donors And Leads / Lead Work Queue / Communication Timeline".
   *
   * Home and exact menu screens RESTART the trail (their menu path is the whole truth); a cold deep
   * link falls back to the menu trail; screens from a different module never chain; and the trail is
   * capped so the bar can never grow without bound.
   */
  private withJourney(url: string, base: Crumb[]): Crumb[] {
    if (url === HOME || base.length < 2) return base;

    // Exact menu screens ARE the trail — the journey restarts there.
    const path = this.menuPath(url);
    if (path && this.norm(path[path.length - 1].route) === url) return base;

    // The most recent screen visited before this one (re-scanning the same URL is not a step).
    const prevVisit = [...this.visited].reverse().find(v => v.url !== url && v.trail.length > 1);
    if (!prevVisit) return base;

    // Only screens of the same module chain together: Fundraising record pages stay under Fundraising.
    const moduleOf = (trail: Crumb[]): string => trail[1]?.label.toLowerCase() ?? '';
    if (moduleOf(prevVisit.trail) !== moduleOf(base)) return base;

    const last = base[base.length - 1];
    if (!last || prevVisit.trail.some(c => c.label.toLowerCase() === last.label.toLowerCase())) return base;

    // The previous screen's OWN crumb must be a real link back to it. It was the last crumb — plain
    // text — when that page was current, so give it the route it was visited at.
    const upToPrev = prevVisit.trail.map((c, i) =>
      i === prevVisit.trail.length - 1 && !c.link ? { ...c, link: prevVisit.url } : c);
    const chained = [...upToPrev, last];
    return chained.length > 7 ? [chained[0], ...chained.slice(-6)] : chained;
  }

  /** Remember this screen's trail so a page opened FROM it can show where it came from. */
  private recordVisit(url: string, trail: Crumb[]): void {
    const i = this.visited.findIndex(v => v.url === url);
    if (i >= 0) this.visited.splice(i, 1);
    this.visited.push({ url, trail });
    if (this.visited.length > 12) this.visited.shift();
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

  /** First Letter Of Every Word Capital, the rest small. */
  private title(text: string): string {
    return text.toLowerCase().replace(/(^|[\s\-\/(])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
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
    // SEGMENT_LABEL_OF-oda group segment-ai maathu — menu illaadha trail "Relationships" nu kaattakoodathu.
    const url = this.router.url.split(/[?#]/)[0].toLowerCase();
    for (const [key, label] of Object.entries(SEGMENT_LABEL_OF)) {
      const k = key.toLowerCase();
      if (url === k || url.startsWith(k + '/')) {
        const idx = key.split('/').filter(s => s && s.toLowerCase() !== 'app').length - 1;
        if (idx >= 0 && idx < raw.length) raw[idx] = label;
        break;
      }
    }
    return raw
      .filter(s => s && !/^\d+$/.test(s) && !/^[0-9a-f-]{20,}$/i.test(s))
      .map(s => decodeURIComponent(s).replace(/[-_]+/g, ' '));
  }
}
