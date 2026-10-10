import { CommonModule, Location } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Output,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  CommunicationTimelineEntry,
  CommunicationTimelineResponse,
  DonLookupItem,
} from '../../../../Shared/models/donor-contract.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { parseCsv } from '../../../../Shared/services/csv';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';

import { NavigationHistoryService } from '../../../../Shared/services/navigation-history.service';
/**
 * A channel, as the API names it: Call, Email, Sms, WhatsApp, Meeting, Visit or Note.
 *
 * THE SERVER'S VALUES, NOT THIS SCREEN'S OWN. The screen used to keep its own list - with "SMS",
 * "Internal Note" and an "Event" the API has never had - and translate on the way out, which is
 * how a logged meeting came to be recorded as an e-mail (the translation's default).
 */
type Channel = string;

/** A lane above the journal: every entry, the starred ones, or one channel. */
type Lane = 'All' | 'Important' | Channel;

interface CommunicationRecord {
  id: string;
  type: Channel;
  date: string;
  time: string;
  createdBy: string;

  /** Outgoing | Incoming | Internal. */
  direction: string;

  /** The API's outcome value, e.g. CallbackRequested. `outcomeLabel` is what a person reads. */
  outcome: string;
  outcomeLabel: string;
  summary: string;
  notes?: string;

  /** The server withheld the notes from this caller; there is something there they may not read. */
  notesMasked: boolean;

  /** Low | Medium | High, or empty when whoever logged it did not say. */
  engagement: string;
  quality: string;
  important: boolean;
  attachment?: string;

  /** The person who logged it, or somebody who works the whole organisation. */
  canEdit: boolean;
  version: number;
}

interface CommunicationForm {
  type: Channel;
  date: string;
  time: string;
  direction: string;
  outcome: string;
  engagement: string;
  quality: string;
  summary: string;
  notes: string;
  attachmentName: string;
  important: boolean;
}

interface SuggestedAction {
  label: string;
  detail: string;
}

/**
 * How the outcome picker lays the server's outcomes out: four kinds of result rather than one
 * long row. The outcomes themselves, and their wording, are the server's - this only says which
 * column each one sits in, and anything it does not name is shown under "Other".
 */
const OUTCOME_KINDS: readonly { label: string; hint: string; values: readonly string[] }[] = [
  { label: 'Reached', hint: 'Contact was made', values: ['Reached', 'MeetingScheduled'] },
  { label: 'Warm signals', hint: 'Moving towards a gift', values: ['Interested', 'DonationDiscussion', 'MeetingCompleted'] },
  { label: 'Awaiting', hint: 'Needs another touch', values: ['NoAnswer', 'CallbackRequested', 'InformationRequested'] },
  { label: 'Closed', hint: 'Stop or correct', values: ['NotInterested', 'WrongNumber', 'DoNotContact'] },
];

/** The lane headings: a channel in the plural. Falls back to the server's own label. */
const LANE_LABELS: Record<string, string> = {
  Call: 'Calls',
  Email: 'Emails',
  Sms: 'SMS',
  WhatsApp: 'WhatsApp',
  Meeting: 'Meetings',
  Visit: 'Visits',
  Note: 'Notes',
};

