import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { POPUP_PANEL_SELECTORS } from './popup-registry';

/** Panels that are tools rather than form pop-ups (theme panel, icon picker, search palette, calendars). */
const FREE = '[data-popup-free], app-theme, app-icon-picker, app-global-search, .sh-palette, .ip-panel, .tc-panel';

/** Anything that announces itself as a pop-up, plus every dialog / drawer class the dialog design knows. */
const PANEL = [
  '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', 'dialog[open]', '.yp-modal',
  ...POPUP_PANEL_SELECTORS,
].join(', ');

const HEADER = ':is(header, [class*="-head"]:not([class*="-heading"]), [class*="__head"], [class*="-header"], '
  + '[class*="__header"], [class*="-modal-top"], [class*="-dialog-top"], [class*="__top"], .pn-top, .modal-header)';

/** Buttons whose only job is to close the pop-up they sit in. */
const DISMISS_LABELS = new Set([
  'close', 'cancel', 'dismiss', 'done', 'ok', 'okay', 'got it', 'not now', 'never mind', 'no thanks',
  'keep editing', 'go back', 'close preview',
]);
const ICON_ONLY = new Set(['', '×', '✕', '✖', 'x', 'X', '✗']);

const HINT_TEXT = 'Use the ✕ button at the top right to close this pop-up';

/**
 * ONE WAY TO CLOSE EVERY POP-UP.
 *
 *  1. A pop-up (dialog or off-canvas drawer) closes from its X at the top right and from nowhere else:
 *     a click on the dimmed area around it does not close it.
 *  2. That outside click is answered instead: the pop-up gives a short shake, the X pulses and a small hint
 *     points at it, so nobody is left wondering why nothing happened.
 *  3. Every pop-up shows exactly one close control. A pop-up without an X gets one; footer buttons that
 *     only close it (Close, Cancel, Done, OK ...) are hidden, and the X presses the first of them, so
 *     each screen's own close logic (discard checks, busy states) still runs.
 *
 * Like the shared calendar and the input filter it takes over without the screens opting in. A tool panel
 * that should keep its own behaviour carries `data-popup-free`.
 */
@Injectable({ providedIn: 'root' })
export class PopupGuardService {
  private readonly doc = inject(DOCUMENT);
  private installed = false;
  private pressedOn: EventTarget | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private hint: HTMLElement | null = null;
  /** Set while the X presses the scrim itself, so that one click gets through. */
  private bypass = false;

  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;

    // Capture phase on the document: runs before any handler a screen put on its backdrop.
    for (const type of ['pointerdown', 'mousedown']) {
      this.doc.addEventListener(type, (event) => {
        this.pressedOn = event.target;
        if (!this.bypass && this.outsideTarget(event)) event.stopImmediatePropagation();
      }, true);
    }
    for (const type of ['mouseup', 'pointerup', 'dblclick', 'auxclick']) {
      this.doc.addEventListener(type, (event) => {
        if (!this.bypass && this.outsideTarget(event)) event.stopImmediatePropagation();
      }, true);
    }
    this.doc.addEventListener('click', (event) => {
      if (this.bypass) return;
      const panel = this.outsideTarget(event);
      if (!panel) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      // Only a press that began on the backdrop is "a click outside"; dragging a text selection out of a
      // field and letting go over the backdrop is not.
      if (this.pressedOn === event.target) this.nudge(panel);
    }, true);

