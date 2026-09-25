import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

export type PopupTone = 'default' | 'danger' | 'success' | 'warning';
export type PopupSize = 'sm' | 'md' | 'lg' | 'xl';
export type PopupMode = 'dialog' | 'drawer';

let nextId = 0;

/**
 * The shared pop-up: the Campaigns > Tracking asset manager dialog design as one component.
 *
 *   <app-popup [open]="show()" kicker="Approval · TA-104" title="Approve tracking asset"
 *              lead="This decision records independent authority." (closed)="show.set(false)">
 *     ...body content (facts <dl>, fields)...
 *     <ng-container popupActions>
 *       <button type="button" class="yp-btn yp-btn--ghost" (click)="show.set(false)">Cancel</button>
 *       <button type="button" class="yp-btn yp-btn--primary">Confirm</button>
 *     </ng-container>
 *   </app-popup>
 *
 * Tinted header band with a gradient icon tile (red warning tile when tone="danger"), a white body that alone
 * scrolls, a tinted pinned footer. mode="drawer" slides the same sheet in from the right. Styles live in
 * src/styles/ydot-popup.css (global, so projected content picks them up) and read the --ov-* tokens of
 * src/styles/ydot-overlays.css, the same tokens the Campaigns pop-ups use.
 */
@Component({
  selector: 'app-popup',
  templateUrl: './popup.html',
})
export class PopupComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() kicker = '';
  @Input() lead = '';
  @Input() tone: PopupTone = 'default';
  @Input() size: PopupSize = 'md';
  @Input() mode: PopupMode = 'dialog';
  /** Remix icon class for the header tile (e.g. 'ri-shield-check-line'); a document-check glyph when empty. */
  @Input() icon = '';
  @Input() showIcon = true;
  @Input() showClose = true;
  @Input() closeOnBackdrop = true;
  @Input() closeOnEscape = true;
  @Input() role: 'dialog' | 'alertdialog' = 'dialog';

  @Output() closed = new EventEmitter<void>();

  protected readonly titleId = `yp-title-${++nextId}`;

  protected close(): void {
    this.closed.emit();
  }

  protected onBackdrop(): void {
    if (this.closeOnBackdrop) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open && this.closeOnEscape) {
      this.close();
    }
  }
}
