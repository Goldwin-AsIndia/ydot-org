import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TopheaderComponent } from './topheader';

/** The bar is fixed: it stays put and visible however the page scrolls. */
describe('Topheader', () => {
  let fixture: ComponentFixture<TopheaderComponent>;
  let component: TopheaderComponent;

  function create(): void {
    fixture = TestBed.createComponent(TopheaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const header = (): HTMLElement => fixture.nativeElement.querySelector('#appHeader');

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [TopheaderComponent],
      providers: [provideRouter([]), provideHttpClient()],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    create();
    expect(component).toBeTruthy();
  });

  it('stays visible while the page scrolls', () => {
    create();

    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1000);

    expect(header().classList.contains('tb--hidden')).toBe(false);
    expect(document.documentElement.classList.contains('topbar-hidden')).toBe(false);
  });
});
