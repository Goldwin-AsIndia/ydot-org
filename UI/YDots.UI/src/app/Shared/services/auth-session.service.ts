import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthApiService } from '../../Service/auth-api.service';
import { AuthTokenService } from './auth-token.service';
import { ToastService } from './toast.service';
import { SignInResponse } from '../models/auth.model';

/**
 * Owns the *lifetime* of a signed-in session in the browser.
 *
 * TWO CLOCKS, NOT ONE
 * -------------------
 * • **The access token's clock** is the server's. It expires in about fifteen minutes and the
 *   interceptor renews it silently. The person never sees it.
 *
 * • **The idle clock** is this service's, and it is about the human, not the token. If nobody
 *   has touched the keyboard or mouse for the Organisation's idle window, the app stops trusting
 *   that the right person is still at the screen and sends them to /auth/reauthenticate. An
 *   unattended laptop in a shared office is exactly the risk this covers.
 *
 * The idle clock is a courtesy, not a security boundary — anyone can edit browser memory. The
 * real enforcement is the server's short token lifetime and its own session rules. This layer
 * exists so the app behaves sensibly, not so it is safe.
 *
 * WHY PEOPLE WHO WERE WORKING WERE ASKED FOR THEIR PASSWORD
 * ---------------------------------------------------------
 * The clock only started when a sign-in finished on this page. A reload — F5, or the layout's
 * reset button — kept the identity (it lives in sessionStorage) but started nothing: no
 * activity listener and no timer. The last-activity stamp then stood still while the person
 * went on working, and the first navigation after the window had passed sent them to the
 * password screen in the middle of a task. The clock now starts whenever an identity is held,
 * at application start as well as at sign-in (see `app.config.ts`).
 *
 * Activity is listened for in the CAPTURE phase, so a component that stops a click from
 * bubbling — dialogs and dropdowns here do — cannot hide it, and a scroll inside a panel counts
 * as well as a scroll of the page.
 *
 * THE WINDOW IS THE ORGANISATION'S. It used to be `environment.sessionIdleMinutes` alone, so the
 * "Idle sign-out" an administrator set on Organisation Settings changed nothing. The server's
 * `GET /users/session` answers with the Organisation's window (never longer than the platform's)
 * and the environment value is only the fallback until it does.
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly tokens = inject(AuthTokenService);
  private readonly authApi = inject(AuthApiService);

  private static readonly LAST_ACTIVITY_KEY = 'ydot.lastActivityAt';
  private static readonly IDLE_MINUTES_KEY = 'ydot.idleMinutes';
  private static readonly ACTIVITY_EVENTS = [
    'pointerdown', 'click', 'keydown', 'mousemove', 'wheel', 'scroll', 'touchstart', 'input',
  ];

  /** Set while the app is waiting for the person to confirm it is still them. */
  private readonly reauthRequiredState = signal(false);
  readonly reauthRequired = this.reauthRequiredState.asReadonly();

  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private listenersAttached = false;

  constructor() {
    // A page that was reloaded while signed in: carry on the clock it had. Nothing else would
    // start it, because startSession() runs only when a sign-in screen finishes.
    if (this.tokens.user()) {
      this.attachActivityListeners();
      this.startIdleTimer();
      this.loadIdleWindow();
    }
  }

  // =========================================================================================
  // Starting and ending
  // =========================================================================================

  /**
   * Stores the tokens and identity from a successful sign-in, MFA verification or activation,
   * and starts the idle clock. Call this once, from whichever screen finished the sign-in.
   */
  startSession(response: SignInResponse): void {
    // storeSignIn takes the whole response: the token, the identity and the Organisation the
    // session is operating in all arrive together and are stored together, so a screen can
    // never end up with an identity but no Organisation to render beside it.
    this.tokens.storeSignIn(response);

    this.reauthRequiredState.set(false);
    this.markActivity();
    this.attachActivityListeners();
    this.startIdleTimer();
    this.loadIdleWindow();
  }

  /** Called after a successful reauthentication: new tokens, clock reset, back to work. */
  resumeSession(): void {
    this.reauthRequiredState.set(false);
    this.markActivity();
    this.attachActivityListeners();
    this.startIdleTimer();
    this.toast.show('Welcome back', 'Your session has been confirmed.', 'success');
  }

  /**
   * Signs out. The server call revokes the session and clears the HttpOnly cookie; the local
   * clear-out happens either way, so a network failure can never strand somebody signed in.
   */
  endSession(signOutEverywhere = false): void {
    const finish = () => {
      this.tokens.clear();
      this.removeStored(AuthSessionService.LAST_ACTIVITY_KEY);
      this.removeStored(AuthSessionService.IDLE_MINUTES_KEY);
      this.reauthRequiredState.set(false);
      this.stopIdleTimer();
      void this.router.navigate(['/auth/sign-in']);
    };

    if (this.tokens.getAccessToken()) {
      this.authApi.signOut(signOutEverywhere).subscribe({ next: finish, error: finish });
      return;
    }

    finish();
  }

  // =========================================================================================
  // Queries used by the guard and the shell
  // =========================================================================================

  isAuthenticated(): boolean {
    // A stale access token is fine on its own: the interceptor renews it from the cookie on the
    // next call. What matters here is whether an identity is held at all.
    return this.tokens.user() !== null && !this.reauthRequiredState();
  }

  isReauthRequired(): boolean {
    return this.reauthRequiredState();
  }

  /** True when nobody has interacted for longer than the idle window. */
  isIdleTimedOut(): boolean {
    const last = this.lastActivityAt();
    if (!last) {
      return false;
    }

    return Date.now() - last > this.idleWindowMs();
  }

  /** Milliseconds left before the idle window closes. Drives the countdown on the shell. */
  get remainingIdleMs(): number {
    const last = this.lastActivityAt();
    if (!last) {
      return this.idleWindowMs();
    }

    return Math.max(0, last + this.idleWindowMs() - Date.now());
  }

  /** Marks the session as needing a fresh confirmation of identity. */
  requireReauth(reason = 'Your session has been idle.'): void {
    if (this.reauthRequiredState()) {
      return;
    }

    this.reauthRequiredState.set(true);
    this.stopIdleTimer();
    this.toast.show('Confirm it is you', reason, 'warning');

    // Back to the same page afterwards, as the route guard already arranges.
    const returnUrl = this.router.url && !this.router.url.startsWith('/auth') ? this.router.url : undefined;
    void this.router.navigate(['/auth/reauthenticate'], returnUrl ? { queryParams: { returnUrl } } : undefined);
  }

  // =========================================================================================
  // The idle window
  // =========================================================================================

  /**
   * Asks the server for the Organisation's idle window and keeps it beside the activity stamp,
   * so the guard has it straight after a reload. A failure keeps whatever was known - the
   * stored value, else the environment's.
   */
  private loadIdleWindow(): void {
    this.authApi.getSession().subscribe({
      next: (session) => {
        const minutes = session?.idleTimeoutMinutes;
        if (typeof minutes === 'number' && minutes > 0) {
          this.writeStored(AuthSessionService.IDLE_MINUTES_KEY, String(minutes));
        }
      },
      error: () => undefined,
    });
  }

  private idleWindowMs(): number {
    const stored = Number(this.readStored(AuthSessionService.IDLE_MINUTES_KEY) ?? 0);
    const minutes = stored > 0 ? stored : environment.sessionIdleMinutes;
    return minutes * 60_000;
  }

  // =========================================================================================
  // Idle tracking
  // =========================================================================================

  private attachActivityListeners(): void {
    if (this.listenersAttached) {
      return;
    }

    AuthSessionService.ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, this.onUserActivity, { passive: true, capture: true });
    });

    this.listenersAttached = true;
  }

  private readonly onUserActivity = (): void => {
    if (!this.tokens.user() || this.reauthRequiredState()) {
      return;
    }

    // Activity after the window had already closed does not reopen it: whoever is at the
    // keyboard now still has to prove who they are. The timer below catches it within a minute.
    if (this.isIdleTimedOut()) {
      return;
    }

    // Mouse movement fires constantly, so the timestamp is only rewritten every thirty seconds.
    // Without that throttle this would be one localStorage write per animation frame.
    if (Date.now() - this.lastActivityAt() > 30_000) {
      this.markActivity();
    }
  };

  private markActivity(): void {
    this.writeStored(AuthSessionService.LAST_ACTIVITY_KEY, String(Date.now()));
  }

  private lastActivityAt(): number {
    return Number(this.readStored(AuthSessionService.LAST_ACTIVITY_KEY) ?? 0);
  }

  private startIdleTimer(): void {
    this.stopIdleTimer();

    // Once a minute is precise enough for a window measured in tens of minutes, and costs
    // nothing. A per-second timer would keep the tab awake for no benefit.
    this.idleTimer = setInterval(() => {
      if (!this.tokens.user() || this.reauthRequiredState()) {
        return;
      }

      if (this.isIdleTimedOut()) {
        this.requireReauth('Your session has been idle for a while.');
      }
    }, 60_000);
  }

  private stopIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // localStorage can be unavailable (blocked site data, some private windows). The idle clock is
  // a courtesy, so it degrades to "never idle" rather than breaking the page.

  private readStored(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStored(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Nothing to do: see above.
    }
  }

  private removeStored(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to do: see above.
    }
  }
}
