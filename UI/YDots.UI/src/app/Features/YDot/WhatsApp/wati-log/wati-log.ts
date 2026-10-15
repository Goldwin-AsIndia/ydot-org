import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, firstValueFrom } from 'rxjs';
import {
  WatiBroadcastDetailDto,
  WatiBroadcastDto,
  WatiBroadcastFilterDto,
  WatiBroadcastSearchDto,
  WhatsAppApiService,
} from '../../../../Service/whatsapp-api.service';
import { PopupComponent } from '../../../../Shared/components/popup/popup';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { WaPagerComponent } from '../wa-pager/wa-pager';
import { WaOption, WaSelectComponent } from '../wa-select/wa-select';
import { WatiHeadComponent } from '../wati-head/wati-head';
import { WhatsAppStore } from '../whatsapp-store.service';
import { count, localDateTime, localDateTimeFull, saveFile, timeZoneLabel } from '../wa-format';

const ALL = 'all';
/** A send still on its way is read again this often while it is open. */
const LIVE_POLL_MS = 5000;

/**
 * The send log - the audit trail of WhatsApp messaging.
 *
 * One row per send: who made it and when, the template, the group and tags it came from, how many
 * numbers were selected and what became of them, and the checks those numbers were picked from. A send
 * opens in full: the template as it was sent, every value (and which came from the recipient), and every
 * selected number with its source check, its CheckNumber.ai task and its outcome - including the numbers
 * left out and why. Both the whole log (as filtered) and a single send download as CSV.
 *
 * Every filter option and count is the server's; the actions shown are the ones it permits.
 */
@Component({
  selector: 'app-wati-log',
  imports: [RouterLink, PopupComponent, WaPagerComponent, WaSelectComponent, WatiHeadComponent],
  templateUrl: './wati-log.html',
  styleUrls: ['../wa-shared.css', '../wati/wati.css'],
})
export class WatiLogComponent {
  protected readonly store = inject(WhatsAppStore);
  private readonly api = inject(WhatsAppApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly n = count;
  protected readonly dt = localDateTime;
  protected readonly dtFull = localDateTimeFull;
  protected readonly zone = timeZoneLabel();

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  /** What the worker said about the send just made; shown once, here. */
  protected readonly notice = signal<string | null>(this.store.broadcastNotice());

  // ------------------------------------------------------------------ the list
  protected readonly search = signal('');
  private readonly searchInput = new Subject<string>();
  protected readonly status = signal<string>(ALL);
  protected readonly template = signal<string>(ALL);
  protected readonly group = signal<string>(ALL);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);

  protected readonly result = signal<WatiBroadcastSearchDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly problem = signal<string | null>(null);
  private request = 0;

  protected readonly rows = computed<WatiBroadcastDto[]>(() => this.result()?.results.items ?? []);
  protected readonly total = computed(() => this.result()?.results.totalCount ?? 0);
  protected readonly statusFilters = computed(() => {
    const facets = this.result()?.facets.statuses ?? [];
    return [{ value: ALL, label: 'All sends', count: facets.reduce((sum, f) => sum + f.count, 0) }, ...facets];
  });
  protected readonly templateOptions = computed<WaOption[]>(() => [
    { value: ALL, label: 'All templates' },
    ...(this.result()?.facets.templates ?? []).map((t) => ({ value: t.value, label: t.label, hint: `${this.n(t.count)} sends` })),
  ]);
  protected readonly groupOptions = computed<WaOption[]>(() => [
    { value: ALL, label: 'All groups' },
    ...(this.result()?.facets.groups ?? []).map((g) => ({ value: g.value, label: g.label, hint: `${this.n(g.count)} sends` })),
  ]);
  protected readonly filtered = computed(() =>
    !!this.search().trim() || this.status() !== ALL || this.template() !== ALL || this.group() !== ALL || !!this.from() || !!this.to());

