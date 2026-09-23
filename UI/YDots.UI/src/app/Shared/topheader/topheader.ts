import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { LayoutService } from '../../Service/layout-service';
import { apiErrorMessage } from '../models/api-response.model';
import { TenantOptionResponse } from '../models/auth.model';
import { AuthSessionService } from '../services/auth-session.service';
import { AuthTokenService } from '../services/auth-token.service';
import { NavigationService } from '../services/navigation.service';
import { OrganisationContextService } from '../services/organisation-context.service';
import { ToastService } from '../services/toast.service';

/**
 * The signed-in identity in the top bar, the Organisation switcher, and sign-out.
 *
 * WHERE THE NAME COMES FROM
 * -------------------------
 * One place: `AuthTokenService`, which holds what the API returned at sign-in. An earlier version
 * tried `sessionStorage.userData`, then `sessionStorage.loginResponse`, then fell back to a JSON
 * file of sample data — so a failed sign-in could still leave a plausible-looking name in the
 * header, and the header could disagree with the rest of the app. A signal means the value is
 * live: sign out, and this updates by itself with no event wiring.
 *
 * THE ORGANISATION SWITCHER
 * -------------------------
 * Only a root user sees it, because only a root user has anything to switch between. Choosing an
 * Organisation asks the SERVER to re-issue the access token against it; there is no client-side
 * setting that could be flipped instead. The new navigation is fetched as part of that switch —
 * see `OrganisationContextService` — because what a person may see genuinely differs between
 * Organisations, and leaving the reload to each caller is what let one of them forget.
 *
 * And selecting an Organisation does not change who the person is. A root user has no
 * Organisation of their own and never acquires one by looking at somebody's data — which is why
 * the bar shows "working inside X" rather than presenting it as their own.
 */
@Component({
  selector: 'app-topheader',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './topheader.html',
  styleUrl: './topheader.css',
})
export class TopheaderComponent implements OnInit, OnDestroy {
  private readonly tokens = inject(AuthTokenService);
  private readonly session = inject(AuthSessionService);
  private readonly organisations = inject(OrganisationContextService);
  private readonly navigation = inject(NavigationService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly destroy$ = new Subject<void>();

  readonly username = computed(() => this.tokens.user()?.displayName ?? 'User');
  readonly userEmail = computed(() => this.tokens.user()?.email ?? '');
  readonly userRole = computed(() => this.tokens.roles()[0] ?? '');

  /** SUPER_ADMIN -> "Super admin": the raw role code is an identifier, not something to read. */
  readonly roleLabel = computed(() => {
    const role = this.userRole().replace(/[_-]+/g, ' ').trim().toLowerCase();
    return role.charAt(0).toUpperCase() + role.slice(1);
  });

  // ---- The menu toggle -----------------------------------------------------------------------------
  /** True when the rail is expanded (desktop) or the drawer is open (phone / tablet). */
  readonly menuExpanded = this.layout.menuExpanded;

  readonly menuLabel = computed(() => {
    if (this.layout.isDesktop()) {
      return this.menuExpanded() ? 'Collapse menu' : 'Expand menu';
    }
    return this.menuExpanded() ? 'Close menu' : 'Open menu';
  });

  /** Fold / unfold arrows for the desktop rail; a plain hamburger for the phone drawer. */
  readonly menuIcon = computed(() => {
    if (!this.layout.isDesktop()) {
      return 'ri-menu-line';
    }
    return this.menuExpanded() ? 'ri-menu-fold-line' : 'ri-menu-unfold-line';
  });

  toggleMenu(): void {
    this.layout.toggleMenu();
  }

  // ---- Fullscreen ----------------------------------------------------------------------------------
  //
  // This button used to be wired by the theme's app.js on DOMContentLoaded, when Angular had not yet
  // drawn the header. Its setup function reads `#appHeader` first, so on a page whose header did not
  // exist yet it threw and the fullscreen handler after it was never attached: the button did nothing.
  // It is bound here, by the component that owns it, and the icon follows the browser's real state
  // (so pressing Esc to leave fullscreen flips it back too).
  readonly fullscreenSupported = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  readonly isFullscreen = signal(typeof document !== 'undefined' && document.fullscreenElement !== null);

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen.set(document.fullscreenElement !== null);
  }

  toggleFullscreen(): void {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();

    // A refusal (blocked by the browser or an embedding frame) is not worth an error screen; the icon
    // simply stays as it was because `fullscreenchange` never fires.
    request.catch(() => undefined);
  }

