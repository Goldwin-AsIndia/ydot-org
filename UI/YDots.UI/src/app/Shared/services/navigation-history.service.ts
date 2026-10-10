import { Injectable, inject } from '@angular/core';
import { NavigationEnd, NavigationStart, Router, NavigationExtras } from '@angular/router';

/**
 * Remembers which screen each screen was opened from, so "Back" returns to where the person
 * actually came from instead of to one fixed screen.
 *
 * The same button (a Donor 360 link, "Edit profile", a follow-up) is reachable from several
 * screens, and every one of those screens used to hard-code a single destination for its Back
 * button. This keeps the trail of in-app screens; `back()` goes to the one before the current
 * screen, and only when there is no trail (a bookmark, a refresh) does it use the fallback.
 *
 * Query-string changes on the same screen (tabs, filters, an open panel) replace the current
 * entry rather than adding one, so they never become a "previous screen".
 */
@Injectable({ providedIn: 'root' })
export class NavigationHistoryService {
  private readonly router = inject(Router);
  private stack: string[] = [];
  private popstate = false;
  private installed = false;

  install(): void {
    if (this.installed) return;
    this.installed = true;

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.popstate = event.navigationTrigger === 'popstate';
      } else if (event instanceof NavigationEnd) {
        this.record(event.urlAfterRedirects);
      }
    });
  }

  /** Goes to the screen this one was opened from, or to `fallback` when there is none. */
  back(fallback: string | unknown[], extras?: NavigationExtras): void {
    const previous = this.stack.length > 1 ? this.stack[this.stack.length - 2] : null;

    if (previous && previous.startsWith('/app/')) {
      void this.router.navigateByUrl(previous);
      return;
    }

    if (typeof fallback === 'string') {
      void this.router.navigateByUrl(fallback, extras);
    } else {
      void this.router.navigate(fallback, extras);
    }
  }

  private record(url: string): void {
    const path = this.pathOf(url);

    if (this.popstate) {
      const at = this.stack.map((entry) => this.pathOf(entry)).lastIndexOf(path);
      if (at >= 0) {
        this.stack = this.stack.slice(0, at + 1);
        this.stack[at] = url;
        return;
      }
    }

    const last = this.stack.length - 1;

    // Same screen, new query: the entry is replaced.
    if (last >= 0 && this.pathOf(this.stack[last]) === path) {
      this.stack[last] = url;
      return;
    }

    // Going back to the screen before this one (e.g. after a save) unwinds instead of looping.
    if (last >= 1 && this.pathOf(this.stack[last - 1]) === path) {
      this.stack = this.stack.slice(0, last);
      this.stack[last - 1] = url;
      return;
    }

    this.stack.push(url);
    if (this.stack.length > 50) this.stack.shift();
  }

  private pathOf(url: string): string {
    return url.split('?')[0].split('#')[0];
  }
}
