import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

type PickerKind = 'date' | 'datetime-local';
type PickerMode = 'days' | 'months';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * ONE CALENDAR FOR EVERY DATE FIELD IN THE APP.
 *
 * The browser's own date picker cannot be styled and only opens from its small calendar glyph. This
 * service takes over every `<input type="date">` and `<input type="datetime-local">` without touching
 * the screens: a click anywhere in the field (or Alt+Down / F4, or a screen calling `showPicker()`)
 * opens the shared "ydp" calendar (styles in src/styles/ydot-datepicker.css, the Audit Trail calendar
 * look: display-face month, ringed picked day, today dot, month grid behind the title).
 *
 * The chosen value is written back to the input and announced with `input` + `change` events, so
 * ngModel, reactive forms and plain (change)/(input) handlers all see it exactly as if typed. The
 * field's `min` / `max` are honoured. Typing into the field still works as before.
 *
 * Inside an open modal `<dialog>` the panel is shown through the Popover API so it sits in the top
 * layer above the dialog; elsewhere it is a fixed panel under `<body>`.
 */
@Injectable({ providedIn: 'root' })
export class DateFieldPickerService {
  private readonly doc = inject(DOCUMENT);
  private installed = false;

  private input: HTMLInputElement | null = null;
  private kind: PickerKind = 'date';
  private panel: HTMLDivElement | null = null;
  private mode: PickerMode = 'days';
  private viewYear = 0;
  private viewMonth = 0;
  private picked = '';
  private time = '';

  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const doc = this.doc;

    // Screens that call input.showPicker() (campaign wizard, tracking assets...) get this calendar too.
    const proto = HTMLInputElement.prototype as HTMLInputElement & { showPicker?: () => void };
    const native = proto.showPicker;
    const self = this;
    proto.showPicker = function (this: HTMLInputElement) {
      if (self.handles(this)) {
        self.open(this);
        return;
      }
      return native?.call(this);
    };

    doc.addEventListener('click', (e) => {
      const el = this.fieldFrom(e.target);
      if (!el) return;
      e.preventDefault();
      if (this.input === el && this.panel) return;
      this.open(el);
    }, true);

    doc.addEventListener('keydown', (e) => {
      const el = this.fieldFrom(e.target);
      if (el && ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4')) {
        e.preventDefault();
        this.open(el);
        return;
      }
      if (this.panel && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    }, true);

    doc.addEventListener('pointerdown', (e) => {
      if (!this.panel) return;
      const t = e.target as Node;
      if (this.panel.contains(t) || this.input?.contains(t) || t === this.input) return;
      this.close(false);
    }, true);

    window.addEventListener('resize', () => this.close(false));
    doc.addEventListener('scroll', (e) => {
      if (this.panel && !this.panel.contains(e.target as Node)) this.place();
    }, true);
  }

  // ------------------------------------------------------------------ open / close