  // ---- Organisation switcher -----------------------------------------------------------------
  readonly canSwitchOrganisation = computed(() => this.organisations.canSwitch());
  readonly currentOrganisation = computed(() => this.organisations.currentName());
  readonly isActingInOrganisation = computed(() => this.organisations.isActingInOrganisation());
  readonly selectableOrganisations = computed(() => this.organisations.selectable());
  readonly loadingOrganisations = computed(() => this.organisations.loading());

  /** Up to two letters of the organisation's name, for the badge on the switcher. */
  readonly organisationInitials = computed(() =>
    this.currentOrganisation()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2));

  readonly switchingTo = signal<string | null>(null);

  /** True while the exit-to-platform call is in flight, so the item cannot be double-clicked. */
  readonly leaving = signal(false);

  readonly initials = computed(() => {
    const name = this.username();

    return name
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  });

  // ---- Auto-hide while scrolling ---------------------------------------------------------------------
  //
  // The bar stays put and visible at all times; the only thing that makes it disappear is the page actually
  // scrolling. It hides the instant a scroll starts and comes back on its own once scrolling settles - there
  // is no hover-to-reveal any more (chasing the pointer up to the top edge made the bar feel like it was
  // constantly moving even when nobody had scrolled). The page keeps the strip reserved for it, so showing
  // or hiding never moves or covers any content. Applies on every device: a phone benefits from the same
  // "out of the way while scrolling" behaviour as a mouse, and unlike the old hover trick this one needs no
  // pointer to bring the bar back.

  readonly barHidden = signal(false);

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** How long the page must sit still before the bar returns. */
  private static readonly SCROLL_IDLE_MS = 400;

  ngOnInit(): void {
    document.documentElement.classList.add('topbar-auto');
    // Capture, because `scroll` does not bubble and the page may scroll in an inner container.
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.host.nativeElement.addEventListener('focusin', this.onFocusIn);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    this.clearIdleTimer();
    document.documentElement.classList.remove('topbar-auto', 'topbar-hidden', 'topbar-instant');
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    this.host.nativeElement.removeEventListener('focusin', this.onFocusIn);
  }

  private headerElement(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('#appHeader');
  }

  private reveal(): void {
    this.clearIdleTimer();
    this.setHidden(false);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Scroll events before this time were caused by our own correction below, not by the person. */
  private ignoreScrollUntil = 0;

  /**
   * The one place the bar's state changes. Besides flipping the bar it gives the page its strip back (hidden)
   * or takes it again (shown): `topbar-hidden` on <html> removes / restores the padding the theme reserves above
   * every page (see styles.css).
   *
   * NOT LOSING THE PLACE ON SCREEN. Near the top of the page that padding is on screen, so the page is meant to
   * visibly slide up or down with the bar. Scrolled further down it is not on screen, and changing it would shift
   * whatever the person is reading by the strip's height in one frame. There the change is applied instantly and
   * the scroll position is moved by the same amount, so nothing on screen moves at all.
   */
  private setHidden(hidden: boolean): void {
    if (this.barHidden() === hidden) {
      return;
    }

    this.barHidden.set(hidden);

    const root = document.documentElement;
    const strip = this.headerElement()?.offsetHeight ?? 0;
    const scrolled = window.scrollY;
    const instant = strip > 0 && scrolled >= strip;

    if (instant) {
      root.classList.add('topbar-instant');
    }

    root.classList.toggle('topbar-hidden', hidden);

    if (instant) {
      // Reading a layout property makes the new padding take effect now, with transitions off.
      void root.offsetHeight;
      this.ignoreScrollUntil = performance.now() + 150;
      window.scrollTo({ top: Math.max(0, scrolled + (hidden ? -strip : strip)), behavior: 'instant' });
      root.classList.remove('topbar-instant');
    }
  }

  private closeOpenMenus(): void {
    const bootstrap = (window as unknown as {
      bootstrap?: { Dropdown?: { getOrCreateInstance(el: Element): { hide(): void } } };
    }).bootstrap;

    this.headerElement()
      ?.querySelectorAll('[data-bs-toggle="dropdown"][aria-expanded="true"]')
      .forEach((toggle) => bootstrap?.Dropdown?.getOrCreateInstance(toggle).hide());
  }

  private readonly onScroll = (event: Event): void => {
    // Our own scroll correction (setHidden) must not count as the page scrolling, or showing the bar
    // would hide it again in the same breath.
    if (performance.now() < this.ignoreScrollUntil) {
      return;
    }

    // Scrolling the bar's own menus (the organisation list) is not the page scrolling.
    if (event.target instanceof Node && this.host.nativeElement.contains(event.target)) {
      return;
    }

    this.closeOpenMenus();
    this.clearIdleTimer();
    this.setHidden(true);

    // Comes back on its own once the page has sat still for a beat - no pointer needed.
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.setHidden(false);
    }, TopheaderComponent.SCROLL_IDLE_MS);
  };

  private readonly onFocusIn = (): void => {
    // Tabbing into a bar that is out of sight has to bring it into sight.
    this.reveal();
  };

  /**
   * Loads the list when the switcher is opened, not on every page.
   *
   * For nearly everybody the answer is "you cannot switch", so asking on each page load would be
   * a wasted request on the great majority of visits.
   */
  onSwitcherOpened(): void {
    if (!this.canSwitchOrganisation() || this.selectableOrganisations().length > 0) {
      return;
    }

    this.organisations.loadSelectable().pipe(takeUntil(this.destroy$)).subscribe({
      error: (error: unknown) =>
        this.toast.show('Could not load organisations', apiErrorMessage(error), 'error'),
    });
  }

  /**
   * Steps into an Organisation.
   *
   * `select()` does not complete until the new Organisation's navigation is in hand, so
   * `landingRoute()` below is the NEW Organisation's landing route rather than the previous
   * one's. A menu that could not be fetched does not fail the switch — the token has already
   * changed by then — so the fallback is simply whatever the service last knew, which is the
   * dashboard.
   */
  switchTo(option: TenantOptionResponse): void {
    if (!option.tenantId || this.switchingTo()) {
      return;
    }

    this.switchingTo.set(option.tenantId);

    this.organisations
      .select(option.tenantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.switchingTo.set(null);
          this.toast.show(
            'Organisation selected',
            `You are now working inside ${option.name}.`,
            'success');
          void this.router.navigate([this.navigation.landingRoute()]);
        },
        error: (error: unknown) => {
          this.switchingTo.set(null);
          this.toast.show('Could not switch', apiErrorMessage(error), 'error');
        },
      });
  }

  /**
   * Steps back out to platform level.
   *
   * WHY THIS IS HERE. Entering an Organisation replaces the sidebar with that Organisation's menu,
   * so the platform branch — Organisations, Approval Queue, the catalogues, Platform Audit —
   * disappears the moment you arrive, and nothing in the page offered a way back. Signing out and
   * in again was the only exit, which also meant the token kept naming that Organisation the whole
   * time, stamping its id onto anything the root user did next.
   *
   * Lands on the Organisations directory rather than the dashboard: somebody who just left an
   * Organisation is almost always going to another one, or to the queue that sent them there.
   */
  exitOrganisation(): void {
    if (this.leaving()) {
      return;
    }

    this.leaving.set(true);

    this.organisations
      .exitToPlatform()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.leaving.set(false);
          this.toast.show(
            'Back at platform level',
            'You are no longer working inside an organisation.',
            'success');
          void this.router.navigate(['/app/administration/organisation/directory']);
        },
        error: (error: unknown) => {
          this.leaving.set(false);
          this.toast.show('Could not leave the organisation', apiErrorMessage(error), 'error');
        },
      });
  }

  /**
   * The "Manage organisations" item at the foot of the switcher.
   *
   * IT USED TO BE A PLAIN LINK, and that is how the reported bug was reached most easily: click
   * it from inside TEN001 and you arrive at a screen listing every Organisation on the platform,
   * with TEN001's TenantAdmin menu still down the left-hand side and the token still naming
   * TEN001. The route now carries `platformScopeGuard`, which steps out of the Organisation on the
   * way in, so a plain link would in fact be correct again — but a person clicking this deserves
   * to be told it will leave, rather than discovering it from the sidebar afterwards. Hence a
   * button with a subtitle rather than an anchor.
   */
  manageOrganisations(): void {
    void this.router.navigate(['/app/administration/organisation/directory']);
  }

  /** Whether this Organisation can be worked in, or only reviewed. */
  isOperable(option: TenantOptionResponse): boolean {
    return this.organisations.isOperable(option);
  }

  /**
   * Signs out of this device.
   *
   * The service tells the server first, which revokes the session and clears the HttpOnly refresh
   * cookie — the part JavaScript cannot do for itself. Clearing only the browser copy would leave
   * a live session and a live cookie behind on the server.
   */
  signOut(): void {
    this.navigation.clear();
    this.session.endSession();
  }

  /** Signs out everywhere, for a lost or shared device. */
  signOutEverywhere(): void {
    this.navigation.clear();
    this.session.endSession(true);
  }
}
