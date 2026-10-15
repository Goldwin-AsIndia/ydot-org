import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CampaignApiService } from '../../../../Service/campaign-api.service';
import { WhatsAppApiService, WhatsAppGroupDetailDto, WhatsAppGroupDto } from '../../../../Service/whatsapp-api.service';
import { PopupComponent } from '../../../../Shared/components/popup/popup';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { WaOption, WaSelectComponent } from '../wa-select/wa-select';
import { WatiHeadComponent } from '../wati-head/wati-head';
import { WhatsAppStore } from '../whatsapp-store.service';
import { count, localDateTime } from '../wa-format';

const ALL = 'all';
const NO_CAMPAIGN = 'none';

/**
 * Recipient groups: the picks of validated numbers an organisation keeps under a name, with tags and a
 * campaign, so the same people can be messaged again - or picked from - without choosing them one by one.
 *
 * A group is made on the Send message tab ("Save as group"); here it is read, renamed, re-tagged, trimmed
 * or deleted, and used to start a send. Every figure is the server's: members still on WhatsApp, sends
 * made from the group, who changed it last. The actions shown are the ones the server permits.
 */
@Component({
  selector: 'app-wati-groups',
  imports: [RouterLink, PopupComponent, WaSelectComponent, WatiHeadComponent],
  templateUrl: './wati-groups.html',
  styleUrls: ['../wa-shared.css', '../wati/wati.css'],
})
export class WatiGroupsComponent {
  protected readonly store = inject(WhatsAppStore);
  private readonly api = inject(WhatsAppApiService);
  private readonly campaigns = inject(CampaignApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly n = count;
  protected readonly dt = localDateTime;

  protected readonly groups = signal<WhatsAppGroupDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly problem = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly query = signal('');
  protected readonly tagFilter = signal<string>(ALL);
  protected readonly tagOptions = computed<WaOption[]>(() => {
    const tags = new Map<string, number>();
    for (const g of this.groups()) for (const t of g.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    return [
      { value: ALL, label: 'All tags' },
      ...[...tags.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, c]) => ({ value: t, label: t, hint: `${c} ${c === 1 ? 'group' : 'groups'}` })),
    ];
  });
  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const tag = this.tagFilter();
    return this.groups().filter((g) =>
      (tag === ALL || g.tags.includes(tag))
      && (!q || g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q)
        || (g.campaignName ?? '').toLowerCase().includes(q) || g.tags.some((t) => t.toLowerCase().includes(q))));
  });

  // ------------------------------------------------------------------ one group
  protected readonly detailId = signal<string | null>(null);
  protected readonly detail = signal<WhatsAppGroupDetailDto | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly marked = signal<ReadonlySet<string>>(new Set());
  protected readonly canEditDetail = computed(() => this.detail()?.group.permittedActions.includes('edit') ?? false);

  // ------------------------------------------------------------------ edit / delete
  protected readonly editTarget = signal<WhatsAppGroupDto | null>(null);
  protected readonly editName = signal('');
  protected readonly editDescription = signal('');
  protected readonly editCampaign = signal<string>(NO_CAMPAIGN);
  protected readonly editTags = signal('');
  protected readonly deleteTarget = signal<WhatsAppGroupDto | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionProblem = signal<string | null>(null);
  protected readonly campaignOptions = signal<WaOption[]>([{ value: NO_CAMPAIGN, label: 'No campaign' }]);

  constructor() {
    void this.load();
    void this.store.loadOverview();

    this.campaigns.lookupCampaigns().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => this.campaignOptions.set([
        { value: NO_CAMPAIGN, label: 'No campaign', hint: 'Not tied to a campaign' },
        ...list.map((c) => ({ value: c.id, label: c.name, hint: c.code })),
      ]),
      error: () => undefined,
    });
  }

  private async load(): Promise<void> {
    try {
      this.groups.set(await firstValueFrom(this.api.groups()));
      this.problem.set(null);
    } catch (error) {
      this.problem.set(apiErrorMessage(error, 'The groups could not be loaded. Please try again.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected can(g: WhatsAppGroupDto, action: string): boolean {
    return g.permittedActions.includes(action);
  }

  // ================================================================== one group

  protected async open(g: WhatsAppGroupDto): Promise<void> {
    this.detailId.set(g.id);
    this.detail.set(null);
    this.marked.set(new Set());
    this.actionProblem.set(null);
    await this.loadDetail(g.id);
  }

  private async loadDetail(id: string): Promise<void> {
    this.detailLoading.set(true);
    try {
      const detail = await firstValueFrom(this.api.group(id));
      if (this.detailId() === id) this.detail.set(detail);
    } catch (error) {
      this.actionProblem.set(apiErrorMessage(error, 'That group could not be loaded.'));
    } finally {
      this.detailLoading.set(false);
    }
  }

  protected close(): void {
    this.detailId.set(null);
    this.detail.set(null);
  }

  protected isMarked(number: string): boolean {
    return this.marked().has(number);
  }

  protected mark(number: string): void {
    const next = new Set(this.marked());
    if (!next.delete(number)) next.add(number);
    this.marked.set(next);
  }

  protected async removeMarked(): Promise<void> {
    const id = this.detailId();
    if (!id || this.busy() || this.marked().size === 0) return;
    this.busy.set(true);
    this.actionProblem.set(null);
    try {
      const answer = await this.store.send(() => firstValueFrom(this.api.removeGroupMembers(id, [...this.marked()])), 'The numbers could not be removed.');
      this.notice.set(answer.message);
      this.marked.set(new Set());
      await Promise.all([this.loadDetail(id), this.load()]);
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'The numbers could not be removed.');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Starts a send from the group. When its reachable members fit in one send they all become the
   * selection; a larger group opens the pool filtered to it, to pick the ones for this send.
   */
  protected async use(g: WhatsAppGroupDto): Promise<void> {
    this.actionProblem.set(null);
    const cap = this.store.selectionCap();
    try {
      if (cap === 0 || g.reachableCount <= cap) {
        await this.store.useGroup(g.id);
        void this.router.navigate(['/app/whatsapp/wati']);
      } else {
        this.store.clearSelection();
        this.store.patchComposer({ groupId: g.id, groupName: g.name, campaignId: g.campaignId ?? null, tags: g.tags });
        this.store.composeStep.set(1);
        void this.router.navigate(['/app/whatsapp/wati'], { queryParams: { group: g.id } });
      }
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'That group could not be used.');
    }
  }

  // ================================================================== edit / delete

  protected openEdit(g: WhatsAppGroupDto): void {
    this.actionProblem.set(null);
    this.editTarget.set(g);
    this.editName.set(g.name);
    this.editDescription.set(g.description ?? '');
    this.editCampaign.set(g.campaignId ?? NO_CAMPAIGN);
    this.editTags.set(g.tags.join(', '));
  }

  protected async saveEdit(): Promise<void> {
    const g = this.editTarget();
    if (!g || this.busy()) return;
    this.busy.set(true);
    this.actionProblem.set(null);
    try {
      const answer = await this.store.send(() => firstValueFrom(this.api.updateGroup(g.id, {
        name: this.editName().trim(),
        description: this.editDescription().trim() || null,
        campaignId: this.editCampaign() === NO_CAMPAIGN ? null : this.editCampaign(),
        tags: this.tagsList(this.editTags()),
        expectedVersion: g.version,
      })), 'The group could not be saved.');
      this.notice.set(answer.message);
      this.editTarget.set(null);
      await this.load();
      if (this.detailId() === g.id) await this.loadDetail(g.id);
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'The group could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmDelete(): Promise<void> {
    const g = this.deleteTarget();
    if (!g || this.busy()) return;
    this.busy.set(true);
    this.actionProblem.set(null);
    try {
      const answer = await this.store.send(() => firstValueFrom(this.api.deleteGroup(g.id)), 'The group could not be deleted.');
      this.notice.set(answer.message);
      this.deleteTarget.set(null);
      if (this.detailId() === g.id) this.close();
      if (this.store.composer().groupId === g.id) this.store.patchComposer({ groupId: null, groupName: null });
      await this.load();
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'The group could not be deleted.');
    } finally {
      this.busy.set(false);
    }
  }

  private tagsList(text: string): string[] {
    const seen = new Set<string>();
    return text.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      .map((t) => (t.length > 40 ? t.slice(0, 40) : t))
      .filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)))
      .slice(0, 10);
  }
}
