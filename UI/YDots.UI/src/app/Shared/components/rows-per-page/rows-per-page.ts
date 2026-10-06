import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';

/** Rows-per-page choices offered on every paged list. */
export const ROWS_PER_PAGE_OPTIONS: readonly number[] = [10, 20, 30, 40, 50];

/**
 * Pill-style "Rows: 10 v" picker for list footers. The menu opens upwards (footers sit at the
 * bottom of a card). The host screen owns the page size; this only reports the new choice.
 */
@Component({
  selector: 'app-rows-per-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="rpp-trigger" [class.is-open]="open()" aria-haspopup="listbox"
            [attr.aria-expanded]="open()" aria-label="Rows per page" (click)="open.set(!open())">
      <span class="rpp-label">Rows</span>
      <b class="rpp-value">{{ value() }}</b>
      <svg class="rpp-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    @if (open()) {
      <div class="rpp-menu" role="listbox" aria-label="Rows per page">
        <div class="rpp-head">Rows per page</div>
        @for (o of options(); track o) {
          <button type="button" role="option" class="rpp-opt" [class.is-on]="o === value()"
                  [attr.aria-selected]="o === value()" (click)="pick(o)">
            <span>{{ o }}</span>
            @if (o === value()) {
              <svg class="rpp-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
            }
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; align-items: center; font-size: 0.8125rem; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .rpp-trigger {
      display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 10px 0 12px;
      border-radius: 999px; background: color-mix(in srgb, currentColor 5%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      transition: border-color .15s, background .15s, box-shadow .15s;
    }
    .rpp-trigger:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
    .rpp-trigger:focus-visible, .rpp-trigger.is-open {
      outline: none; border-color: var(--accent, #2f5d4a);
      box-shadow: 0 0 0 3px var(--accent-ring, rgba(47, 93, 74, .16));
    }
    .rpp-label { opacity: .65; }
    .rpp-value { font-weight: 700; min-width: 1.4em; text-align: center; color: var(--accent, #2f5d4a); }
    .rpp-chev { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; opacity: .55; transition: transform .15s; }
    .is-open .rpp-chev { transform: rotate(180deg); }
    .rpp-menu {
      position: absolute; left: 0; bottom: calc(100% + 8px); z-index: 50; min-width: 124px; padding: 6px;
      background: #fff; color: #1f2937; border: 1px solid rgba(15, 23, 42, .1); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, .16); animation: rpp-in .12s ease-out;
    }
    @keyframes rpp-in { from { opacity: 0; transform: translateY(4px); } }
    .rpp-head { padding: 4px 10px 6px; font-size: .6875rem; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; }
    .rpp-opt {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
      padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; text-align: left;
    }
    .rpp-opt:hover { background: var(--accent-soft, #eef3f0); }
    .rpp-opt.is-on { background: var(--accent-soft, #eef3f0); color: var(--accent, #2f5d4a); font-weight: 700; }
    .rpp-tick { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  `,
})
export class RowsPerPage {
  readonly value = input.required<number>();
  readonly options = input<readonly number[]>(ROWS_PER_PAGE_OPTIONS);
  readonly changed = output<number>();
  protected readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected pick(n: number): void {
    this.open.set(false);
    if (n !== this.value()) this.changed.emit(n);
  }

  @HostListener('document:click', ['$event'])
  protected onDocClick(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('keydown.escape')
  protected onEscape(): void { this.open.set(false); }
}
