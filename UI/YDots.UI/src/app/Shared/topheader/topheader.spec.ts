import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TopheaderComponent } from './topheader';

/**
 * The bar stays visible at all times and only hides while the page is actually being scrolled, coming
 * back on its own once scrolling settles. There is no hover-to-reveal any more: these pin the rules a
 * person would notice breaking - it starts visible, scrolling hides it, it returns after a quiet spell,
 * and it never disappears from under an open menu.
 */
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

  it('starts visible', () => {
    create();
    fixture.detectChanges();

    expect(component.barHidden()).toBe(false);
    expect(header().classList.contains('tb--hidden')).toBe(false);
  });

  it('hides as soon as the page scrolls', () => {
    create();

    document.dispatchEvent(new Event('scroll'));

    expect(component.barHidden()).toBe(true);
  });

  it('comes back on its own once scrolling settles, with no pointer needed', () => {
    create();

    document.dispatchEvent(new Event('scroll'));
    expect(component.barHidden()).toBe(true);

    vi.advanceTimersByTime(400);
    expect(component.barHidden()).toBe(false);
  });

  it('stays hidden while scrolling continues', () => {
    create();

    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(200);

    expect(component.barHidden()).toBe(true);
  });

  it('ignores scrolling inside the bar itself, such as a long menu', () => {
    create();

    header().dispatchEvent(new Event('scroll'));

    expect(component.barHidden()).toBe(false);
  });

  describe('the page follows the bar', () => {
    const root = document.documentElement;

    /** The bar's height in a real layout (a test DOM has none), and where the page is scrolled to. */
    function layout(barHeight: number, scrollY: number): { scrollTo: ReturnType<typeof vi.fn> } {
      Object.defineProperty(header(), 'offsetHeight', { configurable: true, value: barHeight });
      Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
      const scrollTo = vi.fn();
      window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
      return { scrollTo };
    }

    afterEach(() => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    });

    it('gives the strip back while the bar is hidden, and takes it again when it returns', () => {
      create();
      expect(root.classList.contains('topbar-hidden')).toBe(false);

      document.dispatchEvent(new Event('scroll'));
      expect(root.classList.contains('topbar-hidden')).toBe(true);

      vi.advanceTimersByTime(400);
      expect(root.classList.contains('topbar-hidden')).toBe(false);
    });

    it('cleans up after itself when the bar goes away', () => {
      create();

      fixture.destroy();

      expect(root.classList.contains('topbar-hidden')).toBe(false);
      expect(root.classList.contains('topbar-auto')).toBe(false);
    });

    it('slides the page with the bar when the top of the page is on screen (no scroll correction)', () => {
      create();
      const { scrollTo } = layout(74, 0);

      document.dispatchEvent(new Event('scroll'));

      expect(root.classList.contains('topbar-instant')).toBe(false);
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('keeps what you are reading still when the bar hides far down the page', () => {
      create();
      const { scrollTo } = layout(74, 500);

      document.dispatchEvent(new Event('scroll'));

      // The strip is off screen: the padding goes at once and the scroll moves by exactly that much.
      expect(scrollTo).toHaveBeenCalledWith({ top: 426, behavior: 'instant' });
      expect(root.classList.contains('topbar-instant')).toBe(false);
    });

    it('keeps what you are reading still when the bar returns far down the page', () => {
      create();
      const { scrollTo } = layout(74, 426);

      document.dispatchEvent(new Event('scroll'));
      scrollTo.mockClear();

      vi.advanceTimersByTime(400);

      expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'instant' });
    });
  });

  it('shows itself when keyboard focus reaches it', () => {
    create();
    document.dispatchEvent(new Event('scroll'));
    expect(component.barHidden()).toBe(true);

    header().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(component.barHidden()).toBe(false);
  });
});
