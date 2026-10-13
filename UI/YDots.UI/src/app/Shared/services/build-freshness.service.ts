import { Injectable } from '@angular/core';

/**
 * Reloads a tab that is still running a build older than the one being served.
 *
 * WHY THIS EXISTS. A tab left open across a deployment keeps the old JavaScript in memory: signing
 * out and in again never reloads the page, so the person goes on running code the server has
 * already replaced. On 2026-10-13 that kept a fixed sign-in step looking broken - the server sent
 * the e-mailed code, and the old code in the tab still went nowhere with it.
 *
 * HOW. The production build references its entry script by a content-hashed name
 * (`main-XXXXXXXX.js`), and index.html is served with no-cache. The sign-in page fetches
 * index.html and compares the two names; when they differ, a newer build is live and the page
 * reloads once to pick it up. The development server serves an unhashed `main.js`, so nothing
 * happens there.
 */
@Injectable({ providedIn: 'root' })
export class BuildFreshnessService {
  /** The build this tab already reloaded for, so a mis-served page can never cause a loop. */
  private static readonly RELOADED_FOR_KEY = 'ydot.reloadedForBuild';

  private static readonly ENTRY_SCRIPT = /^\/?(main-[A-Za-z0-9]+\.js)$/;

  async reloadIfStale(): Promise<void> {
    const running = this.runningBuild();
    if (!running) {
      return;
    }

    try {
      const response = await fetch('/index.html', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }

      const served = /src="\/?(main-[A-Za-z0-9]+\.js)"/.exec(await response.text())?.[1];
      if (!served || served === running || sessionStorage.getItem(BuildFreshnessService.RELOADED_FOR_KEY) === served) {
        return;
      }

      sessionStorage.setItem(BuildFreshnessService.RELOADED_FOR_KEY, served);
      window.location.reload();
    } catch {
      // Offline or the server is restarting: the sign-in form reports that on its own.
    }
  }

  private runningBuild(): string | null {
    for (const script of Array.from(document.scripts)) {
      const match = BuildFreshnessService.ENTRY_SCRIPT.exec(script.getAttribute('src') ?? '');
      if (match) {
        return match[1];
      }
    }

    return null;
  }
}
