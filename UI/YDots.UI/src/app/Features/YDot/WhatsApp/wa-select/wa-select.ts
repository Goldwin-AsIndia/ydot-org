import { Component, ElementRef, HostListener, booleanAttribute, computed, inject, input, output, signal } from '@angular/core';

export interface WaOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

/**
 * The dropdown used on the WhatsApp screens, drawn like the owner picker in the new-campaign form: a rounded
 * field with a caret, and underneath a white list with rounded rows, a hint line per row and a tick on the
 * chosen one. It replaces the browser's own <select>, whose list cannot be styled.
 */
@Component({
  selector: 'app-wa-select',
  templateUrl: './wa-select.html',
  styleUrl: './wa-select.css',
})
export class WaSelectComponent {
  readonly options = input.required<readonly WaOption[]>();
  readonly value = input.required<string>();
  readonly label = input('Select');
  /** Open the list above the field instead of below (for controls at the foot of a panel). */
  readonly up = input(false, { transform: booleanAttribute });
  readonly compact = input(false, { transform: booleanAttribute });

  readonly valueChange = output<string>();

  protected readonly open = signal(false);
  protected readonly current = computed(() => this.options().find((o) => o.value === this.value()) ?? null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected choose(option: WaOption): void {
    this.valueChange.emit(option.value);
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