@Component({
  selector: 'app-communication-timeline',
  standalone: true,
  imports: [RowsPerPage, CommonModule, FormsModule],
  templateUrl: './communication-timeline.html',
  styleUrl: './communication-timeline.css',
})
export class CommunicationTimelineComponent {
  private readonly router = inject(Router);
  private readonly navHistory = inject(NavigationHistoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly api = inject(DonorApiService);
  private readonly toast = inject(ToastService);
  private readonly tokens = inject(AuthTokenService);

  /**
   * The server's answer for this lead or donor.
   *
   * ONE CALL FILLS BOTH HALVES OF THE SCREEN - the profile card and the timeline beneath it -
   * so the header can never describe one person while the conversations belong to another. The
   * same answer carries every list this screen offers a choice from, what the caller may do here,
   * and the readings in the rail: health, trends, the next follow-up.
   */
  readonly timeline = signal<CommunicationTimelineResponse | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal('');
  readonly donorId = signal(this.route.snapshot.queryParamMap.get('donorId'));
  readonly leadId = signal(this.route.snapshot.queryParamMap.get('leadId'));

  /**
   * The record this timeline belongs to.
   *
   * NO FALLBACK CONSTANT. It used to default to the literal 'LEAD-2026-0142', so opening the
   * screen without a query string showed one particular fabricated lead - and any note recorded
   * there was attached to it.
   */
  readonly recordId = computed(() => this.donorId() ?? this.leadId() ?? '');

  /**
   * Whether this is a donor's timeline. The server's word: a lead opened by its own id that has
   * since converted is a donor now, whatever the address bar says.
   */
  readonly isDonor = computed(() => !!(this.timeline()?.donorId ?? this.donorId()));

  /** A lead that is still a lead - the only record that carries a temperature and a potential. */
  readonly isLead = computed(() => this.timeline()?.isLead === true);

  @Output() navigateToLeads = new EventEmitter<void>();

  readonly activeTab = signal<Lane>('All');
  readonly isEntryDrawerOpen = signal(false);
  readonly isDetailDrawerOpen = signal(false);
  readonly isTemperatureModalOpen = signal(false);
  readonly isDonationPotentialModalOpen = signal(false);
  readonly isExportModalOpen = signal(false);
  readonly isFilterOpen = signal(false);
  readonly isActionMenuOpen = signal(false);
  readonly isRefreshing = signal(false);
  readonly menuRecordId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly selectedCommunication = signal<CommunicationRecord | null>(null);
  readonly formErrors = signal<string[]>([]);

  /** Set once Save is pressed, so a required field shows its error only after an attempt. */
  readonly attempted = signal(false);
  readonly timeInvalid = computed(() => this.attempted() && !this.form().time);
  readonly summaryInvalid = computed(() => this.attempted() && this.form().summary.trim().length < 10);

  // 12-hour time picker (hour : minute + AM/PM) over the stored 24-hour `HH:mm`, as on Campaigns.
  readonly hourOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  readonly minuteOptions = computed(() => {
    const base = Array.from({ length: 12 }, (_, i) => i * 5);
    const cur = this.timeParts().minute;
    return cur !== null && !base.includes(cur) ? [...base, cur].sort((a, b) => a - b) : base;
  });
  readonly timeParts = computed(() => {
    const m = /^(\d{1,2}):(\d{2})/.exec(this.form().time ?? '');
    if (!m) return { hour: null as number | null, minute: null as number | null, pm: false };
    const h = Number(m[1]);
    return { hour: h % 12 === 0 ? 12 : h % 12, minute: Number(m[2]), pm: h >= 12 };
  });

  setTimePart(part: 'hour' | 'minute' | 'meridiem', raw: string | number): void {
    if (this.editingId()) return;
    const cur = this.timeParts();
    let hour = cur.hour ?? 9;
    let minute = cur.minute ?? 0;
    let pm = cur.pm;
    if (part === 'hour') hour = Number(raw);
    else if (part === 'minute') minute = Number(raw);
    else pm = raw === 'PM';
    const h24 = (hour % 12) + (pm ? 12 : 0);
    this.updateForm('time', `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  private readonly entrySheet = viewChild<ElementRef<HTMLElement>>('entrySheet');

  readonly currentTemperature = signal('');
  readonly newTemperature = signal('');
  readonly temperatureReason = signal('');

  readonly donationPotential = signal('');
  readonly newDonationPotential = signal('');
  readonly donationPotentialReason = signal('');

  /** The server asks for a reason of at least this many characters when a lead is re-scored. */
  readonly scoreReasonMinimum = 10;

  readonly typeFilter = signal<string>('All');
  readonly directionFilter = signal<string>('All');
  readonly outcomeFilter = signal<string>('All');
  readonly importantOnly = signal(false);
  readonly dateFromFilter = signal('');
  readonly dateToFilter = signal('');
  readonly searchQuery = signal('');
  readonly currentPage = signal(1);
  readonly pageSize = signal(10);
  setPageSize(n: number): void { this.pageSize.set(n); this.currentPage.set(1); }

  // ===========================================================================================
  // What the caller may do here - the server's verbs for this caller and this record
  // ===========================================================================================

  private readonly permitted = computed(() => this.timeline()?.permittedActions ?? []);

  /** Log, edit and flag a communication. Withheld on a closed lead or an archived donor. */
  readonly canLog = computed(() => this.permitted().includes('Contact'));

  /** Change a lead's temperature and donation potential. */
  readonly canScore = computed(() => this.permitted().includes('Score'));
  readonly canSchedule = computed(() => this.permitted().includes('Schedule follow-up'));
  readonly canShareDonationLink = computed(() => this.permitted().includes('Share donation link'));

  /** The export is the server's and needs its permission; the button is hidden without it. */
  readonly canExport = this.tokens.hasPermission('don.donors.export');

  /**
   * The profile beside the timeline.
   *
   * EVERY FIELD IS THE SERVER'S. The old version fell back to a fabricated person - "Ramesh
   * Kumar", "+91 98765 43210", "ramesh.kumar@example.com", "Tamil", "Evenings" - whenever the
   * in-memory store had nothing, which is to say on every fresh page load. Somebody could ring
   * that number.
   */
  readonly relationship = computed(() => {
    const data = this.timeline();
    return {
      // The donor's number once there is a donor; the lead's reference until then.
      reference: data?.donorReference ?? data?.leadReference ?? '',
      name: data?.displayName ?? '',

      // ALREADY MASKED, OR ALREADY NOT - `isContactMasked` says which, and the screen shows it
      // rather than deciding.
      mobile: data?.mobileNumber ?? '',
      email: data?.emailAddress ?? '',
      campaign: data?.campaignName ?? '',
      source: data?.source ?? '',
      language: data?.preferredLanguage ?? '',
      owner: data?.ownerName ?? 'Unassigned',
      stage: data?.status ?? '',
    };
  });

  // ===========================================================================================
  // The lists every selector draws from - all of them the server's
  // ===========================================================================================

  /** Channels: value = Call, Email, Sms, WhatsApp, Meeting, Visit, Note. */
  readonly communicationTypes = computed<DonLookupItem[]>(() => this.timeline()?.interactionTypeOptions ?? []);
  readonly outcomeOptions = computed<DonLookupItem[]>(() => this.timeline()?.outcomeOptions ?? []);
  readonly directionOptions = computed<DonLookupItem[]>(() => this.timeline()?.directionOptions ?? []);
  readonly temperatures = computed(() => (this.timeline()?.temperatureOptions ?? []).map((option) => option.value));
  readonly donationPotentials = computed(() => (this.timeline()?.donationPotentialOptions ?? []).map((option) => option.value));
  readonly qualities = computed(() => (this.timeline()?.qualityOptions ?? []).map((option) => option.value));
  readonly engagementLevels = computed(() => (this.timeline()?.engagementOptions ?? []).map((option) => option.value));

  private readonly monthMap: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  private readonly monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  /**
   * The conversations, newest first.
   *
   * IT WAS A LITERAL ARRAY of four invented exchanges - "Ramesh confirmed interest in the Educate
   * a Child campaign", "campaign-brochure.pdf" - seeded into a shared in-browser store on every
   * construction, so every lead in every organisation had had the same four conversations.
   */
  readonly records = signal<CommunicationRecord[]>([]);

  constructor() {
    effect(() => {
      const lastPage = this.totalPages();
      if (this.currentPage() > lastPage) this.currentPage.set(lastPage);
    });
    // The log screen replaces the timeline inside the app shell: start it at the top, take focus, and
    // pin its bar just under the app's fixed top bar (whose height changes with the UI scale).
    // The shell's content column is a scroll container (overflow auto) that never scrolls, which would
    // stop the bar sticking; while logging it clips instead, and gets its own overflow back on close.
    effect((onCleanup) => {
      const sheet = this.entrySheet()?.nativeElement;
      if (!sheet) return;
      const header = document.querySelector('.app-header') as HTMLElement | null;
      sheet.style.setProperty('--le-top', `${header?.offsetHeight ?? 0}px`);
      const column = sheet.closest('.content-page') as HTMLElement | null;
      const overflow = column?.style.overflow ?? '';
      if (column) column.style.overflow = 'clip';
      onCleanup(() => { if (column) column.style.overflow = overflow; });
      window.scrollTo({ top: 0 });
      sheet.focus({ preventScroll: true });
    });
    this.load();
  }

  /**
   * Loads the profile and the conversations together.
   *
   * IT SENDS WHICHEVER ID IT HAS. The screen is reached with a lead id from the queues and a
   * donor id from Donor 360; the server resolves one to the other, so a lead that has since
   * converted still shows everything said before the conversion.
   */
  private load(): void {
    if (!this.recordId()) {
      this.loadError.set('No lead or donor was named, so there is no timeline to show.');
      return;
    }

    this.loading.set(true);
    this.loadError.set('');

    this.api.getCommunicationTimeline(this.leadId(), this.donorId()).subscribe({
      next: (response) => {
        this.timeline.set(response);
        this.records.set(response.entries.map((entry) => this.toRecord(entry, response)));

        this.currentTemperature.set(response.temperature ?? '');
        this.newTemperature.set(response.temperature ?? '');
        this.donationPotential.set(response.donationPotential ?? '');
        this.newDonationPotential.set(response.donationPotential ?? '');

        // The detail drawer holds a copy of a row; keep it the server's after a reload.
        const open = this.selectedCommunication();
        if (open) {
          this.selectedCommunication.set(this.records().find((record) => record.id === open.id) ?? null);
        }

        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(apiErrorMessage(error));
        this.toast.show('Timeline unavailable', this.loadError(), 'error');
      },
    });
  }

  /**
   * Maps one server entry onto the row this screen draws.
   *
   * THE DATE IS SPLIT FOR DISPLAY ONLY. The API stores one UTC instant; the timeline groups by
   * day and shows a time beside each line, so both are derived here rather than stored twice.
   *
   * ENGAGEMENT, QUALITY, THE STAR AND THE ATTACHMENT ARE THE ENTRY'S OWN. They were not stored at
   * all, and this mapping filled the gap with constants - every conversation was "Medium"
   * engagement and none was important - so the health and trend figures built on them described
   * nothing.
   */
  private toRecord(entry: CommunicationTimelineEntry, response: CommunicationTimelineResponse): CommunicationRecord {
    const occurred = new Date(entry.occurredAtUtc);

    return {
      id: entry.id,
      type: entry.interactionType,
      date: this.toDisplayDateFrom(occurred),
      time: occurred.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      createdBy: entry.performedByName ?? '',
      direction: entry.direction,
      outcome: entry.outcome,
      outcomeLabel: this.labelIn(response.outcomeOptions, entry.outcome),
      summary: entry.summary,

      // WITHHELD RATHER THAN BLANK. `isNotesMasked` is why there is nothing here, and the screen
      // says so instead of implying the conversation had no notes.
      notes: entry.notes ?? undefined,
      notesMasked: entry.isNotesMasked,
      engagement: entry.engagementLevel ?? '',
      quality: entry.quality ?? '',
      important: entry.isImportant,
      attachment: entry.attachmentName ?? undefined,
      canEdit: entry.canEdit,
      version: entry.version,
    };
  }

  private labelIn(options: readonly DonLookupItem[] | undefined, value: string): string {
    if (value === 'NotContacted') return 'Not contacted';
    return (options ?? []).find((option) => option.value === value)?.label ?? value;
  }

  private toDisplayDateFrom(value: Date): string {
    const day = String(value.getDate()).padStart(2, '0');
    return `${day} ${this.monthNames[value.getMonth()]} ${value.getFullYear()}`;
  }

  readonly form = signal<CommunicationForm>(this.createEmptyForm('Call'));

  readonly filteredRecords = computed(() => {
    const from = this.dateFromFilter() ? this.parseDisplayDate(this.toDisplayDate(this.dateFromFilter())) : null;
    const to = this.dateToFilter() ? this.parseDisplayDate(this.toDisplayDate(this.dateToFilter())) : null;
    const query = this.searchQuery().trim().toLocaleLowerCase();

    return this.records().filter((record) => {
      const tabMatch =
        this.activeTab() === 'All'
          ? true
          : this.activeTab() === 'Important'
            ? record.important
            : record.type === this.activeTab();

      const typeMatch =
        this.typeFilter() === 'All' || record.type === this.typeFilter();

      const directionMatch =
        this.directionFilter() === 'All' ||
        record.direction === this.directionFilter();

      const outcomeMatch =
        this.outcomeFilter() === 'All' || record.outcome === this.outcomeFilter();

      const importantMatch = !this.importantOnly() || record.important;

      const recordDate = this.parseDisplayDate(record.date);
      const fromMatch = !from || !recordDate || recordDate.getTime() >= from.getTime();
      const toMatch = !to || !recordDate || recordDate.getTime() <= to.getTime();
      const searchMatch = !query || [this.channelLabel(record.type), record.outcomeLabel, record.summary, record.notes,
        record.createdBy, record.direction]
        .some((value) => value?.toLocaleLowerCase().includes(query));

      return (
        tabMatch &&
        typeMatch &&
        directionMatch &&
        outcomeMatch &&
        importantMatch &&
        fromMatch &&
        toMatch &&
        searchMatch
      );
    });
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredRecords().length / this.pageSize())));
  readonly paginatedRecords = computed(() => {
    const safePage = Math.min(this.currentPage(), this.totalPages());
    const start = (safePage - 1) * this.pageSize();
    return this.filteredRecords().slice(start, start + this.pageSize());
  });
  readonly pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, index) => index + 1));
  readonly firstVisibleRecord = computed(() => this.filteredRecords().length ? (this.currentPage() - 1) * this.pageSize() + 1 : 0);
  readonly lastVisibleRecord = computed(() => Math.min(this.currentPage() * this.pageSize(), this.filteredRecords().length));

  /** The visible page, one group per calendar day, so the journal reads as dated entries. */
  readonly dayGroups = computed(() => {
    const groups: { key: string; day: string; month: string; weekday: string; relative: string; items: CommunicationRecord[] }[] = [];
    for (const record of this.paginatedRecords()) {
      let group = groups[groups.length - 1];
      if (!group || group.key !== record.date) {
        const parsed = this.parseDisplayDate(record.date);
        group = {
          key: record.date,
          day: parsed ? String(parsed.getDate()).padStart(2, '0') : record.date,
          month: parsed ? `${this.monthNames[parsed.getMonth()]} ${parsed.getFullYear()}` : '',
          weekday: parsed ? parsed.toLocaleDateString('en-GB', { weekday: 'long' }) : '',
          relative: parsed ? this.relativeDay(parsed) : '',
          items: [],
        };
        groups.push(group);
      }
      group.items.push(record);
    }
    return groups;
  });

  /** Channel lanes above the journal; empty channels are left out unless selected. */
  readonly lanes = computed(() => {
    const list = this.records();
    const count = (type: Channel) => list.filter((record) => record.type === type).length;

    const lanes: { id: Lane; label: string; count: number }[] = [
      { id: 'All', label: 'All', count: list.length },
      ...this.communicationTypes().map((type) => ({
        id: type.value,
        label: LANE_LABELS[type.value] ?? type.label,
        count: count(type.value),
      })),
      { id: 'Important', label: 'Important', count: list.filter((record) => record.important).length },
    ];

    return lanes.filter((lane) => lane.id === 'All' || lane.id === 'Important' || lane.count > 0 || lane.id === this.activeTab());
  });

  /** How many of the filter panel's controls are away from their default. */
  readonly activeFilterCount = computed(() =>
    [this.typeFilter() !== 'All', this.outcomeFilter() !== 'All', this.directionFilter() !== 'All',
      this.importantOnly(), !!this.dateFromFilter(), !!this.dateToFilter()].filter(Boolean).length);

  /** The last eight weeks, one tick per day, marking the days somebody was in touch. */
  readonly cadenceDays = 56;
  readonly cadence = computed(() => {
    const today = this.today();
    const byDay = new Map<string, Channel[]>();
    for (const record of this.records()) {
      byDay.set(record.date, [...(byDay.get(record.date) ?? []), record.type]);
    }
    return Array.from({ length: this.cadenceDays }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (this.cadenceDays - 1 - index));
      const label = this.toDisplayDateFrom(date);
      const types = byDay.get(label) ?? [];
      return { label, count: types.length, lead: types[0] ?? null, monday: date.getDay() === 1, today: index === this.cadenceDays - 1 };
    });
  });
  readonly cadenceActiveDays = computed(() => this.cadence().filter((day) => day.count > 0).length);

  /** The server's outcomes, in the picker's four columns. See OUTCOME_KINDS. */
  readonly outcomeGroups = computed(() => {
    const options = this.outcomeOptions();
    const groups = OUTCOME_KINDS.map((kind) => ({
      label: kind.label,
      hint: kind.hint,
      items: options.filter((option) => kind.values.includes(option.value)),
    }));

    const placed = new Set(groups.flatMap((group) => group.items.map((item) => item.value)));
    const other = options.filter((option) => !placed.has(option.value));
    if (other.length) groups.push({ label: 'Other', hint: 'Other outcomes', items: other });

    return groups.filter((group) => group.items.length > 0);
  });

  /** The last few entries, shown beside the log screen so the person writing sees what came before. */
  readonly recentEntries = computed(() => this.records().filter((record) => record.id !== this.editingId()).slice(0, 5));

  /** How many entries each channel already has, printed under the channel tiles. */
  readonly channelCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const record of this.records()) counts[record.type] = (counts[record.type] ?? 0) + 1;
    return counts;
  });

  /** The three things the save needs, ticked off live on the log screen. */
  readonly entryChecks = computed(() => {
    const value = this.form();
    const summary = value.summary.trim().length;
    const future = !!value.date && value.date > this.getTodayIso();
    return [
      { label: 'Date', detail: !value.date ? 'Pick the day it happened' : future ? 'Cannot be in the future' : this.toDisplayDate(value.date), ok: !!value.date && !future },
      { label: 'Time', detail: value.time || 'Add the time, or use now', ok: !!value.time },
      { label: 'Summary', detail: summary >= 10 ? `${summary} characters` : `${summary} of 10 characters minimum`, ok: summary >= 10 },
    ];
  });
  readonly entryReady = computed(() => this.entryChecks().every((check) => check.ok));

  /** "Add time and summary" — the missing requirements as one short phrase for the log screen's bar. */
  readonly entryMissing = computed(() => {
    const missing = this.entryChecks().filter((check) => !check.ok).map((check) => check.label.toLowerCase());
    if (!missing.length) return '';
    const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0];
    return `Add ${list}`;
  });

  /** The date block of the preview, in the journal's own day / month / weekday form. */
  readonly entryDay = computed(() => {
    const value = this.form().date;
    const parsed = value ? this.parseDisplayDate(this.toDisplayDate(value)) : null;
    if (!parsed) return { day: '—', month: 'No date', weekday: '' };
    return {
      day: String(parsed.getDate()).padStart(2, '0'),
      month: `${this.monthNames[parsed.getMonth()]} ${parsed.getFullYear()}`,
      weekday: this.relativeDay(parsed) || parsed.toLocaleDateString('en-GB', { weekday: 'long' }),
    };
  });

  /** The last seven days as picker leaves on the log screen, today last. */
  readonly entryDayStrip = computed(() => {
    const today = this.today();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - index));
      return {
        iso: this.formatIso(date),
        day: String(date.getDate()).padStart(2, '0'),
        weekday: index === 6 ? 'Today' : date.toLocaleDateString('en-GB', { weekday: 'short' }),
        month: this.monthNames[date.getMonth()],
      };
    });
  });

  /** True when the chosen date is older than the day strip, so the "Earlier" field carries it. */
  readonly entryDateEarlier = computed(() => {
    const value = this.form().date;
    return !!value && !this.entryDayStrip().some((day) => day.iso === value);
  });

  /** How far the entry is towards saveable, 0-100, drawn as the log screen's progress rule. */
  readonly entryProgress = computed(() => {
    const checks = this.entryChecks();
    return Math.round((checks.filter((check) => check.ok).length / checks.length) * 100);
  });

  /** Sentence openers offered under the summary. */
  readonly summaryStarters = ['They said ', 'They asked for ', 'We agreed ', 'Next step: '];

  /** Adds an opener on its own line at the end of the summary. */
  addStarter(text: string): void {
    const current = this.form().summary;
    const joiner = current && !current.endsWith('\n') ? '\n' : '';
    this.updateForm('summary', `${current}${joiner}${text}`.slice(0, 2000));
  }

  // ===========================================================================================
  // The figure strip and the rail
  // ===========================================================================================

  readonly totalCommunications = computed(() => this.records().length);

  readonly callsCount = computed(
    () => this.records().filter((item) => item.type === 'Call').length,
  );

  readonly meetingsCount = computed(
    () => this.records().filter((item) => item.type === 'Meeting').length,
  );

  readonly emailsCount = computed(
    () => this.records().filter((item) => item.type === 'Email').length,
  );

  /** "Interested" outcomes on the whole record - the server's count. */
  readonly interestedCount = computed(() => this.timeline()?.interestedCount ?? 0);

  /** The latest entry that was contact - an internal note is not. */
  private readonly lastContactRecord = computed(() => this.records().find((record) => record.type !== 'Note') ?? null);

  /**
   * When this person was last in contact - the server's instant, which also knows about a lead's
   * contact recorded before the timeline kept entries.
   */
  readonly lastContactDisplay = computed(() => {
    const value = this.timeline()?.lastContactedAtUtc;
    if (!value) return 'No contact yet';
    return this.formatRelativeDate(this.toDisplayDateFrom(new Date(value)));
  });

  readonly lastContactMeta = computed(() => {
    const value = this.timeline()?.lastContactedAtUtc;
    if (!value) return 'No contact logged';
    const record = this.lastContactRecord();
    const date = this.toDisplayDateFrom(new Date(value));
    return record && record.date === date ? `${date} · ${this.channelLabel(record.type)}` : date;
  });

  readonly lastUpdatedDisplay = computed(() => this.records()[0]?.date ?? '—');

  readonly callLastDateDisplay = computed(() => {
    const call = this.records().find((record) => record.type === 'Call');
    return call ? `Last on ${call.date}` : 'No calls logged';
  });

  /**
   * Health - the server's score for the lead, and its word for it.
   *
   * THIS SCREEN USED TO COMPUTE ITS OWN, from the entries it had loaded and a constant
   * engagement level, so the same lead scored one number here and another in the queue. A donor
   * who was never a lead has no score, and the figure says so rather than showing a zero.
   */
  readonly leadHealthScore = computed(() => this.timeline()?.healthScore ?? 0);
  readonly healthDisplay = computed(() => (this.timeline()?.healthBand ? String(this.leadHealthScore()) : '—'));
  readonly relationshipHealthStatus = computed(() => this.timeline()?.healthBand || 'Not scored');
  readonly relationshipHealthReason = computed(() => (this.timeline()?.healthReasons ?? []).join(' · '));

  /** Improving, Stable or Declining - from the engagement recorded on the entries. */
  readonly engagementTrend = computed(() => this.timeline()?.engagementTrend || 'Stable');

  /** High, Moderate or Low frequency - from the gaps between conversations. */
  readonly communicationTrend = computed(() => this.timeline()?.contactRhythm || '—');

  /** Follow-ups completed, of all ever planned for this person. */
  readonly followUpCompletionRate = computed(() => {
    const data = this.timeline();
    if (!data || !data.followUpCount) return 0;
    return Math.round((data.followUpCompletedCount / data.followUpCount) * 100);
  });

  /**
   * The next step - the follow-up that is actually planned, when there is one.
   *
   * IT WAS A GUESS FROM THE LAST OUTCOME ("Interested" meant "Schedule Meeting"), shown as though
   * somebody had decided it, on a screen that could not see the follow-ups already booked. The
   * server names the next open follow-up, who holds it and when it is due.
   */
  readonly suggestedAction = computed<SuggestedAction>(() => {
    const data = this.timeline();

    if (data?.nextFollowUpDueUtc) {
      const due = new Date(data.nextFollowUpDueUtc);
      const when = `${this.toDisplayDateFrom(due)}, ${due.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      const who = data.nextFollowUpAssignedTo ? ` · ${data.nextFollowUpAssignedTo}` : '';
      const reference = data.nextFollowUpReference ? `${data.nextFollowUpReference} · ` : '';
      return {
        label: data.nextFollowUpPurpose || 'Follow-up planned',
        detail: `${reference}due ${when}${who}`,
      };
    }

    if (!this.records().length) {
      return { label: 'No conversations yet', detail: 'Log the first communication, or schedule a follow-up.' };
    }

    return { label: 'No follow-up is planned', detail: 'Schedule one to keep the conversation moving.' };
  });

  /**
   * The donation link for this lead: the public form, bound to the lead's campaign and carrying
   * the lead. A gift made through it converts the lead, and the donor keeps the lead's owner.
   */
  readonly donationLink = computed(() => {
    const data = this.timeline();
    if (!data?.leadId || !data.campaignId) return '';
    return `${window.location.origin}/auth/donor-form?campaign=${data.campaignId}&lead=${data.leadId}`;
  });

  readonly linkCopied = signal(false);

  async copyDonationLink(): Promise<void> {
    const link = this.donationLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.linkCopied.set(true);
      window.setTimeout(() => this.linkCopied.set(false), 1500);
    } catch {
      this.toast.show('Not copied', 'Copy the link from the Record panel instead.', 'warning');
    }
  }

