import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { LeadConsentSummary, LeadDetail } from '../../../../Shared/models/donor-contract.model';

/**
 * The part of a queue row this screen draws. The Lead Work Queue's own `LeadItem` has every one of
 * these fields, so the queue passes its row straight in; the profile asks for no more than it shows,
 * which keeps it usable from any screen that can name a lead (My Leads, the Assignment Board ...).
 */
export interface LeadProfileLead {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly mobile: string;
  readonly email: string;
  readonly source: string;
  readonly campaign: string;
  /** The lead's campaign by id, for the donation link. */
  readonly campaignId: string;
  readonly stage: string;
  readonly temperature: string;
  readonly donationPotential: string;
  readonly owner: string;
  /** Somebody owns the lead. Read off the owner's id, not off the word shown for nobody. */
  readonly hasOwner: boolean;
  readonly lastActivity: string;
  readonly nextFollowUp: string;
  readonly healthScore: number;
  /** The server's word for the score: Healthy, Needs attention or At risk. */
  readonly healthBand: string;
  readonly lastContactOutcome: string;
  readonly language: string;
  /** The server's `isContactMasked`: the caller may not read the contact details. */
  readonly masked: boolean;
  readonly converted: boolean;
}

/** What the caller may do from the profile; the server decides, the screen only reads it. */
export interface LeadProfilePermissions {
  readonly schedule: boolean;
  readonly communicate: boolean;
}

/** The channels lead capture records consent for, in the order the register lists them. */
const CONSENT_CHANNELS = [
  { key: 'email', label: 'E-mail', glyph: 'ri-mail-line' },
  { key: 'sms', label: 'SMS', glyph: 'ri-message-2-line' },
  { key: 'whatsapp', label: 'WhatsApp', glyph: 'ri-whatsapp-line' },
  { key: 'phone', label: 'Phone call', glyph: 'ri-phone-line' },
] as const;

/**
 * LEAD PROFILE - everything known about one lead, as a page inside the app shell.
 *
 * It takes the queue's place (the side menu and top bar stay), and shows what was entered when the
 * lead was captured plus everything recorded since: identity and contact, origin and ownership,
 * location, notes, engagement, lifecycle dates and the consent register. The register lists ONLY the
 * channels the person opted in to; channels that were refused, withdrawn, pending or never asked
 * about are left out on purpose.
 *
 * The queue row carries what the table draws, so the profile reads the full record itself
 * (`getLead`). The row's fields show at once and the rest fills in when the record arrives.
 *
 * It decides nothing: closing, reassigning, scheduling and communicating are events the host
 * answers, so each destination and each permission stays where it already lived.
 */
@Component({
  selector: 'app-lead-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lead-profile.html',
  styleUrl: './lead-profile.css',
})
export class LeadProfileComponent {
  private readonly api = inject(DonorApiService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  /** The lead to show (the row from the host's list). */
  readonly leadInput = input.required<LeadProfileLead>({ alias: 'lead' });
  readonly permissions = input.required<LeadProfilePermissions>();
  /** Reassign is offered: the caller may route leads and this one is still in the queue. */
  readonly canRoute = input(false);
  /** Mark lost / Mark dormant are offered: the server lists Close for this lead and caller. */
  readonly canClose = input(false);
  /** A close is in flight; its buttons are disabled meanwhile. */
  readonly closing = input(false);
  /** The server's potential levels, lowest first: where a potential sits fills the bars. */
  readonly potentialOrder = input<readonly string[]>([]);

  readonly back = output<void>();
  readonly reassign = output<void>();
  readonly schedule = output<void>();
  readonly communicate = output<void>();
  readonly closeLead = output<'Lost' | 'Dormant'>();

  protected readonly detail = signal<LeadDetail | null>(null);
  protected readonly detailState = signal<'idle' | 'loading' | 'error'>('idle');
  protected readonly copiedField = signal<string | null>(null);
  private detailSubscription: Subscription | null = null;

  /** The channels the person opted in to, each with its consent record. */
  protected readonly granted = computed(() => this.grantedConsents(this.detail()));

  /**
   * The link to give this lead for the public donation form. The lead on the link is what makes the
   * gift a conversion; the host is the organisation's own, which is how the form knows whose campaign
   * it is.
   */
  protected readonly donationLink = computed(() => {
    const lead = this.leadInput();
    const origin = this.document.defaultView?.location.origin ?? '';
    return `${origin}/auth/donor-form?campaign=${lead.campaignId}&lead=${lead.id}`;
  });

  constructor() {
    effect(() => {
      const id = this.leadInput().id;
      untracked(() => this.loadDetail(id));
    });
    this.destroyRef.onDestroy(() => this.detailSubscription?.unsubscribe());
  }

  /** Esc leaves the profile and returns to the host's list. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.back.emit();
  }

  protected loadDetail(id: string): void {
    this.detailSubscription?.unsubscribe();
    this.detail.set(null);
    this.detailState.set('loading');
    this.detailSubscription = this.api.getLead(id).subscribe({
      next: (lead) => {
        this.detail.set(lead);
        this.detailState.set('idle');
      },
      error: () => this.detailState.set('error'),
    });
  }

  /**
   * The opted-in channels. A channel that was never asked about, is pending, or was refused or
   * withdrawn is not listed: the profile shows what the person agreed to, not everything they did not.
   */
  protected grantedConsents(detail: LeadDetail | null): readonly { label: string; glyph: string; record: LeadConsentSummary }[] {
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
    const rows: { label: string; glyph: string; record: LeadConsentSummary }[] = [];
    for (const channel of CONSENT_CHANNELS) {
      const record = detail?.consents?.find(
        (r) => norm(r.channel).startsWith(channel.key) && (r.consentState ?? '').toLowerCase() === 'granted',
      );
      if (record) {
        rows.push({ label: channel.label, glyph: channel.glyph, record });
      }
    }
    return rows;
  }

  protected consentTone(state: string | null | undefined): string {
    switch ((state ?? '').toLowerCase()) {
      case 'granted': return 'ok';
      case 'withdrawn': case 'refused': case 'donotcontact': return 'no';
      case 'pending': return 'wait';
      default: return 'none';
    }
  }

  /** The ring's colour, from the server's reading of the score (decided once, on the server). */
  protected healthClass(band: string): string {
    switch (band) {
      case 'Healthy': return 'lq-health-high';
      case 'Needs attention': return 'lq-health-mid';
      default: return 'lq-health-low';
    }
  }

  /** How many of the three bars a potential fills: its place in the server's order, lowest first. */
  protected potentialLevel(potential: string): number {
    const index = this.potentialOrder().indexOf(potential);
    return index < 0 ? 0 : Math.min(3, index + 1);
  }

  protected displayValue(value: string | null | undefined): string {
    return value && value.trim().length > 0 ? value : '-';
  }

  protected whenDate(value: string | null | undefined): string {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '-';
  }

  protected whenDateTime(value: string | null | undefined): string {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '-';
  }

  /** The best time to call. Stored as a UTC time; shown as the caller's local clock time. */
  protected contactTime(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }
    const plain = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
    if (plain) {
      return `${plain[1].padStart(2, '0')}:${plain[2]}`;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? '-'
      : parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  protected async copyValue(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copiedField.set(label);
      setTimeout(() => {
        if (this.copiedField() === label) {
          this.copiedField.set(null);
        }
      }, 1500);
    } catch {
      this.copiedField.set(null);
    }
  }
}