  // ------------------------------------------------------------------ one send
  protected readonly sendId = computed(() => this.query().get('send'));
  protected readonly detail = signal<WatiBroadcastDetailDto | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailFilter = signal<string>(ALL);
  protected readonly busy = signal(false);
  protected readonly actionProblem = signal<string | null>(null);
  private liveTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly recipientFilters = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.detail()?.recipients ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return [{ value: ALL, label: 'All', count: this.detail()?.recipients.length ?? 0 },
      ...[...counts.entries()].map(([value, c]) => ({ value, label: STATUS_WORD[value] ?? value, count: c }))];
  });
  protected readonly recipients = computed(() => {
    const f = this.detailFilter();
    return (this.detail()?.recipients ?? []).filter((r) => f === ALL || r.status === f);
  });
  protected readonly bindingList = computed(() => Object.entries(this.detail()?.bindings ?? {}));
  protected readonly valueList = computed(() => Object.entries(this.detail()?.values ?? {}));

  constructor() {
    this.store.broadcastNotice.set(null);
    this.searchInput.pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef)).subscribe((text) => this.search.set(text));

    effect(() => {
      this.search(); this.status(); this.template(); this.group(); this.from(); this.to();
      untracked(() => this.page.set(1));
    });
    effect(() => {
      const filter = this.filterDto();
      untracked(() => void this.load(filter));
    });

    // The send named in the address bar opens in the drawer, and stays current while it is on its way.
    effect(() => {
      const id = this.sendId();
      untracked(() => {
        this.stopLive();
        this.detail.set(null);
        this.detailFilter.set(ALL);
        this.actionProblem.set(null);
        if (id) {
          void this.loadDetail(id);
          this.liveTimer = setInterval(() => {
            const status = this.detail()?.broadcast.status;
            if (status === 'Queued' || status === 'Sending') void this.loadDetail(id, true);
          }, LIVE_POLL_MS);
        }
      });
    });
    this.destroyRef.onDestroy(() => this.stopLive());

    void this.store.loadOverview();
  }

  private filterDto(): WatiBroadcastFilterDto {
    return {
      page: this.page(),
      pageSize: this.pageSize(),
      search: this.search().trim() || null,
      status: this.status() === ALL ? null : this.status(),
      templateName: this.template() === ALL ? null : this.template(),
      groupId: this.group() === ALL ? null : this.group(),
      from: this.from() || null,
      to: this.to() || null,
    };
  }

  private async load(filter: WatiBroadcastFilterDto): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    try {
      const answer = await firstValueFrom(this.api.broadcasts(filter));
      if (request !== this.request) return;
      this.result.set(answer);
      this.problem.set(null);
    } catch (error) {
      if (request === this.request) this.problem.set(apiErrorMessage(error, 'The send log could not be loaded. Please try again.'));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  private async loadDetail(id: string, quiet = false): Promise<void> {
    if (!quiet) this.detailLoading.set(true);
    try {
      const detail = await firstValueFrom(this.api.broadcast(id));
      if (this.sendId() === id) this.detail.set(detail);
    } catch (error) {
      if (!quiet) this.actionProblem.set(apiErrorMessage(error, 'That send could not be loaded.'));
    } finally {
      if (!quiet) this.detailLoading.set(false);
    }
  }

  private stopLive(): void {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  protected onSearch(text: string): void {
    this.searchInput.next(text);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set(ALL);
    this.template.set(ALL);
    this.group.set(ALL);
    this.from.set('');
    this.to.set('');
  }

  protected open(row: WatiBroadcastDto): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { send: row.id }, queryParamsHandling: 'merge' });
  }

  protected close(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { send: null }, queryParamsHandling: 'merge' });
  }

  protected statusWord(status: string): string {
    return SEND_STATUS[status] ?? status;
  }

  protected statusClass(status: string): string {
    return status === 'Completed' ? 'completed' : status === 'Failed' || status === 'CompletedWithErrors' ? 'failed' : status === 'Cancelled' ? 'cancelled' : 'running';
  }

  protected word(status: string): string {
    return STATUS_WORD[status] ?? status;
  }

  // ================================================================== actions

  protected async exportLog(): Promise<void> {
    this.problem.set(null);
    try {
      const file = await this.store.send(() => firstValueFrom(this.api.exportBroadcasts(this.filterDto())), 'The send log could not be exported.');
      saveFile(file.fileName, file.blob, file.blob.type || 'text/csv');
    } catch (error) {
      this.problem.set(error instanceof Error ? error.message : 'The send log could not be exported.');
    }
  }

  protected async exportOne(id: string): Promise<void> {
    this.actionProblem.set(null);
    try {
      const file = await this.store.send(() => firstValueFrom(this.api.exportBroadcast(id)), 'The send could not be exported.');
      saveFile(file.fileName, file.blob, file.blob.type || 'text/csv');
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'The send could not be exported.');
    }
  }

  protected async retry(id: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionProblem.set(null);
    try {
      const message = await this.store.retrySend(id);
      this.notice.set(message);
      await Promise.all([this.loadDetail(id, true), this.load(this.filterDto())]);
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'The send could not be retried.');
    } finally {
      this.busy.set(false);
    }
  }
}

const SEND_STATUS: Record<string, string> = {
  Queued: 'Queued', Sending: 'Sending', Completed: 'Completed', CompletedWithErrors: 'With failures', Failed: 'Failed', Cancelled: 'Cancelled',
};

const STATUS_WORD: Record<string, string> = {
  PENDING: 'Pending', SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', REPLIED: 'Replied', FAILED: 'Failed', SKIPPED: 'Skipped', EXCLUDED: 'Left out',
};
