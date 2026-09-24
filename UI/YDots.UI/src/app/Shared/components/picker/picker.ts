import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** One choice in a picker. `value` is what is stored; `label` (and optional `hint`) is what is shown. */
export interface PickerOption {
  value: string;
  label: string;
  hint?: string | null;
}

/**
 * A dropdown with a search box at the top of its list - a nicer, searchable stand-in for <select>.
 *
 *   <app-picker [options]="opts" [value]="form().parentId" (valueChange)="update('parentId', $event)"
 *               noneLabel="Top level" searchPlaceholder="Search departments" />
 *
 * Unlike <app-searchable-select> it stores a VALUE separate from the label (an id, a person reference),
 * so two options may share a name. `noneLabel`, when given, is the first row and means "nothing chosen"
 * (value ''). `searchable` false drops the search box for short lists.
 *
 * THE PANEL IS position: fixed, placed from the trigger's box when it opens. It is usually inside a
 * scrolling container (a dialog body), and an absolutely-positioned panel would be clipped by that
 * container's overflow. It opens upwards when there is not room below, and closes when the page scrolls
 * outside it or the window resizes, rather than drifting away from its field.
 *
 * Keyboard: Enter / Space / ArrowDown opens; ArrowUp / ArrowDown move; Enter picks; Escape closes (and is
 * stopped there, so an enclosing dialog does not close with it); Tab closes.
 */
