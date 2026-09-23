// src/app/core/services/layout.service.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Where the theme swaps the sidebar between a permanent rail and an overlay drawer (Bootstrap `lg`).
 * It is the SAME number the stylesheet uses (`max-width: 991.98px` hides the sidebar), so JS and CSS can
 * never disagree about which of the two behaviours applies. The old handler used 1024 here, which left
 * a 992-1023px band where the toggle asked for an overlay the stylesheet had already made permanent.
 */
const DESKTOP_QUERY = '(min-width: 992px)';

/** `data-sidebar` values that show icons only. */
const COLLAPSED_MODES = ['icon', 'icon-hover'];

@Injectable({ providedIn: 'root' })
export class LayoutService {

  private htmlElement = document.documentElement;
  private readonly router = inject(Router);

  // ---- The menu (sidebar): one source of truth for the top bar's toggle ----------------------------
  //
  // Before this, the toggle was a raw DOM listener with no state behind it, so the button could not tell
  // whether the menu was open, the phone drawer could be opened but never closed, and the icon had to be
  // switched by a CSS attribute selector. Signals let the header read the real state (zoneless app: a
  // plain field would not refresh it).
  // Null where there is no matchMedia (a test DOM): behave as a desktop, the layout the theme defaults to.
  private readonly desktopQuery: MediaQueryList | null =
    typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;
  private readonly isDesktopState = signal(this.desktopQuery?.matches ?? true);
  private readonly sidebarModeState = signal<string | null>(this.htmlElement.getAttribute('data-sidebar'));
  private readonly mobileMenuOpenState = signal(false);

  /** True when the sidebar is a permanent rail; false when it is an overlay drawer. */
  readonly isDesktop = this.isDesktopState.asReadonly();

  /** True while the phone / tablet drawer is showing. */
  readonly mobileMenuOpen = this.mobileMenuOpenState.asReadonly();

  /** Whether the menu is currently showing its labels (rail expanded / drawer open). */
  readonly menuExpanded = computed(() =>
    this.isDesktopState()
      ? !COLLAPSED_MODES.includes(this.sidebarModeState() ?? '')
      : this.mobileMenuOpenState());

