import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WhatsAppStore } from '../whatsapp-store.service';
import { count } from '../wa-format';

export type WatiView = 'send' | 'groups' | 'log' | 'report';

/**
 * The masthead and the four tabs of WhatsApp Messages: send (pick numbers, fill a template, review,
 * send), groups (the picks kept for later), send log (the audit of every send) and the delivery report.
 *
 * Every figure is the server's: the pool size and messages sent come from the overview, the selection
 * count from the store's current pick.
 */
@Component({
  selector: 'app-wati-head',
  imports: [RouterLink],
  templateUrl: './wati-head.html',
  styleUrls: ['../wa-shared.css', '../wati/wati.css'],
  // The masthead and the tabs keep the page's rhythm: the same gap as every other block of the page.
  styles: [':host { display: flex; flex-direction: column; gap: calc(16 * var(--u)); }'],
})
export class WatiHeadComponent {
  protected readonly store = inject(WhatsAppStore);

  readonly view = input.required<WatiView>();

  protected readonly n = count;
  protected readonly ready = computed(() => this.store.overview()?.onWhatsApp ?? 0);
  protected readonly sent = computed(() => this.store.overview()?.messagesSent ?? 0);
  protected readonly readRate = computed(() => this.store.overview()?.readRate ?? 0);
  protected readonly selected = computed(() => this.store.selection().size);
}
