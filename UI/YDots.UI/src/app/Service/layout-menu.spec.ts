import { TestBed } from '@angular/core/testing';

import { LayoutService } from './layout-service';

/**
 * The top bar's menu button: one button, a permanent-rail behaviour on a desktop and a drawer behaviour on a
 * phone. These pin the parts that were wrong: the drawer could be opened but never closed, and the button
 * had no state to show.
 */
describe('LayoutService menu', () => {
  let layout: LayoutService;
  let sidebar: HTMLElement;
  const html = document.documentElement;

  beforeEach(() => {
    sidebar = document.createElement('aside');
    sidebar.id = 'sidebar';
    document.body.appendChild(sidebar);
    html.setAttribute('data-sidebar', 'default');
    localStorage.clear();

    TestBed.configureTestingModule({});
    layout = TestBed.inject(LayoutService);
  });

  afterEach(() => {
    sidebar.remove();
    html.removeAttribute('data-sidebar');
    localStorage.clear();
  });

  it('folds and unfolds the rail on a desktop, and remembers the choice', () => {
    expect(layout.isDesktop()).toBe(true);

    layout.toggleMenu();
    expect(html.getAttribute('data-sidebar')).toBe('icon');
    expect(localStorage.getItem('data-sidebar')).toBe('icon');

    layout.toggleMenu();
    expect(html.getAttribute('data-sidebar')).toBe('default');
  });

  it('reports the menu as expanded until the rail is folded', async () => {
    expect(layout.menuExpanded()).toBe(true);

    layout.toggleMenu();
    // The attribute is observed with a MutationObserver, which reports on a microtask.
    await Promise.resolve();

    expect(layout.menuExpanded()).toBe(false);
  });

  it('opens and closes the drawer, and mirrors it on the sidebar element', () => {
    layout.openMobileMenu();
    expect(layout.mobileMenuOpen()).toBe(true);
    expect(sidebar.classList.contains('show')).toBe(true);

    layout.closeMobileMenu();
    expect(layout.mobileMenuOpen()).toBe(false);
    expect(sidebar.classList.contains('show')).toBe(false);
  });

  it('closes the open drawer on Escape', () => {
    layout.openMobileMenu();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(layout.mobileMenuOpen()).toBe(false);
    expect(sidebar.classList.contains('show')).toBe(false);
  });

  it('ignores other keys', () => {
    layout.openMobileMenu();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layout.mobileMenuOpen()).toBe(true);
  });
});