  // ===========================================================================================
  // Logging and editing
  // ===========================================================================================

  openEntryDrawer(type: Channel = 'Call'): void {
    if (!this.canLog()) return;
    this.isFilterOpen.set(false);
    this.closeActionMenu();
    this.isDetailDrawerOpen.set(false);
    this.selectedCommunication.set(null);
    this.editingId.set(null);
    this.formErrors.set([]);
    this.attempted.set(false);
    this.form.set(this.createEmptyForm(type));
    this.isEntryDrawerOpen.set(true);
  }

  editCommunication(record: CommunicationRecord): void {
    if (!record.canEdit || !this.canLog()) return;

    this.editingId.set(record.id);
    this.formErrors.set([]);
    this.attempted.set(false);

    this.form.set({
      type: record.type,
      date: this.toIsoDate(record.date),
      time: record.time,
      direction: record.direction,
      outcome: record.outcome,
      engagement: record.engagement,
      quality: record.quality,
      summary: record.summary,
      notes: record.notes ?? '',
      attachmentName: record.attachment ?? '',
      important: record.important,
    });

    this.closeActionMenu();
    this.isDetailDrawerOpen.set(false);
    this.isEntryDrawerOpen.set(true);
  }

  closeEntryDrawer(): void {
    this.isEntryDrawerOpen.set(false);
    this.editingId.set(null);
    this.formErrors.set([]);
    this.attempted.set(false);
  }

