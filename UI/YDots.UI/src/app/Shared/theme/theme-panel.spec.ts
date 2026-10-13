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
 * The customiser panel opens from the Settings button on the Profile page, which calls
 * LayoutService.openThemePanel(). The sidebar carries no "Theme Settings" entry of its own.
 */
describe('Theme settings panel', () => {
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

  it('is not offered in the sidebar', () => {
    const sidebar = TestBed.createComponent(SidebarComponent);
    sidebar.detectChanges();

    const text = (sidebar.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Theme Settings');
  }, 30_000);

  it('opens from the Profile page and closes again', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();

    const panel = theme.nativeElement.querySelector('.tc-panel') as HTMLElement;
    const layout = TestBed.inject(LayoutService);

    expect(panel.classList).not.toContain('tc-panel--open');

    layout.openThemePanel();
    theme.detectChanges();
    expect(panel.classList).toContain('tc-panel--open');
    expect(document.documentElement.classList).toContain('theme-panel-open');

    layout.closeThemePanel();
    theme.detectChanges();
    expect(panel.classList).not.toContain('tc-panel--open');
  });

  it('carries every picker in one scrolling panel, without the copyable colour palette', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();
    const root = theme.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).not.toContain('Color palette');
    expect(root.querySelector('.tc-palette-chip')).toBeNull();
    // Panel copy was redesigned (British spelling + renamed sliders) — assert against the live labels.
    expect(text).toContain('Primary colour');
    expect(text).toContain('Overall size');
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

  it('applies the picked profile photo across the shell and clears it on reset', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();
    const c = theme.componentInstance;
    const html = document.documentElement;

    c.selectProfile('https://example.com/me.png');
    // The class is the switch the global CSS keys the badges on (top bar, profile, identifier page).
    expect(html.classList).toContain('has-profile-photo');
    expect(html.style.getPropertyValue('--profile-image')).toContain('example.com/me.png');

    // Reset must clear both — the old photo used to leak through resetTheme().
    c.resetTheme();
    expect(html.classList).not.toContain('has-profile-photo');
    expect(html.style.getPropertyValue('--profile-image')).toBe('');
  });

  it('writes heading colour, shadow strength and radii where every screen reads them', () => {
    const theme = TestBed.createComponent(ThemeComponent);
    theme.detectChanges();
    const c = theme.componentInstance;
    const style = document.documentElement.style;

    c.setHeadingPreset('#00af43');
    expect(style.getPropertyValue('--heading-color')).toBe('#00af43');

    c.onShadowInput({ target: { value: '30' } } as unknown as Event);
    expect(style.getPropertyValue('--shadow-strength')).toBe('0.30');

    c.onBorderRadiusInput({ target: { value: '22' } } as unknown as Event);
    expect(style.getPropertyValue('--radius')).toBe('22px');

    c.onButtonRadiusInput({ target: { value: '14' } } as unknown as Event);
    expect(style.getPropertyValue('--btn-radius')).toBe('14px');
  });
});