@Component({
  selector: 'app-picker',
  standalone: true,
  templateUrl: './picker.html',
  styleUrl: './picker.css',
})
export class PickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input<readonly PickerOption[]>([]);
  readonly value = input<string | null | undefined>('');
  readonly placeholder = input('Select…');
  /** The "nothing chosen" row, shown first. Omit it for a required choice. */
  readonly noneLabel = input<string | null>(null);
  readonly searchable = input(true);
  readonly searchPlaceholder = input('Search…');
  readonly disabled = input(false);
  readonly invalid = input(false);
  /** The id of the visible trigger, so an external <label for> points at it. */
  readonly inputId = input<string | null>(null);
  readonly valueChange = output<string>();

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly open = signal(false);
  protected readonly query = signal('');
  /** Index into `rows()` of the keyboard-highlighted row. */
  protected readonly active = signal(0);
  protected readonly panelStyle = signal<Record<string, string>>({});
  protected readonly dropUp = signal(false);
  /** When the panel last opened; a scroll in the first moments is the opening itself, not the user. */
  private openedAt = 0;

  protected readonly selected = computed(() => this.options().find((o) => o.value === (this.value() ?? '')) ?? null);

  /** What the list shows: the none row (unless searching), then the matching options. */
  protected readonly rows = computed<PickerOption[]>(() => {
    const q = this.query().trim().toLowerCase();
    const matches = q
      ? this.options().filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
      : [...this.options()];
    const none = this.noneLabel();
    return none !== null && !q ? [{ value: '', label: none }, ...matches] : matches;
  });

  protected isSelected(option: PickerOption): boolean {
    return option.value === (this.value() ?? '');
  }

  // ---- open / close -------------------------------------------------------------------------

  protected toggle(): void {
    this.open() ? this.close() : this.openPanel();
  }

  private openPanel(): void {
    if (this.disabled()) return;
    this.query.set('');
    this.place();
    this.openedAt = Date.now();
    this.open.set(true);
    const current = this.rows().findIndex((row) => this.isSelected(row));
    this.active.set(Math.max(0, current));
    // After the panel renders: move it to <body>, focus the search box, bring the chosen row into view.
    //
    // WHY <body>. The panel is position: fixed, but a fixed element is placed relative to the nearest
    // ancestor that has a transform - and a dialog that animated in with one keeps it. Inside such a
    // dialog the panel was offset and clipped by the dialog's overflow, so it never appeared. Under
    // <body> nothing can capture it. It keeps its scoped styles (the attribute stays on the element).
    setTimeout(() => {
      const panel = this.panel()?.nativeElement;
      if (panel && panel.parentNode !== document.body) document.body.appendChild(panel);
      // preventScroll: focusing must not scroll the dialog, which would count as an outside scroll.
      this.search()?.nativeElement.focus({ preventScroll: true });
      this.scrollActiveIntoView();
    });
  }

  close(refocus = false): void {
    if (!this.open()) return;
    this.detachPanel();
    this.open.set(false);
    if (refocus) this.trigger()?.nativeElement.focus();
  }

  /** Fixed position under (or over) the trigger, the trigger's width, never off-screen. */
  private place(): void {
    const box = this.trigger()?.nativeElement.getBoundingClientRect();
    if (!box) return;
    const gap = 6;
    const wanted = 320;
    const below = window.innerHeight - box.bottom - gap - 8;
    const above = box.top - gap - 8;
    const up = below < Math.min(wanted, 220) && above > below;
    this.dropUp.set(up);
    const style: Record<string, string> = {
      left: `${Math.max(8, box.left)}px`,
      width: `${box.width}px`,
      'max-height': `${Math.max(160, Math.min(wanted, up ? above : below))}px`,
    };
    if (up) {
      style['bottom'] = `${window.innerHeight - box.top + gap}px`;
    } else {
      style['top'] = `${box.bottom + gap}px`;
    }
    this.panelStyle.set(style);
  }

  protected pick(option: PickerOption): void {
    this.valueChange.emit(option.value);
    this.close(true);
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.active.set(0);
  }

  // ---- keyboard -----------------------------------------------------------------------------

  protected onTriggerKey(event: KeyboardEvent): void {
    if (['ArrowDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      this.openPanel();
    }
  }

  protected onPanelKey(event: KeyboardEvent): void {
    const count = this.rows().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.active.set((this.active() + 1) % count);
        this.scrollActiveIntoView();
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.active.set((this.active() - 1 + count) % count);
        this.scrollActiveIntoView();
        break;
      case 'Enter': {
        event.preventDefault();
        const row = this.rows()[this.active()];
        if (row) this.pick(row);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  private scrollActiveIntoView(): void {
    // Moves the LIST's own scroll only. scrollIntoView() would also scroll the dialog around it, which
    // counts as an outside scroll and would close the panel.
    setTimeout(() => {
      const list = this.list()?.nativeElement;
      const row = list?.querySelector<HTMLElement>(`[data-index="${this.active()}"]`);
      if (!list || !row) return;
      if (row.offsetTop < list.scrollTop) {
        list.scrollTop = row.offsetTop;
      } else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
      }
    });
  }

  // ---- closing from outside -----------------------------------------------------------------

  /** Takes the panel out of <body> again. Angular would too, but not when the whole host is destroyed. */
  private detachPanel(): void {
    const panel = this.panel()?.nativeElement;
    if (panel?.parentNode === document.body) panel.remove();
  }

  /** Outside = neither the field nor the panel (which lives under <body> while open). */
  private isInside(target: EventTarget | null): boolean {
    const node = target as Node | null;
    return !!node && (this.host.nativeElement.contains(node) || !!this.panel()?.nativeElement.contains(node));
  }

  @HostListener('document:mousedown', ['$event'])
  protected onDocumentDown(event: MouseEvent): void {
    if (this.open() && !this.isInside(event.target)) this.close();
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.close();
  }

  /**
   * A scroll anywhere but inside the list would leave the fixed panel behind its field. Scroll events
   * do not bubble, so this listens in the CAPTURE phase to hear a dialog body or any other container
   * scroll, not just the page.
   */
  constructor() {
    const onScroll = (event: Event) => {
      if (!this.open() || Date.now() - this.openedAt < 250) return;
      if (!this.list()?.nativeElement.contains(event.target as Node)) this.close();
    };
    document.addEventListener('scroll', onScroll, true);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('scroll', onScroll, true);
      this.detachPanel();
    });
  }
}
