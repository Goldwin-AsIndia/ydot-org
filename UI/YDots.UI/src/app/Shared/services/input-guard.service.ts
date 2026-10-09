import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

type GuardKind = 'digits' | 'decimal' | 'name' | 'alnum' | 'code' | 'dial' | 'phone';

/**
 * ONE INPUT FILTER FOR EVERY TEXT FIELD IN THE APP.
 *
 * Without it a number box takes letters, and a name box takes digits, until some later check
 * rejects the form with a message that does not say why. This service stops the wrong character
 * at the keyboard (and in a paste), so the field simply never holds it. Like the shared calendar it
 * takes over fields without the screens having to opt in:
 *
 *   - `inputmode="numeric"`                      -> digits only
 *   - `type="tel"`                               -> digits, +, spaces, brackets and dashes (a phone number)
 *   - `inputmode="decimal"`                      -> digits and one decimal point
 *   - `data-input="digits|decimal|name|alnum|code|dial|phone"` -> the named rule, on any text field
 *   - a text field whose id / name / placeholder says it is a first / last / middle / full name,
 *     or a mobile / phone number, gets the matching rule on its own
 *   - `<input type="number">` never takes `e`, `+`, or `-` where a minimum of zero or more is set
 *
 * `data-input="free"` opts a field out of the guessing.
 *
 * The filtered value is written back before Angular's own `input` handler runs (this listener is on
 * the document, in the capture phase), so ngModel, reactive forms and signal handlers only ever see
 * the clean value.
 */
@Injectable({ providedIn: 'root' })
export class InputGuardService {
  private readonly doc = inject(DOCUMENT);
  private installed = false;

  /** Characters each rule keeps. `name` allows letters in any script, spaces, . ' - and a few marks. */
  private static readonly KEEP: Record<GuardKind, RegExp> = {
    digits: /[0-9]/,
    decimal: /[0-9.]/,
    name: /[\p{L}\p{M} .'’-]/u,
    alnum: /[\p{L}\p{N}]/u,
    code: /[A-Za-z0-9_\-./]/,
    dial: /[0-9+]/,
    phone: /[0-9+ ()-]/,
  };

  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;

    // Typing: refuse the character before it lands, so the caret never jumps and nothing flickers.
    this.doc.addEventListener(
      'beforeinput',
      (event) => {
        const input = this.fieldFrom(event.target);
        if (!input || event.isComposing) return;
        const data = (event as InputEvent).data;
        if (!data || (event as InputEvent).inputType !== 'insertText') return;

        if (input.type === 'number') {
          if (this.refusesNumberChar(input, data)) event.preventDefault();
          return;
        }

        const kind = this.kindFor(input);
        if (kind && this.filter(kind, data) !== data) event.preventDefault();
      },
      true,
    );

    // Pasting, dropping, autofill: whatever got in is cleaned before the screen reads it.
    this.doc.addEventListener(
      'input',
      (event) => {
        const input = this.fieldFrom(event.target);
        if (!input || (event as InputEvent).isComposing || input.type === 'number') return;

        const kind = this.kindFor(input);
        if (!kind) return;

        const before = input.value;
        let after = this.filter(kind, before);
        if (kind === 'decimal') after = this.singleDot(after);
        if (after === before) return;

        const caret = input.selectionStart;
        input.value = after;
        if (caret !== null) {
          const pos = Math.max(0, caret - (before.length - after.length));
          try { input.setSelectionRange(pos, pos); } catch { /* type without a caret */ }
        }
      },
      true,
    );

    this.watchRequiredFields();
  }

  // ---- Required / minimum-length check on leaving a field ---------------------------------------

  /** Class that paints the red outline (see styles/ydot-validation.css). */
  private static readonly FLAG = 'ydot-invalid-touched';

  /**
   * A field whose label carries a red star must not be left empty, and one that says "minimum N
   * characters" must not be left shorter. Checked when the person leaves the field (so nothing is
   * flagged before they get to it) and re-checked on every keystroke afterwards, so the outline
   * clears the moment the value is fixed. Screens that run their own validation are unaffected:
   * this only adds the outline where they showed none.
   */
  private watchRequiredFields(): void {
    this.doc.addEventListener('focusout', (event) => this.check(event.target), true);
    this.doc.addEventListener('input', (event) => {
      const el = event.target as HTMLElement | null;
      if (el?.classList?.contains(InputGuardService.FLAG)) this.check(el);
    });
    this.doc.addEventListener('change', (event) => {
      const el = event.target as HTMLElement | null;
      if (el?.classList?.contains(InputGuardService.FLAG)) this.check(el);
    });
  }