  constructor() {
    // `data-sidebar` is written from several places (this service, the customiser radios, the theme's
    // own scripts), so observe the attribute instead of trusting every writer to call us.
    new MutationObserver(() => this.sidebarModeState.set(this.htmlElement.getAttribute('data-sidebar')))
      .observe(this.htmlElement, { attributes: true, attributeFilter: ['data-sidebar'] });

    this.desktopQuery?.addEventListener('change', (event) => this.onBreakpointChange(event.matches));

    // Escape closes the drawer. Bound once, here, not per layout instance, so signing out and in again
    // cannot stack listeners.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.mobileMenuOpenState()) {
        this.closeMobileMenu();
      }
    });

    // Picking a page is the end of the drawer's job.
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.closeMobileMenu());
  }

  /**
   * The top bar's menu button. On a desktop it collapses / expands the rail (and remembers the choice);
   * on a phone or tablet it opens / closes the drawer. Same button, one behaviour per screen size.
   */
  toggleMenu(): void {
    if (!this.isDesktopState()) {
      if (this.mobileMenuOpenState()) {
        this.closeMobileMenu();
      } else {
        this.openMobileMenu();
      }
      return;
    }

    const next = this.htmlElement.getAttribute('data-sidebar') === 'icon' ? 'default' : 'icon';
    this.setAndSaveAttribute('data-sidebar', next);
    this.updateSimpleBar(this.htmlElement.getAttribute('data-layout') ?? 'vertical');
  }

  openMobileMenu(): void {
    this.mobileMenuOpenState.set(true);
    document.getElementById('sidebar')?.classList.add('show');
  }

  closeMobileMenu(): void {
    this.mobileMenuOpenState.set(false);
    document.getElementById('sidebar')?.classList.remove('show');
  }

  private onBreakpointChange(desktop: boolean): void {
    this.isDesktopState.set(desktop);

    if (desktop) {
      // Leaving the phone layout: the drawer has no meaning any more, and the rail's saved state (which
      // was removed while it was a drawer) comes back rather than being lost until the next reload.
      this.closeMobileMenu();
      if (!this.htmlElement.getAttribute('data-sidebar')
        && this.htmlElement.getAttribute('data-layout') !== 'horizontal') {
        let saved: string | null = null;
        try {
          saved = localStorage.getItem('data-sidebar');
        } catch {
          // storage blocked: fall through to the default
        }
        this.htmlElement.setAttribute('data-sidebar', saved || 'default');
      }
    } else {
      this.htmlElement.removeAttribute('data-sidebar');
    }
  }

  // These three are read by views that are NOT the ones that change them: the sidebar's "Theme Settings" link
  // flips the flag, the customiser panel (a sibling component) shows it. This app is zoneless, so a plain field
  // written in one view's click handler never refreshes the other and the panel stayed shut. Signals notify
  // whichever template reads them; the accessors keep the old property API for every existing caller.
  private readonly themePanelOpenState = signal(false);
  private readonly themeMenuOpenState = signal(false);
  private readonly activeThemeSectionState = signal('layout');

  /** Tracks whether the theme customizer panel is open (double-menu beside sidebar) */
  get themePanelOpen(): boolean {
    return this.themePanelOpenState();
  }
  set themePanelOpen(value: boolean) {
    this.themePanelOpenState.set(value);
  }

  /** Tracks whether the Theme Settings sidebar submenu (dropdown) is expanded */
  get themeMenuOpen(): boolean {
    return this.themeMenuOpenState();
  }
  set themeMenuOpen(value: boolean) {
    this.themeMenuOpenState.set(value);
  }

  /** Tracks which theme section is active (layout, colors, mode, etc.) */
  get activeThemeSection(): string {
    return this.activeThemeSectionState();
  }
  set activeThemeSection(value: string) {
    this.activeThemeSectionState.set(value);
  }

    private readonly themePanelStorageKey = 'theme-panel-open';
    private readonly themeMenuStorageKey = 'theme-menu-open';

    toggleThemePanel(): void {
      this.themePanelOpen = !this.themePanelOpen;
      this.themeMenuOpen = this.themePanelOpen;
      this.persistThemeState();
      this.syncThemePanelClass();
    }

    openThemePanel(): void {
      this.themePanelOpen = true;
      this.themeMenuOpen = true;
      this.persistThemeState();
      this.syncThemePanelClass();
    }

    closeThemePanel(): void {
      this.themePanelOpen = false;
      this.themeMenuOpen = false;
      this.persistThemeState();
      this.syncThemePanelClass();
    }

    /** Toggle only the dropdown submenu, without opening the panel */
    toggleThemeMenu(): void {
      this.themeMenuOpen = !this.themeMenuOpen;
      localStorage.setItem(this.themeMenuStorageKey, String(this.themeMenuOpen));
    }

    /** Opens the theme panel and sets the specific section (used from sidebar dropdown) */
    openThemeSection(section: string): void {
      this.activeThemeSection = section;
      this.openThemePanel();
    }

    /** Persists open state so the menu/panel stays open after a reload */
    private persistThemeState(): void {
      try {
        localStorage.setItem(this.themePanelStorageKey, String(this.themePanelOpen));
        localStorage.setItem(this.themeMenuStorageKey, String(this.themeMenuOpen));
      } catch {
        // ignore storage errors
      }
    }

    /** Restores persisted theme menu/panel state from storage */
    private restoreThemeState(): void {
      try {
        const panel = localStorage.getItem(this.themePanelStorageKey);
        const menu = localStorage.getItem(this.themeMenuStorageKey);
        if (panel === 'true') {
          this.themePanelOpen = true;
          this.syncThemePanelClass();
        }
        if (menu === 'true') {
          this.themeMenuOpen = true;
        }
      } catch {
        // ignore storage access errors
      }
    }

  private syncThemePanelClass(): void {
    if (this.themePanelOpen) {
      this.htmlElement.classList.add('theme-panel-open');
    } else {
      this.htmlElement.classList.remove('theme-panel-open');
    }
  }

  private settings = [
    { attribute: 'data-layout', defaultValue: 'vertical' },
    { attribute: 'data-bs-theme', defaultValue: 'light' },
    { attribute: 'data-content-width', defaultValue: 'default' },
    { attribute: 'dir', defaultValue: 'ltr' },
    { attribute: 'data-sidebar-color', defaultValue: 'light' },
    { attribute: 'data-sidebar', defaultValue: 'default' },
    { attribute: 'data-theme-colors', defaultValue: 'default' },
  ];

  init(): void {
    // A layout that was destroyed while the drawer was open (sign out) leaves the flag set but the
    // `show` class gone with the old DOM; start from closed.
    this.mobileMenuOpenState.set(false);

    this.settings.forEach(({ attribute, defaultValue }) => {
      const value = localStorage.getItem(attribute) || defaultValue;
      this.htmlElement.setAttribute(attribute, value);
      if (attribute === 'dir') this.updateLayoutDir(value);
      if (attribute === 'data-bs-theme') this.setTheme(value, false);
    });

    this.updateSimpleBar(
      this.htmlElement.getAttribute('data-sidebar') ??
      this.htmlElement.getAttribute('data-layout') ?? 'vertical'
    );

    if (this.htmlElement.getAttribute('data-layout') === 'horizontal') {
      this.removeHorizontalAttributes();
    }

    // Restore persisted theme menu/panel open state (so it survives reloads)
    this.restoreThemeState();

    this.bindEvents();
  }

  private bindEvents(): void {
    // The menu toggle lives in the top bar (TopheaderComponent -> toggleMenu()), not here.

    // Sidebar Backdrop
    document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {
      this.closeThemePanel();
      if (this.htmlElement.getAttribute('data-layout') === 'horizontal') {
        document.getElementById('horizontal-aside')?.classList.toggle('show');
      } else {
        this.closeMobileMenu();
      }
    });

    // Theme Toggle
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const current = this.htmlElement.getAttribute('data-bs-theme');
      const next = current === 'light' ? 'dark' : 'light';
      this.setAndSaveAttribute('data-bs-theme', next, false);
      this.setTheme(next);
    });

    // Customizer Radio Buttons
    document.querySelectorAll('.layout-customizer input[type="radio"]')
      .forEach(el => el.addEventListener('change', (e) => this.handleRadioChange(e)));

    // Reset Button
    document.getElementById('resetBtn')?.addEventListener('click', () => {
      localStorage.clear();
      window.location.reload();
    });

    // Responsive Sidebar: apply the current breakpoint once; later changes arrive via the media query
    // listener registered in the constructor.
    this.onBreakpointChange(this.desktopQuery?.matches ?? true);
  }

  setAndSaveAttribute(attr: string, value: string, updateSidebarColor = true): void {
    this.htmlElement.setAttribute(attr, value);
    localStorage.setItem(attr, value);

    if (attr === 'data-sidebar-color' && updateSidebarColor) {
      const theme = this.htmlElement.getAttribute('data-bs-theme');
      if (theme === 'light') localStorage.setItem('sidebar-color-light-mode', value);
      else if (theme === 'dark') localStorage.setItem('sidebar-color-dark-mode', value);
    }

    const radio = document.querySelector<HTMLInputElement>(
      `input[name="${attr}"][value="${value}"]`
    );
    if (radio) radio.checked = true;
  }

  setTheme(theme: string, save = true): void {
    let resolved = theme;
    if (theme === 'auto') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      this.htmlElement.setAttribute('data-bs-theme', resolved);
    }

    const lightColor = localStorage.getItem('sidebar-color-light-mode');
    const darkColor = localStorage.getItem('sidebar-color-dark-mode');
    const sidebarColor = resolved === 'light' && lightColor ? lightColor
      : resolved === 'dark' && darkColor ? darkColor
      : resolved === 'dark' ? 'dark' : 'light';

    this.htmlElement.setAttribute('data-sidebar-color', sidebarColor);
    if (save) localStorage.setItem('data-sidebar-color', sidebarColor);

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-label',
        resolved === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
      );
    }
  }

  updateLayoutDir(dir: string): void {
    const bootstrap = document.getElementById('bootstrap-style') as HTMLLinkElement;
    const app = document.getElementById('app-style') as HTMLLinkElement;
    if (!bootstrap || !app) return;

    if (dir === 'rtl') {
      bootstrap.href = bootstrap.href.replace('bootstrap.min.css', 'bootstrap-rtl.min.css');
      app.href = app.href.replace('app.min.css', 'app-rtl.min.css');
    } else {
      bootstrap.href = bootstrap.href.replace('bootstrap-rtl.min.css', 'bootstrap.min.css');
      app.href = app.href.replace('app-rtl.min.css', 'app.min.css');
    }
  }

  updateSimpleBar(layout: string): void {
    const sidebar = document.getElementById('sidebar-simplebar');
    if (!sidebar) return;

    const isIconMode = this.htmlElement.getAttribute('data-sidebar') === 'icon';
    const shouldUnmount = !['vertical','horizontal','default','semibox','medium','icon-hover'].includes(layout) || isIconMode;

    if (shouldUnmount) {
      setTimeout(() => {
        if ((window as any).SimpleBar) {
          const instance = (window as any).SimpleBar.instances.get(sidebar);
          instance?.unMount();
        }
      }, 500);
    } else {
      sidebar.setAttribute('data-simplebar', '');
      if ((window as any).SimpleBar) {
        new (window as any).SimpleBar(sidebar);
      }
    }
  }

  removeHorizontalAttributes(): void {
    this.htmlElement.removeAttribute('data-sidebar');
    this.htmlElement.setAttribute('data-topbar-theme', 'dark');
  }

  private handleRadioChange(event: Event): void {
    const { name, value } = event.target as HTMLInputElement;
    switch (name) {
      case 'data-bs-theme':
        this.setAndSaveAttribute('data-bs-theme', value);
        this.setTheme(value);
        break;
      case 'data-layout':
        this.setAndSaveAttribute('data-layout', value);
        if (value === 'horizontal') {
          this.removeHorizontalAttributes();
        } else {
          this.htmlElement.removeAttribute('data-topbar-theme');
        }
        this.updateSimpleBar(value);
        break;
      case 'data-content-width':
        this.setAndSaveAttribute('data-content-width', value);
        break;
      case 'dir':
        this.setAndSaveAttribute('dir', value);
        this.updateLayoutDir(value);
        break;
      case 'data-sidebar':
        if (this.htmlElement.getAttribute('data-layout') !== 'horizontal') {
          this.setAndSaveAttribute('data-sidebar', value);
        }
        this.updateSimpleBar(value);
        break;
      case 'data-sidebar-color':
        this.setAndSaveAttribute('data-sidebar-color', value, true);
        break;
      case 'data-theme-colors':
        this.setAndSaveAttribute('data-theme-colors', value);
        break;
    }
  }
}