  openDetails(record: CommunicationRecord): void {
    this.selectedCommunication.set(record);
    this.isDetailDrawerOpen.set(true);
    this.closeActionMenu();
  }

  closeDetails(): void {
    this.isDetailDrawerOpen.set(false);
    this.selectedCommunication.set(null);
  }

  onAttachmentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    this.updateForm('attachmentName', file ? file.name : '');
  }

  /**
   * Saves the entry - a new one, or a correction to one the caller logged.
   *
   * EVERYTHING ON THE FORM IS SENT, AND NOTHING IS KEPT HERE. This used to push the entry into a
   * local array, then post a cut-down version to the lead's contact command: the date and time
   * the person had entered were dropped (it was recorded as "now"), engagement, quality, the star
   * and the attachment were dropped, a meeting or a visit went out as an e-mail, and for a donor
   * nothing was sent at all - the screen showed the entry and refused it in the same breath.
   *
   * The server checks an outgoing call, e-mail, SMS or WhatsApp against the person's consent, and
   * refuses a channel they have withdrawn.
   */
  saveCommunication(): void {
    if (this.saving()) return;

    const value = this.form();
    const errors = this.validateForm(value);
    this.attempted.set(true);

    // Required-field problems show on the fields themselves; the banner is for the server's word.
    this.formErrors.set([]);

    if (errors.length) {
      return;
    }

    const data = this.timeline();
    if (!data) return;

    const occurred = new Date(`${value.date}T${value.time}:00`);
    const editingId = this.editingId();
    const editing = editingId ? this.records().find((record) => record.id === editingId) : null;

    const body = {
      // A note is internal by nature; the two-way switch on the form is about contact.
      direction: value.type === 'Note' ? 'Internal' : value.direction,
      occurredAtUtc: occurred.toISOString(),
      outcome: value.outcome,
      summary: value.summary.trim(),
      notes: value.notes.trim() || null,
      engagementLevel: value.engagement || null,
      quality: value.quality || null,
      isImportant: value.important,
      attachmentName: value.attachmentName || null,
    };

    const request$: Observable<string> = editingId
      ? this.api.updateCommunication(editingId, { ...body, expectedVersion: editing?.version ?? null })
      : this.api.logCommunication({
          // Against the donor once there is one; against the lead until then.
          donorId: data.donorId ?? null,
          leadId: data.donorId ? null : data.leadId,
          interactionType: value.type,
          ...body,
        });

    this.saving.set(true);
    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeEntryDrawer();
        this.toast.show(
          editingId ? 'Communication updated' : 'Communication recorded',
          'The timeline has been updated.',
          'success',
        );
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);

        // THE SERVER'S OWN SENTENCE. A consent refusal names the channel the person did not
        // permit, and that is the whole value of the check.
        this.formErrors.set([apiErrorMessage(error, 'The communication could not be saved.')]);
      },
    });
  }

  /**
   * Marks a line important, or clears the mark - for everybody who opens this timeline.
   * It used to be a flag in this browser's memory only, gone on refresh.
   */
  toggleImportant(record: CommunicationRecord): void {
    if (!this.canLog()) return;
    this.closeActionMenu();

    const important = !record.important;

    this.api.flagCommunication(record.id, important).subscribe({
      next: () => {
        this.records.update((records) =>
          records.map((item) => (item.id === record.id ? { ...item, important, version: item.version + 1 } : item)));
        const open = this.selectedCommunication();
        if (open?.id === record.id) this.selectedCommunication.set({ ...open, important, version: open.version + 1 });
      },
      error: (error: unknown) => this.toast.show('Not saved', apiErrorMessage(error), 'error'),
    });
  }

  // ===========================================================================================
  // Temperature and donation potential
  // ===========================================================================================

  openTemperatureModal(): void {
    if (!this.canScore()) return;
    this.newTemperature.set(this.currentTemperature());
    this.temperatureReason.set('');
    this.isTemperatureModalOpen.set(true);
    this.closeActionMenu();
  }

  closeTemperatureModal(): void {
    this.isTemperatureModalOpen.set(false);
  }

  /**
   * Temperature and donation potential, saved through the lead's own scoring action.
   *
   * THEY WENT THROUGH "QUALIFY", which is a different decision: it moves the lead to the
   * Qualified stage. So noting that a lead had cooled from Warm to Cold also qualified it - and
   * the temperature itself was only written into the qualification note, never onto the lead.
   *
   * THE REASON IS THE AUDIT ENTRY, which is why the dialog insists on one.
   */
  saveTemperature(): void {
    this.saveScore(this.newTemperature(), this.donationPotential(), this.temperatureReason(), () => {
      this.isTemperatureModalOpen.set(false);
      this.toast.show('Temperature updated', `Set to ${this.newTemperature()}.`, 'success');
    });
  }

  openDonationPotentialModal(): void {
    if (!this.canScore()) return;
    this.newDonationPotential.set(this.donationPotential());
    this.donationPotentialReason.set('');
    this.isDonationPotentialModalOpen.set(true);
    this.closeActionMenu();
  }

  closeDonationPotentialModal(): void {
    this.isDonationPotentialModalOpen.set(false);
  }

  saveDonationPotential(): void {
    this.saveScore(this.currentTemperature(), this.newDonationPotential(), this.donationPotentialReason(), () => {
      this.isDonationPotentialModalOpen.set(false);
      this.toast.show('Donation potential updated', `Set to ${this.newDonationPotential()}.`, 'success');
    });
  }

  private saveScore(temperature: string, donationPotential: string, reason: string, done: () => void): void {
    const leadId = this.timeline()?.leadId;
    const text = reason.trim();

    if (!leadId || text.length < this.scoreReasonMinimum || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.api.scoreLead(leadId, { temperature, donationPotential, reason: text }).subscribe({
      next: () => {
        this.saving.set(false);
        done();
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.show('Not updated', apiErrorMessage(error), 'error');
      },
    });
  }

  openFollowUpPlanner(): void {
    const data = this.timeline();
    const donorId = data?.donorId ?? this.donorId();

    this.router.navigate(['/app/don/follow-up-planner'], {
      queryParams: donorId
        ? { donorId, mode: 'create' }
        : { leadId: data?.leadId ?? this.leadId(), mode: 'create' },
    });
  }

  // ===========================================================================================
  // Export - the server's file
  // ===========================================================================================

  openExportModal(): void {
    this.isExportModalOpen.set(true);
  }

  closeExportModal(): void {
    this.isExportModalOpen.set(false);
  }

  readonly exporting = signal(false);

  /**
   * The whole timeline as a spreadsheet, written by the server.
   *
   * THE FILE WAS BUILT IN THE BROWSER, with no permission asked and no record that somebody had
   * taken a copy of a person's conversations. The server's export needs `don.donors.export`,
   * masks the notes exactly as the screen does, and logs it.
   */
  exportAsExcel(): void {
    this.isExportModalOpen.set(false);
    this.fetchExport(({ blob, fileName }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  /**
   * A print-ready copy of the same export.
   *
   * WRITTEN INTO A HIDDEN IFRAME, not printed from the live page: `window.print()` on the page
   * itself captured the export popup and the app's sidebar and header with it.
   */
  exportAsPdf(): void {
    this.isExportModalOpen.set(false);
    this.fetchExport(({ blob }) => {
      void blob.text().then((text) => this.printExport(parseCsv(text)));
    });
  }

  private fetchExport(done: (file: { blob: Blob; fileName: string }) => void): void {
    if (this.exporting()) return;
    this.exporting.set(true);

    this.api.exportCommunicationTimeline(this.leadId(), this.donorId()).subscribe({
      next: (file) => {
        this.exporting.set(false);
        done(file);
      },
      error: (error: unknown) => {
        this.exporting.set(false);
        this.toast.show('Not exported', apiErrorMessage(error, 'The timeline could not be exported.'), 'error');
      },
    });
  }

  private printExport(table: string[][]): void {
    const esc = (v: unknown): string =>
      String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const [headers = [], ...rows] = table;
    const rel = this.relationship();

    // The columns that fit a page, by their headings in the server's file.
    const wanted = ['Date', 'Type', 'Direction', 'Outcome', 'Engagement', 'Recorded by', 'Summary'];
    const columns = wanted.map((name) => headers.indexOf(name)).filter((index) => index >= 0);

    const head = columns.map((index) => `<th>${esc(headers[index])}</th>`).join('');
    const body = rows
      .map((row) => `<tr>${columns.map((index) => `<td>${esc(row[index])}</td>`).join('')}</tr>`)
      .join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Communication timeline - ${esc(rel.reference)}</title>
<style>
  body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#1f2933;margin:24px}
  h1{font-size:18px;margin:0 0 4px} p{margin:0 0 14px;color:#52606d}
  table{width:100%;border-collapse:collapse} th,td{border:1px solid #d9dee3;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f1f4f6;font-size:11px;text-transform:uppercase;letter-spacing:.3px} small{color:#7b8794}
  tr{page-break-inside:avoid}
</style></head><body>
<h1>Communication timeline - ${esc(rel.name || 'Communication record')}</h1>
<p>${esc(rel.reference)} &middot; ${rows.length} entries &middot; Generated ${esc(new Date().toLocaleString())}</p>
<table><thead><tr>${head}</tr></thead>
<tbody>${body || `<tr><td colspan="${columns.length || 1}">No entries on this timeline.</td></tr>`}</tbody></table>
</body></html>`;

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow?.document;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    // Let the iframe lay out before the print dialog opens, then clean up once it closes.
    window.setTimeout(() => {
      const win = frame.contentWindow;
      if (!win) return;
      win.onafterprint = () => frame.remove();
      win.focus();
      win.print();
      window.setTimeout(() => frame.remove(), 60000);
    }, 150);
  }

  refreshTimeline(): void {
    this.isRefreshing.set(true);
    this.isFilterOpen.set(false);
    this.closeActionMenu();
    window.setTimeout(() => { this.load(); this.isRefreshing.set(false); }, 150);
  }

  /**
   * Back to wherever this timeline was opened from.
   *
   * IT ALWAYS WENT TO "MY LEADS" for a lead - a screen a Fundraising Manager, who arrives from
   * the Lead Work Queue, does not have on their menu. The timeline is reached from five places;
   * the way back is the way in. Opened cold (a bookmark, a new tab), it goes to the list the
   * caller's role works from.
   */
  handleOpenMyLeads(): void {
    this.navigateToLeads.emit();

    if (this.isDonor()) {
      this.navHistory.back(['/app/fundraising/relationships/donor-360'], {
        queryParams: { donorId: this.timeline()?.donorId ?? this.donorId(), tab: 'overview' },
      });
      return;
    }

    this.navHistory.back([
      this.tokens.hasPermission('don.records.view-all')
        ? '/app/fundraising/relationships/lead-work-queue'
        : '/app/fundraising/relationships/my-leads',
    ]);
  }

  toggleFilterPanel(): void {
    this.isFilterOpen.update((open) => !open);
  }

  toggleActionMenu(record: CommunicationRecord): void {
    if (this.isActionMenuOpen() && this.menuRecordId() === record.id) {
      this.closeActionMenu();
      return;
    }

    this.isActionMenuOpen.set(true);
    this.menuRecordId.set(record.id);
  }

  closeActionMenu(): void {
    this.isActionMenuOpen.set(false);
    this.menuRecordId.set(null);
  }

  setTab(tab: Lane): void {
    this.activeTab.set(tab);
    this.currentPage.set(1);
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  goToPage(page: number): void {
    this.currentPage.set(Math.min(Math.max(page, 1), this.totalPages()));
  }

  resetFilters(): void {
    this.typeFilter.set('All');
    this.directionFilter.set('All');
    this.outcomeFilter.set('All');
    this.importantOnly.set(false);
    this.dateFromFilter.set('');
    this.dateToFilter.set('');
    this.searchQuery.set('');
    this.currentPage.set(1);
  }

  /**
   * The line's heading: what kind of contact it was and which way it went.
   *
   * IT WAS A FIXED PHRASE PER CHANNEL - every e-mail was "Campaign information sent", every
   * meeting "Review meeting planned" - so the heading described an exchange that had not
   * necessarily happened. Direction and channel are what the entry actually records.
   */
  timelineTitle(record: CommunicationRecord): string {
    if (record.type === 'Note' || record.direction === 'Internal') return this.channelLabel(record.type);
    return `${record.direction} ${this.channelNoun(record.type)}`;
  }

  /** Lower-case key for the per-channel colour classes. */
  channelKey(type: Channel): string {
    return type.toLowerCase();
  }

  /** The server's label for a channel: "SMS", "Internal note". */
  channelLabel(type: Channel): string {
    return this.communicationTypes().find((option) => option.value === type)?.label ?? type;
  }

  /** The channel as it reads mid-sentence ("Outgoing call", "Incoming WhatsApp"). */
  channelNoun(type: Channel): string {
    const label = this.channelLabel(type);
    return type === 'Sms' || type === 'WhatsApp' ? label : label.toLowerCase();
  }

  /** The server's label for an outcome value on the form. */
  outcomeLabel(value: string): string {
    return this.labelIn(this.outcomeOptions(), value);
  }

  /** Fills the date and time with this moment. */
  setNow(): void {
    if (this.editingId()) return;
    const now = new Date();
    this.updateForm('date', this.getTodayIso());
    this.updateForm('time', `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  }

  private relativeDay(date: Date): string {
    const diff = this.daysBetween(date, this.today());
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1) return `${diff} days ago`;
    return '';
  }

  outcomeClass(outcome: string): string {
    switch (outcome) {
      case 'Interested':
      case 'MeetingCompleted':
      case 'DonationDiscussion':
        return 'status-success';
      case 'NoAnswer':
      case 'CallbackRequested':
      case 'InformationRequested':
        return 'status-warning';
      case 'NotInterested':
      case 'WrongNumber':
      case 'DoNotContact':
        return 'status-danger';
      default:
        return 'status-neutral';
    }
  }

  relationshipHealthClass(status: string): string {
    switch (status) {
      case 'Healthy': return 'health-healthy';
      case 'Needs attention': return 'health-attention';
      case 'At risk': return 'health-risk';
      default: return '';
    }
  }

  getTodayIso(): string {
    return this.formatIso(this.today());
  }

  updateForm<K extends keyof CommunicationForm>(
    key: K,
    value: CommunicationForm[K],
  ): void {
    this.form.update((current) => ({
      ...current,
      [key]: value,
    }));
  }

  /** Picks a level, or clears it when the chosen one is pressed again: neither is required. */
  toggleLevel(key: 'engagement' | 'quality', value: string): void {
    this.updateForm(key, this.form()[key] === value ? '' : value);
  }

  private validateForm(value: CommunicationForm): string[] {
    const errors: string[] = [];

    if (!value.date) {
      errors.push('Communication date is required.');
    } else if (value.date > this.getTodayIso()) {
      errors.push('Communication date cannot be in the future.');
    }

    if (!value.time) {
      errors.push('Communication time is required.');
    } else if (value.date && new Date(`${value.date}T${value.time}:00`).getTime() > Date.now() + 60_000) {
      errors.push('Communication time cannot be in the future.');
    }

    const summaryLength = value.summary.trim().length;
    if (summaryLength < 10) {
      errors.push('Summary must be at least 10 characters.');
    } else if (value.summary.length > 2000) {
      errors.push('Summary cannot exceed 2000 characters.');
    }

    if (value.notes.length > 3000) {
      errors.push('Internal notes cannot exceed 3000 characters.');
    }

    return errors;
  }

  /**
   * A blank entry. Engagement and quality start unset: they are the logger's judgement, and a
   * pre-selected "Medium" and "Good" were being saved as though somebody had chosen them.
   */
  private createEmptyForm(type: Channel): CommunicationForm {
    return {
      type,
      date: this.getTodayIso(),
      time: '',
      direction: 'Outgoing',
      outcome: 'Reached',
      engagement: '',
      quality: '',
      summary: '',
      notes: '',
      attachmentName: '',
      important: false,
    };
  }

  private today(): Date {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  private daysBetween(earlier: Date, later: Date): number {
    return Math.round((later.getTime() - earlier.getTime()) / 86400000);
  }

  private parseDisplayDate(value: string): Date | null {
    const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (!match) return null;

    const [, day, mon, year] = match;
    const month = this.monthMap[mon];
    if (month === undefined) return null;

    return new Date(Number(year), month, Number(day));
  }

  private formatRelativeDate(displayDate: string): string {
    const date = this.parseDisplayDate(displayDate);
    if (!date) return displayDate;

    const diff = this.daysBetween(date, this.today());

    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff === -1) return 'Tomorrow';
    if (diff > 1) return `${diff} Days Ago`;
    if (diff < -1) return `In ${Math.abs(diff)} Days`;
    return displayDate;
  }

  private formatIso(date: Date): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private toDisplayDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return `${d} ${this.monthNames[m - 1]} ${y}`;
  }

  private toIsoDate(display: string): string {
    const parsed = this.parseDisplayDate(display);
    if (!parsed) return '';
    return this.formatIso(parsed);
  }
}