    const observer = new MutationObserver(() => this.schedule());
    observer.observe(this.doc.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class', 'hidden'],
    });
    this.schedule();
  }

  // ───────────────────────────── outside clicks ─────────────────────────────

  /** The pop-up a backdrop click belongs to, or null when the event did not land on a pop-up's backdrop. */
  private outsideTarget(event: Event): HTMLElement | null {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(FREE)) return null;
    const point = event as MouseEvent;

    // A native modal <dialog>: a click on its ::backdrop reports the dialog itself, outside its own box.
    if (target instanceof HTMLDialogElement) {
      if (!target.open) return null;
      const box = target.getBoundingClientRect();
      const inside = point.clientX >= box.left && point.clientX <= box.right
        && point.clientY >= box.top && point.clientY <= box.bottom;
      if (!inside) return target;
      // A dialog that fills the screen around one inner sheet: the click is outside when it misses the sheet.
      const sheet = target.firstElementChild as HTMLElement | null;
      if (sheet && this.coversViewport(target)) {
        const s = sheet.getBoundingClientRect();
        const onSheet = point.clientX >= s.left && point.clientX <= s.right
          && point.clientY >= s.top && point.clientY <= s.bottom;
        return onSheet ? null : target;
      }
      return null;
    }

    // A backdrop / wrapper: a fixed layer over the whole screen with a pop-up inside or beside it.
    if (!this.coversViewport(target)) return null;
    const panel = this.panelFor(target);
    return panel;
  }

  private coversViewport(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'absolute') return false;
    const box = el.getBoundingClientRect();
    // A scrim beside an off-canvas drawer stops at the drawer's edge, so it may be well under the full width;
    // it still spans the full height. (A panel must sit next to it, see panelFor, so nothing else matches.)
    return box.width >= window.innerWidth * 0.4 && box.height >= window.innerHeight * 0.9;
  }

  private panelFor(backdrop: HTMLElement): HTMLElement | null {
    const visible = (el: Element | null): el is HTMLElement => {
      if (!(el instanceof HTMLElement) || el === backdrop || el.closest(FREE)) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    // Inside the wrapper (Bootstrap .modal > .modal-dialog, .overlay > .dialog).
    const inner = Array.from(backdrop.querySelectorAll(PANEL)).find(visible);
    if (inner) return inner;
    // Beside the backdrop (a scrim that is the dialog's previous or next sibling).
    for (const sibling of [backdrop.nextElementSibling, backdrop.previousElementSibling]) {
      if (!sibling) continue;
      if (sibling.matches(PANEL) && visible(sibling)) return sibling as HTMLElement;
      const nested = Array.from(sibling.querySelectorAll(PANEL)).find(visible);
      if (nested) return nested;
    }
    // The backdrop is itself the pop-up's wrapper element (role="dialog" on a full-screen layer).
    if (backdrop.matches(PANEL)) return backdrop;
    return null;
  }

  // ───────────────────────────── the answer to an outside click ─────────────────────────────

  private nudge(panel: HTMLElement): void {
    const host = panel.closest('dialog') ?? panel;
    const x = panel.querySelector<HTMLElement>('[data-yp-x]') ?? this.findIconClose(panel);

    // A short shake on `translate`, so a pop-up that centres itself with transform keeps its place.
    host.animate(
      [
        { translate: '0 0' }, { translate: '-8px 0' }, { translate: '7px 0' }, { translate: '-5px 0' },
        { translate: '3px 0' }, { translate: '0 0' },
      ],
      { duration: 420, easing: 'ease-in-out' },
    );
    if (!x) return;

    const ring = getComputedStyle(x).color || 'currentColor';
    x.animate(
      [
        { boxShadow: `0 0 0 0 color-mix(in srgb, ${ring} 55%, transparent)` },
        { boxShadow: `0 0 0 9px color-mix(in srgb, ${ring} 0%, transparent)` },
      ],
      { duration: 700, iterations: 2, easing: 'ease-out' },
    );
    this.showHint(x);
  }

  private showHint(x: HTMLElement): void {
    const anchor = x.offsetParent as HTMLElement | null;
    if (!anchor || anchor === this.doc.body) return;
    this.hint?.remove();
    const hint = this.doc.createElement('div');
    hint.className = 'yp-close-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = HINT_TEXT;
    hint.style.top = `${x.offsetTop + x.offsetHeight + 8}px`;
    hint.style.right = `${Math.max(8, anchor.clientWidth - (x.offsetLeft + x.offsetWidth))}px`;
    anchor.appendChild(hint);
    this.hint = hint;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      hint.remove();
      if (this.hint === hint) this.hint = null;
    }, 2600);
  }

  // ───────────────────────────── one X per pop-up ─────────────────────────────

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sweep();
    }, 60);
  }

  private sweep(): void {
    const panels = Array.from(this.doc.querySelectorAll<HTMLElement>(PANEL));
    for (const panel of panels) {
      if (panel.closest(FREE)) continue;
      // Work on the innermost panel: a role="dialog" wrapper around a .modal-content is one pop-up, not two.
      if (panel.querySelector(PANEL)) continue;
      this.normalise(panel);
    }
  }

  private normalise(panel: HTMLElement): void {
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>('button, a[role="button"]'))
      .filter((b) => !b.closest('.yp-close-hint'));

    const icons = buttons.filter((b) => this.isIconClose(b));
    const dismiss = buttons.filter((b) => !icons.includes(b) && this.isDismiss(b));

    // Footer buttons that only close the pop-up are replaced by the X.
    for (const b of dismiss) b.setAttribute('data-yp-dismiss', '');
    this.hideEmptyParents(dismiss, panel);

    // Exactly one X: keep the first, hide any others.
    const [first, ...extra] = icons;
    for (const b of extra) b.setAttribute('data-yp-dismiss', '');
    if (first) {
      first.setAttribute('data-yp-x', '');
      return;
    }
    if (panel.querySelector('[data-yp-x]')) return;
    this.inject(panel);
  }

  private inject(panel: HTMLElement): void {
    const header = Array.from(panel.querySelectorAll<HTMLElement>(HEADER))
      .find((h) => !h.closest('footer') && h.closest(PANEL) === panel) ?? null;
    const host = header ?? panel;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const x = this.doc.createElement('button');
    x.type = 'button';
    x.className = 'yp-x ydot-auto-close';
    x.setAttribute('aria-label', 'Close');
    x.setAttribute('data-yp-x', '');
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    x.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeFromX(panel);
    });
    host.appendChild(x);
  }

  /** The injected X presses what the screen already offered for closing, so its own logic still runs. */
  private closeFromX(panel: HTMLElement): void {
    const own = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-yp-dismiss]'))
      .find((b) => !(b as HTMLButtonElement).disabled && !b.hasAttribute('data-yp-x'));
    if (own) {
      own.click();
      return;
    }
    const dialog = panel.closest('dialog');
    if (dialog) {
      if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
      return;
    }
    // Nothing on the screen closes it but a click on the backdrop: let exactly one through.
    const backdrop = this.backdropOf(panel);
    if (!backdrop) return;
    this.bypass = true;
    try {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } finally {
      this.bypass = false;
    }
  }

  private backdropOf(panel: HTMLElement): HTMLElement | null {
    for (let el: HTMLElement | null = panel; el && el !== this.doc.body; el = el.parentElement) {
      const sibling = [el.previousElementSibling, el.nextElementSibling]
        .find((s) => s instanceof HTMLElement && /backdrop|scrim|overlay/i.test(s.className.toString()));
      if (sibling) return sibling as HTMLElement;
      if (el !== panel && this.coversViewport(el)) return el;
    }
    return null;
  }

  // ───────────────────────────── recognising buttons ─────────────────────────────

  private findIconClose(panel: HTMLElement): HTMLElement | null {
    return Array.from(panel.querySelectorAll<HTMLElement>('button, a[role="button"]')).find((b) => this.isIconClose(b)) ?? null;
  }

  /** An icon-only button that closes: an X / × glyph with a close-named class or label, and no words. */
  private isIconClose(b: HTMLElement): boolean {
    return this.looksLikeX(b);
  }

  private looksLikeX(b: HTMLElement): boolean {
    if (!ICON_ONLY.has((b.textContent ?? '').trim())) return false;
    const label = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''}`;
    const cls = b.className.toString();
    return /^\s*(close|dismiss)/i.test(label)
      || /(^|[\s_-])(close|x|cls)([\s_-]|$)|btn-close|icon-close|-close\b|__close\b/i.test(cls);
  }

  private isDismiss(b: HTMLElement): boolean {
    const text = (b.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!DISMISS_LABELS.has(text)) return false;
    // "Done" on a calendar or picker applies a choice; it does not close a pop-up.
    if (b.closest('[class*="calendar"], [class*="-cal"], [class*="cal-"], [class*="cal__"], [class*="picker"], [class*="dp-"]')) return false;
    return (b as HTMLButtonElement).type !== 'submit';
  }

  /** A footer left with nothing visible once its close buttons are hidden is hidden too. */
  private hideEmptyParents(hidden: HTMLElement[], panel: HTMLElement): void {
    for (const b of hidden) {
      let parent = b.parentElement;
      while (parent && parent !== panel && !parent.matches(PANEL)) {
        const children = Array.from(parent.children) as HTMLElement[];
        const allHidden = children.length > 0 && children.every((c) => c.hasAttribute('data-yp-dismiss'));
        if (!allHidden) break;
        parent.setAttribute('data-yp-dismiss', '');
        parent = parent.parentElement;
      }
    }
  }
}
