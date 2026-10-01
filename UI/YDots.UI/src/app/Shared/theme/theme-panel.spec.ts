import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { LayoutService } from '../../Service/layout-service';
import { AuthTokenService } from '../services/auth-token.service';
import { CurrentUserService } from '../services/current-user.service';
import { NavigationService } from '../services/navigation.service';
import { SidebarComponent } from '../sidebar/sidebar';
import { ThemeComponent } from './theme';

/**
 * The sidebar's "Theme Settings" entry has to open the customiser panel. It used to toggle a highlight on a
 * dropdown whose <ul> was never bound to anything, so a click changed nothing on screen.
 */
describe('Theme Settings entry', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('theme-panel-open');

    TestBed.configureTestingModule({
      imports: [SidebarComponent, ThemeComponent],
      providers: [
        provideRouter([]),
        {
          provide: NavigationService,
          useValue: {
            menu: signal([]),
            loading: signal(false),
            failed: signal(false),
            load: () => of(null),
            iconClass: () => 'ri-circle-line',
            collapseId: () => 'collapse-test',
          },
        },
        {
          provide: AuthTokenService,
          useValue: { organisationName: signal(''), isActingInOrganisation: signal(false) },
        },
        { provide: CurrentUserService, useValue: { hasPermission: () => false } },
      ],
    });
  });

  function themeSettingsLink(root: HTMLElement): HTMLAnchorElement {
    const link = Array.from(root.querySelectorAll<HTMLAnchorElement>('a.pe-nav-link')).find(a =>
      a.textContent?.includes('Theme Settings'),
    );
    if (!link) throw new Error('Theme Settings entry not found in the sidebar');
    return link;
  }

  it('opens the panel on click and closes it on the next click', () => {
    const sidebar = TestBed.createComponent(SidebarComponent);
    const theme = TestBed.createComponent(ThemeComponent);
    sidebar.detectChanges();
    theme.detectChanges();

    const panel = theme.nativeElement.querySelector('.tc-panel') as HTMLElement;
    const link = themeSettingsLink(sidebar.nativeElement);
    const layout = TestBed.inject(LayoutService);

    expect(panel.classList).not.toContain('tc-panel--open');

    link.click();
    sidebar.detectChanges();
    theme.detectChanges();
    expect(layout.themePanelOpen).toBe(true);
    expect(panel.classList).toContain('tc-panel--open');
    expect(link.classList).toContain('active');
    expect(link.getAttribute('aria-expanded')).toBe('true');
    expect(document.documentElement.classList).toContain('theme-panel-open');

    link.click();
    sidebar.detectChanges();
    theme.detectChanges();
    expect(panel.classList).not.toContain('tc-panel--open');
    expect(link.getAttribute('aria-expanded')).toBe('false');
  }, 30_000);

  it('carries every picker in one scrolling panel, without the copyable colour palette', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();
    const root = theme.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).not.toContain('Color palette');
    expect(root.querySelector('.tc-palette-chip')).toBeNull();
    expect(text).toContain('Primary color');
    expect(text).toContain('Text size');
    expect(root.querySelector('app-theme-picker')).not.toBeNull();
  });

  it('switches the whole app to dark and back to light', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();
    const html = document.documentElement;

    theme.componentInstance.setThemeMode(true);
    expect(html.getAttribute('data-ydot-mode')).toBe('dark');
    // Bootstrap's partial dark variant stays off; the app's own layer does the work.
    expect(html.getAttribute('data-bs-theme')).toBe('light');

    theme.componentInstance.setThemeMode(false);
    expect(html.hasAttribute('data-ydot-mode')).toBe(false);
  });

  it('writes the overall and per-role text size and weight variables', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();
    const c = theme.componentInstance;
    const style = document.documentElement.style;

    c.setTextScale(1.16);
    expect(style.getPropertyValue('--ts-global')).toBe('1.16');

    c.stepSize('display', 2);
    expect(style.getPropertyValue('--ts-title')).toBe('1.12');
    expect(style.getPropertyValue('--ts-body')).toBe('1');

    c.stepWeight('number', 1);
    expect(style.getPropertyValue('--fwb-number')).toBe('100');
    expect(style.getPropertyValue('--fwb-menu')).toBe('0');

    c.setAllWeights(2);
    expect(style.getPropertyValue('--fwb-title')).toBe('200');
    expect(style.getPropertyValue('--fwb-menu')).toBe('200');

    c.resetTypography();
    expect(style.getPropertyValue('--ts-global')).toBe('1');
    expect(style.getPropertyValue('--ts-title')).toBe('1');
    expect(style.getPropertyValue('--fwb-title')).toBe('0');
  });
});
