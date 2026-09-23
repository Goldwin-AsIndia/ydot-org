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
    // jsdom resolves styles slowly against the full stylesheet, and opening the panel reads the palette from the page
  }, 30_000);

  it('carries the colour palette section and every picker in one scrolling panel', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();
    const text = (theme.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Color palette');
    expect(text).toContain('Primary color');
    expect((theme.nativeElement as HTMLElement).querySelector('app-theme-picker')).not.toBeNull();
  });
});
