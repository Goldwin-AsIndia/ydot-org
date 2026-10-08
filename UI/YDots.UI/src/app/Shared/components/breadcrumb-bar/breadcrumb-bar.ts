import { Component, ElementRef, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { MenuNode } from '../../models/iam-contract.model';
import { NavigationService } from '../../services/navigation.service';

export interface Crumb { label: string; link?: string; }

const HOME = '/app/dashboard';

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
    let own = page[page.length - 1] ?? '';
    if (source && page.length === 1) {
      const h1 = Array.from(area.querySelectorAll('h1')).find(h => !this.host.nativeElement.contains(h) && !h.closest(OVERLAY));
      const title = (h1?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (title && title.length <= 60 && title.toLowerCase() !== own.toLowerCase()) own = title;
    }
    const next = this.build(page, own);
    const prev = this.crumbs();
    if (next.length !== prev.length || next.some((c, i) => c.label !== prev[i].label || c.link !== prev[i].link)) this.crumbs.set(next);
  }

  /** Home, then the menu path to this screen (each parent links to where it goes), then the screen itself. */
  private build(page: string[], own: string): Crumb[] {
    const url = this.router.url.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    if (url === HOME) return [{ label: 'Home' }];

    const trail: Crumb[] = [{ label: 'Home', link: HOME }];
    const path = this.menuPath(url);
    if (path) {
      const exact = this.norm(path[path.length - 1].route) === url;
      path.forEach((node, i) => {
        const last = i === path.length - 1;
        trail.push({ label: this.title(node.name ?? ''), link: node.route && !(last && exact) ? node.route : undefined });
      });
      // A screen reached from a menu item (a detail or edit page) ends with its own title.
      if (!exact && own && own.toLowerCase() !== (path[path.length - 1].name ?? '').toLowerCase()) trail.push({ label: this.title(own) });
      return trail;
    }
    // Not in the menu (or the menu has not loaded): the screen's own breadcrumb text, nothing linked.
    page.forEach(label => trail.push({ label: this.title(label) }));
    return trail;
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
    const path = this.router.url.split(/[?#]/)[0].replace(/^\/app\/?/, '');
    return path.split('/')
      .filter(s => s && !/^\d+$/.test(s) && !/^[0-9a-f-]{20,}$/i.test(s))
      .map(s => decodeURIComponent(s).replace(/[-_]+/g, ' '));
  }
}