  private handles(el: unknown): el is HTMLInputElement {
    return el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'datetime-local')
      && !el.disabled && !el.readOnly && !el.hasAttribute('data-native-picker');
  }

  private fieldFrom(target: EventTarget | null): HTMLInputElement | null {
    return this.handles(target) ? target : null;
  }

  private open(el: HTMLInputElement): void {
    if (this.panel && this.input === el) return;
    this.close(false);
    this.input = el;
    this.kind = el.type as PickerKind;
    const raw = el.value || '';
    this.picked = raw.slice(0, 10);
    this.time = this.kind === 'datetime-local' ? (raw.slice(11, 16) || this.nowTime()) : '';
    const base = this.parse(this.picked) || this.clampToRange(new Date());
    this.viewYear = base.getFullYear();
    this.viewMonth = base.getMonth();
    this.mode = 'days';

    const panel = this.doc.createElement('div');
    panel.className = 'ydp';
    // Screens that mark a region data-cal-compact (the create-asset page, the readiness off-canvas) get the
    // small calendar that opens right under / over its own field instead of the full-size one.
    if (el.closest('[data-cal-compact]')) panel.classList.add('ydp--compact');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choose a date');
    // A calendar is a tool, not a form pop-up: it closes on pick / outside click, so the pop-up guard must not add an X.
    panel.setAttribute('data-popup-free', '');
    panel.addEventListener('click', (e) => this.onPanelClick(e));
    panel.addEventListener('mousedown', (e) => {
      // Keep focus in the field (so typing still works), except for the time box.
      if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
    });
    this.panel = panel;

    const modal = el.closest('dialog[open]');
    const usePopover = !!modal && typeof (panel as HTMLElement & { showPopover?: () => void }).showPopover === 'function';
    if (usePopover) panel.setAttribute('popover', 'manual');
    (modal && !usePopover ? modal : this.doc.body).appendChild(panel);
    if (usePopover) (panel as HTMLElement & { showPopover: () => void }).showPopover();

    this.render();
    this.place();
    el.setAttribute('aria-expanded', 'true');
  }

  private close(refocus: boolean): void {
    const panel = this.panel;
    const input = this.input;
    this.panel = null;
    this.input = null;
    if (panel) panel.remove();
    if (input) {
      input.removeAttribute('aria-expanded');
      if (refocus) input.focus();
    }
  }

  private place(): void {
    const panel = this.panel;
    const input = this.input;
    if (!panel || !input) return;
    if (!input.isConnected) { this.close(false); return; }
    const r = input.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    // ABOVE THE FIELD, so the calendar never covers the date it is editing. Below only when
    // there is no room above (a field at the very top of the window). The compact calendar goes the
    // other way round: under its field first, over it when the window ends before the calendar does.
    let top = r.top - gap - h;
    let left = r.left;
    if (panel.classList.contains('ydp--compact')) {
      top = r.bottom + gap;
      if (top + h > vh - 8) top = r.top - gap - h;
      if (top < 8) top = Math.max(8, vh - h - 8);
      if (left + w > vw - 8) left = Math.max(8, r.right - w);
      panel.style.top = `${Math.round(top)}px`;
      panel.style.left = `${Math.round(left)}px`;
      return;
    }
    if (top < 8) {
      top = r.bottom + gap;
      if (top + h > vh - 8) {
        // No room above or below: sit beside the field rather than over it.
        top = Math.max(8, Math.min(r.top, vh - h - 8));
        left = r.right + gap + w <= vw - 8 ? r.right + gap : Math.max(8, r.left - gap - w);
        panel.style.top = `${Math.round(top)}px`;
        panel.style.left = `${Math.round(left)}px`;
        return;
      }
    }
    if (left + w > vw - 8) left = Math.max(8, r.right - w);
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
  }

  // ------------------------------------------------------------------ actions

  private onPanelClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const act = btn.dataset['act'];
    const val = btn.dataset['val'] || '';
    switch (act) {
      case 'prev': this.shift(-1); break;
      case 'next': this.shift(1); break;
      case 'mode': this.mode = this.mode === 'days' ? 'months' : 'days'; this.render(); break;
      case 'month': this.viewMonth = Number(val); this.mode = 'days'; this.render(); break;
      case 'day': this.pick(val, this.kind === 'date'); break;
      case 'today': {
        const t = this.iso(new Date());
        this.viewYear = new Date().getFullYear();
        this.viewMonth = new Date().getMonth();
        if (this.kind === 'datetime-local') this.time = this.nowTime();
        this.pick(t, this.kind === 'date');
        break;
      }
      case 'clear': this.commit(''); this.close(true); break;
      case 'done': {
        if (this.kind === 'datetime-local') {
          const box = this.panel?.querySelector<HTMLInputElement>('.ydp__time');
          if (box?.value) this.time = box.value;
          if (this.picked) this.commit(`${this.picked}T${this.time || '00:00'}`);
        }
        this.close(true);
        break;
      }
    }
  }

  private shift(step: number): void {
    if (this.mode === 'months') {
      this.viewYear += step;
    } else {
      const d = new Date(this.viewYear, this.viewMonth + step, 1);
      this.viewYear = d.getFullYear();
      this.viewMonth = d.getMonth();
    }
    this.render();
  }

  private pick(iso: string, closeAfter: boolean): void {
    if (!iso || !this.inRange(iso)) return;
    this.picked = iso;
    if (this.kind === 'date') {
      this.commit(iso);
    } else {
      const box = this.panel?.querySelector<HTMLInputElement>('.ydp__time');
      if (box?.value) this.time = box.value;
      this.commit(`${iso}T${this.time || '00:00'}`);
    }
    if (closeAfter) this.close(true);
    else this.render();
  }

  /** Writes the value and lets every listener (ngModel, forms, (change)) see it. */
  private commit(value: string): void {
    const el = this.input;
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ------------------------------------------------------------------ render

  private render(): void {
    const panel = this.panel;
    if (!panel) return;
    const months = this.mode === 'months';
    const title = months
      ? `<span class="ydp__month">${this.viewYear}</span>`
      : `<span class="ydp__month">${MONTHS[this.viewMonth]}</span><span class="ydp__year">${this.viewYear}</span>`;
    const prevOff = months ? !this.yearHasRoom(this.viewYear - 1) : !this.monthHasRoom(this.viewYear, this.viewMonth - 1);
    const nextOff = months ? !this.yearHasRoom(this.viewYear + 1) : !this.monthHasRoom(this.viewYear, this.viewMonth + 1);

    const chosen = this.parse(this.picked);
    const valueLine = chosen
      ? chosen.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : 'No date chosen';

    let body = '';
    if (months) {
      body = `<div class="ydp__months">${MONTHS.map((m, i) => {
        const on = i === this.viewMonth;
        const off = !this.monthHasRoom(this.viewYear, i);
        return `<button type="button" class="ydp__monthcell${on ? ' is-on' : ''}" data-act="month" data-val="${i}"${off ? ' disabled' : ''}>${m.slice(0, 3)}</button>`;
      }).join('')}</div>`;
    } else {
      const first = new Date(this.viewYear, this.viewMonth, 1);
      const lead = (first.getDay() + 6) % 7;
      const start = new Date(this.viewYear, this.viewMonth, 1 - lead);
      const today = this.iso(new Date());
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const iso = this.iso(d);
        const cls = ['ydp__day'];
        if (d.getMonth() !== this.viewMonth) cls.push('is-out');
        if (iso === today) cls.push('is-today');
        if (iso === this.picked) cls.push('is-picked');
        const off = !this.inRange(iso);
        cells += `<button type="button" class="${cls.join(' ')}" data-act="day" data-val="${iso}"${off ? ' disabled' : ''} aria-label="${d.toDateString()}"${iso === this.picked ? ' aria-pressed="true"' : ''}>${d.getDate()}</button>`;
      }
      body = `<div class="ydp__weekdays" aria-hidden="true">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div><div class="ydp__grid">${cells}</div>`;
    }

    const isStamp = this.kind === 'datetime-local';
    const todayOff = !this.inRange(this.iso(new Date()));
    const foot = `
      <div class="ydp__foot">
        <button type="button" class="ydp__btn" data-act="today"${todayOff ? ' disabled' : ''}>Today</button>
        <button type="button" class="ydp__btn" data-act="clear"${this.input?.required ? ' disabled' : ''}>Clear</button>
        ${isStamp ? `<input type="time" class="ydp__time" value="${this.time}" aria-label="Time" />` : ''}
        ${isStamp ? '<button type="button" class="ydp__btn ydp__btn--primary" data-act="done">Done</button>' : ''}
      </div>`;

    panel.innerHTML = `
      <div class="ydp__value">
        <span class="ydp__cap">${isStamp ? 'Date &amp; time' : 'Selected date'}</span>
        <span class="ydp__val${chosen ? '' : ' is-empty'}">${valueLine}${chosen && isStamp && this.time ? ` · ${this.time}` : ''}</span>
      </div>
      <div class="ydp__head">
        <button type="button" class="ydp__nav" data-act="prev" aria-label="Previous"${prevOff ? ' disabled' : ''}><i class="ri-arrow-left-s-line" aria-hidden="true"></i></button>
        <button type="button" class="ydp__title" data-act="mode" aria-label="Choose month">${title}<i class="ri-arrow-down-s-line ydp__caret${months ? ' is-up' : ''}" aria-hidden="true"></i></button>
        <button type="button" class="ydp__nav" data-act="next" aria-label="Next"${nextOff ? ' disabled' : ''}><i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>
      </div>
      ${body}
      ${foot}`;

    const timeBox = panel.querySelector<HTMLInputElement>('.ydp__time');
    timeBox?.addEventListener('change', () => {
      this.time = timeBox.value;
      if (this.picked) this.commit(`${this.picked}T${this.time || '00:00'}`);
    });
  }

  // ------------------------------------------------------------------ dates

  private iso(d: Date): string {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  private parse(iso: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  private nowTime(): string {
    const d = new Date();
    return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
  }

  private bounds(): { min: string; max: string } {
    return {
      min: (this.input?.min || '').slice(0, 10),
      max: (this.input?.max || '').slice(0, 10),
    };
  }

  private inRange(iso: string): boolean {
    const { min, max } = this.bounds();
    return (!min || iso >= min) && (!max || iso <= max);
  }

  private monthHasRoom(year: number, month: number): boolean {
    const d = new Date(year, month, 1);
    const first = this.iso(d);
    const last = this.iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const { min, max } = this.bounds();
    return (!min || last >= min) && (!max || first <= max);
  }

  private yearHasRoom(year: number): boolean {
    const { min, max } = this.bounds();
    return (!min || `${year}-12-31` >= min) && (!max || `${year}-01-01` <= max);
  }

  private clampToRange(d: Date): Date {
    const iso = this.iso(d);
    const { min, max } = this.bounds();
    if (min && iso < min) return this.parse(min) || d;
    if (max && iso > max) return this.parse(max) || d;
    return d;
  }
}