  private check(target: EventTarget | null): void {
    const el = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
    if (el.tagName === 'INPUT' && ['checkbox', 'radio', 'file', 'hidden', 'search', 'button', 'submit', 'range'].includes((el as HTMLInputElement).type)) return;
    if ((el as HTMLInputElement).readOnly || el.disabled || el.closest('[hidden]')) return;

    // A combobox's text box is only the search field for the list beneath it, and the screen that
    // owns the list does the validating (this is why labelText already refuses to read a star off a
    // combobox's block). Its value is written by the framework the instant an option is chosen -
    // no native input or change event ever fires - so a flag raised on focusout (value still empty
    // at that moment) could only be cleared by refocusing the box. That is what painted the field
    // red the moment an option was SELECTED. Leave comboboxes to the screen's own [aria-invalid] /
    // .is-invalid binding, and drop any flag a focusout has already raised.
    if (el.getAttribute('role') === 'combobox') {
      el.classList.remove(InputGuardService.FLAG);
      return;
    }

    const text = this.labelText(el);
    const value = (el.value ?? '').trim();
    let bad = false;

    if (!value) {
      bad = el.required || /\*/.test(text.label);
    } else {
      const min = this.minLength(el, text.scope);
      bad = min > 0 && value.length < min;
    }

    el.classList.toggle(InputGuardService.FLAG, bad);
  }

  /**
   * The text of this field's own label, and of the block that holds it. Only a label that belongs
   * to this field counts: one tied to it by `for` / wrapping, or - when the block holds a single
   * control - the block's label. A search box inside a starred field's dropdown is therefore left alone.
   */
  private labelText(el: HTMLElement): { label: string; scope: string } {
    const input = el as HTMLInputElement;
    const block = el.closest('.field, .yp-field, .form-group, .mb-3, .org-field, .of-field, [class*="-field"], label, fieldset') ?? el.parentElement;
    const scope = block?.textContent ?? '';
    const own = input.labels?.[0]?.textContent;
    if (own) return { label: own, scope };

    const controls = block?.querySelectorAll('input:not([type="hidden"]):not([type="search"]):not([type="checkbox"]):not([type="radio"]), select, textarea');
    const hint = `${input.placeholder ?? ''} ${input.getAttribute('aria-label') ?? ''}`;
    if (controls?.length === 1 && !/search|find|filter/i.test(hint) && el.getAttribute('role') !== 'combobox') {
      return { label: block?.querySelector('label, .field-label, [class*="-lbl"], [class*="-label"]')?.textContent ?? '', scope };
    }
    return { label: '', scope: '' };
  }

  /** "Minimum 10 characters", "at least 10 characters", "0 / 10 min" in the field's block, else the minlength attribute. */
  private minLength(el: HTMLElement, scope: string): number {
    const attr = Number((el as HTMLInputElement).minLength);
    if (Number.isFinite(attr) && attr > 0) return attr;
    const match = /(?:minimum|at least|min\.?)\s*(?:of\s*)?(\d{1,3})\s*(?:characters|chars)/i.exec(scope)
      ?? /\/\s*(\d{1,3})\s*min\b/i.exec(scope);
    const n = match ? Number(match[1]) : 0;
    return n >= 2 && n <= 500 ? n : 0;
  }

  private fieldFrom(target: EventTarget | null): HTMLInputElement | null {
    const el = target as HTMLElement | null;
    if (!el || el.tagName !== 'INPUT') return null;
    const input = el as HTMLInputElement;
    return input.readOnly || input.disabled ? null : input;
  }

  private filter(kind: GuardKind, text: string): string {
    const keep = InputGuardService.KEEP[kind];
    return Array.from(text).filter((ch) => keep.test(ch)).join('');
  }

  private singleDot(text: string): string {
    const first = text.indexOf('.');
    return first < 0 ? text : text.slice(0, first + 1) + text.slice(first + 1).replace(/\./g, '');
  }

  private refusesNumberChar(input: HTMLInputElement, data: string): boolean {
    if (/[eE+]/.test(data)) return true;
    if (data.includes('-')) {
      const min = input.min === '' ? NaN : Number(input.min);
      return Number.isFinite(min) && min >= 0;
    }
    return false;
  }

  /** The rule that applies to this field, or null for a free-text field. */
  private kindFor(input: HTMLInputElement): GuardKind | null {
    const declared = input.dataset['input'];
    if (declared === 'free') return null;
    if (declared && declared in InputGuardService.KEEP) return declared as GuardKind;

    const type = input.type;
    const mode = input.inputMode;
    if (mode === 'numeric') return 'digits';
    if (mode === 'decimal') return 'decimal';

    // A bare phone box may hold a number written "+91 98765 43210", so it keeps those marks. A box
    // that wants digits alone (the country code lives in its own field) says inputmode="numeric".
    if (type === 'tel') return 'phone';

    if (type !== 'text') return null;

    const hint = `${input.id} ${input.name} ${input.getAttribute('formcontrolname') ?? ''} ${input.getAttribute('aria-label') ?? ''} ${input.placeholder}`
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase();

    // (?<![a-z]) rather than \b: ids such as "epx_firstName" have an underscore, a word character,
    // right before the word, so \b never fires.
    if (/(?<![a-z])(first|last|middle|given|sur|family|full|preferred|contact person)[\s_-]*name(?![a-z])/.test(hint)
        && !/(e-?mail|@|username|user name|file|path|url|search|filter|find)/.test(hint)) {
      return 'name';
    }

    if (/(?<![a-z])(country|dial|calling|phone)[\s_-]*(code|prefix)(?![a-z])/.test(hint)) return 'dial';

    if (/(?<![a-z])(mobile|phone|whatsapp|contact number)(?![a-z])/.test(hint) && !/(e-?mail|@|code|prefix|search|filter|\/)/.test(hint)) {
      return 'phone';
    }

    return null;
  }
}
