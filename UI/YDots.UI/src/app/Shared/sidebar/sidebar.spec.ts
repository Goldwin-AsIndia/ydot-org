import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { LayoutService } from '../../Service/layout-service';
import { MenuNode } from '../models/auth.model';
import { AuthTokenService } from '../services/auth-token.service';
import { CurrentUserService } from '../services/current-user.service';
import { NavigationService } from '../services/navigation.service';
import { SidebarComponent } from './sidebar';

@Component({ standalone: true, template: '' })
class PageStub {}

/**
 * The three levels the sidebar renders, in the shape the Administration group arrives in:
 * a top-level group, a sub-group inside it, and the page at the end of the chain.
 */
const MENU: MenuNode[] = [
  {
    id: 'administration',
    code: 'ADMINISTRATION',
    name: 'Administration',
    hasChildren: true,
    children: [
      {
        id: 'access-and-identity',
        code: 'ACCESS_AND_IDENTITY',
        name: 'Access and Identity',
        hasChildren: true,
        children: [
          {
            id: 'user-directory',
            code: 'USER_DIRECTORY',
            name: 'User Directory',
            route: '/app/administration/access/user-directory',
            hasChildren: false,
          },
          {
            id: 'role-and-permission-catalogue',
            code: 'ROLE_AND_PERMISSION_CATALOGUE',
            name: 'Role and permission catalogue',
            route: '/app/administration/access/role-and-permission-catalogue',
            hasChildren: false,
          },
        ],
      },
    ],
  },
];

/** Only the handful of members the sidebar template and class actually read. */
class NavigationStub {
  readonly menu = () => MENU;
  readonly loading = () => false;
  readonly failed = () => false;
  load() {
    return of(undefined);
  }
  iconClass() {
    return 'ri-circle-line';
  }
  collapseId(node: MenuNode) {
    return 'menu-' + (node.code ?? node.id ?? '').toLowerCase();
  }
}

class LayoutStub {
  themePanelOpen = false;
  themeMenuOpen = false;
  closeThemePanel() {}
  closeMobileMenu() {}
  toggleThemePanel() {}
  toggleThemeMenu() {}
  openThemeSection() {}
}

class TokensStub {
  organisationName() {
    return '';
  }
  isActingInOrganisation() {
    return false;
  }
}

class CurrentUserStub {
  hasPermission() {
    return false;
  }
}

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([
          { path: 'app/administration/access/user-directory', component: PageStub },
          { path: 'app/administration/access/user-directory/:id/edit', component: PageStub },
          { path: 'app/administration/access/user-directory-archive', component: PageStub },
          { path: 'app/administration/access/role-and-permission-catalogue', component: PageStub },
        ]),
        { provide: NavigationService, useValue: new NavigationStub() },
        { provide: LayoutService, useValue: new LayoutStub() },
        { provide: AuthTokenService, useValue: new TokensStub() },
        { provide: CurrentUserService, useValue: new CurrentUserStub() },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  /** The top-level "Administration" row. */
  function administrationRow(): HTMLElement {
    return fixture.nativeElement.querySelector('.pe-main-menu > li.pe-slide') as HTMLElement;
  }

  /** The "Access and Identity" sub-group nested under Administration. */
  function accessGroupRow(): HTMLElement {
    return administrationRow().querySelector(
      'ul.pe-slide-menu > li.pe-slide-item.pe-has-sub',
    ) as HTMLElement;
  }

  /** The leaf anchor whose visible label matches. */
  function leafAnchor(label: string): HTMLElement {
    const anchors = Array.from(
      fixture.nativeElement.querySelectorAll('.pe-slide-menu .pe-slide-item > a.pe-nav-link'),
    ) as HTMLElement[];
    return anchors.find((a) => (a.textContent ?? '').trim() === label) as HTMLElement;
  }

  async function go(url: string): Promise<void> {
    await router.navigateByUrl(url);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('lights the whole ladder — page, sub-group and top-level group — for the open page', async () => {
    await go('/app/administration/access/user-directory');

    expect(leafAnchor('User Directory').classList.contains('active')).toBe(true);
    expect(accessGroupRow().classList.contains('active')).toBe(true);
    expect(administrationRow().classList.contains('active')).toBe(true);
  });

  it('keeps the page lit on a detail screen beneath it', async () => {
    await go('/app/administration/access/user-directory/123/edit');

    expect(leafAnchor('User Directory').classList.contains('active')).toBe(true);
    expect(accessGroupRow().classList.contains('active')).toBe(true);
    expect(administrationRow().classList.contains('active')).toBe(true);
  });

  it('does not light a sibling whose path merely starts the same', async () => {
    await go('/app/administration/access/user-directory-archive');

    expect(leafAnchor('User Directory').classList.contains('active')).toBe(false);
  });

  it('marks only the open branch, leaving a sibling page inactive', async () => {
    await go('/app/administration/access/role-and-permission-catalogue');

    expect(leafAnchor('Role and permission catalogue').classList.contains('active')).toBe(true);
    expect(leafAnchor('User Directory').classList.contains('active')).toBe(false);
    // The shared ancestors are still lit, because they lead to this page too.
    expect(accessGroupRow().classList.contains('active')).toBe(true);
    expect(administrationRow().classList.contains('active')).toBe(true);
  });
});

