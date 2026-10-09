import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { DonLookupItem, Donor360Response } from '../../../../Shared/models/donor-contract.model';
import { FormsModule } from '@angular/forms';
import {
  UiState,
  Donor360Data,
  ConfirmDialogConfig,
} from '../../../../Shared/models/donors-leads.model';
import { effect, ElementRef, ViewChild } from '@angular/core';


@Component({
  selector: 'app-donor-360',
  imports: [CommonModule, FormsModule],
  templateUrl: './donor-360.html',
  styleUrl: './donor-360.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Donor360Component {
    readonly pageSize = 10;
    readonly pages = signal<Record<string, number>>({});
    readonly upcoming = computed(() => (this.response()?.followUps ?? []).filter(f => f.isOpen).slice().sort((a,b) => (a.dueAtUtc ? Date.parse(a.dueAtUtc) : Infinity) - (b.dueAtUtc ? Date.parse(b.dueAtUtc) : Infinity)));
    readonly latestDocument = computed(() => this.documents().slice().sort((a,b) => Date.parse(b.uploadedOn)-Date.parse(a.uploadedOn))[0]);
    tabCount(id: TabId): number {
      switch (id) {
        case 'donations': return this.totalDonationsCount();
        case 'follow-ups': return this.upcoming().length;
        case 'documents': return this.documents().length;
        case 'activity': return this.activity().length;
        case 'consent': return this.channelConsents().length;
        default: return 0;
      }
    }
    filtered<T extends object>(rows: readonly T[]): T[] { const q = this.searchTerm().trim().toLowerCase(); return rows.filter(row => !q || Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))); }
    pageCount(rows: readonly object[]): number { return Math.max(1, Math.ceil(this.filtered(rows).length / this.pageSize)); }
    pageNumber(key: string, rows: readonly object[]): number { return Math.min(this.pages()[key] ?? 1, this.pageCount(rows)); }
    paged<T extends object>(key: string, rows: readonly T[]): T[] { const start=(this.pageNumber(key,rows)-1)*this.pageSize; return this.filtered(rows).slice(start,start+this.pageSize); }
    movePage(key: string, rows: readonly object[], delta: number): void { this.pages.update(p => ({...p,[key]:Math.max(1,Math.min(this.pageCount(rows),this.pageNumber(key,rows)+delta))})); }
    selectTab(tab: TabId): void { this.activeTab.set(tab); this.searchTerm.set(''); this.pages.set({}); this.followUpView.set('all'); }

    /** Follow-ups tab: which slice of the agenda is shown (All / Open / Overdue / Closed). */
    readonly followUpView = signal<FollowUpView>('all');
    readonly followUpViews: { id: FollowUpView; label: string }[] = [
      { id: 'all', label: 'All' }, { id: 'open', label: 'Open' }, { id: 'overdue', label: 'Overdue' }, { id: 'closed', label: 'Closed' },
    ];
    readonly followUpRows = computed(() => {
      const view = this.followUpView();
      return this.followUps().filter((f) => view === 'all' || this.followUpBucket(f) === view);
    });
    followUpViewCount(view: FollowUpView): number {
      return view === 'all' ? this.followUps().length : this.followUps().filter((f) => this.followUpBucket(f) === view).length;
    }
    setFollowUpView(view: FollowUpView): void { this.followUpView.set(view); this.pages.update((p) => ({ ...p, 'follow-ups': 1 })); }

    /**
     * Open, overdue or closed - from the server's own flags.
     *
     * "OVERDUE" IS NOT A STATUS THE API HAS, so reading it off `status` meant the Overdue view was
     * always empty and the overdue count beside the title was always zero, however late the
     * follow-up. The server says whether a follow-up is open and whether it is past its date.
     */
    private followUpBucket(followUp: FollowUpItem): FollowUpView {
      if (followUp.isOverdue) return 'overdue';
      return followUp.isOpen ? 'open' : 'closed';
    }

    /**
     * The giving ledger: each stage against the money received.
     *
     * THE STAGES OVERLAP, SO THEY CANNOT BE ADDED UP. Reconciled is the part of Received the bank
     * has confirmed; adding the two counted the same gifts twice, and the ledger's "Total on
     * record" for a donor who had given 14,000 read 26,000. Each stage's bar is now its size
     * against what has been received, and the figure underneath is the amount received.
     */
    readonly stageLedger = computed(() => {
      const stages = this.donationTotals();
      const received = this.lifetimeGiving();
      const base = received > 0 ? received : Math.max(0, ...stages.map((stage) => stage.amount));
      return {
        total: received,
        rows: stages.map((stage, index) => ({
          ...stage,
          tone: index % 5,
          share: base ? Math.min(100, Math.round((stage.amount / base) * 100)) : 0,
        })),
      };
    });

    /** "24 Sep 2026" → "Thu", for agenda and chronicle rows. */
    weekdayOf(date: string): string {
      const parsed = date ? new Date(date) : null;
      return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString('en-GB', { weekday: 'short' }) : '';
    }

    /** A file-type glyph from the document's name. */
    docIcon(name: string): string {
      const ext = (name.split('.').pop() ?? '').toLowerCase();
      if (ext === 'pdf') return 'ri-file-pdf-2-line';
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'ri-image-line';
      if (['doc', 'docx'].includes(ext)) return 'ri-file-word-line';
      if (['xls', 'xlsx', 'csv'].includes(ext)) return 'ri-file-excel-line';
      return 'ri-file-text-line';
    }

    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly api = inject(DonorApiService);
    private readonly toast = inject(ToastService);

    /** The server's answer for this donor, or null until it arrives. */
    readonly response = signal<Donor360Response | null>(null);
    readonly leadId = signal(this.route.snapshot.queryParamMap.get('leadId'));
    readonly donorId = signal(this.route.snapshot.queryParamMap.get('donorId'));



  
    // ============================================================
    // ACTION DIALOG — a single native <dialog>, opened/closed
    // imperatively so it always renders in the browser's top layer.
    // This guarantees correct centred positioning even if this
    // component is later embedded inside a host shell that applies
    // a transform/filter/will-change to an ancestor element — a
    // transformed ancestor turns position:fixed into "fixed relative
    // to that ancestor" instead of the viewport, which is the classic
    // cause of a dialog appearing pinned to the top-left. <dialog>
    // shown via showModal() sits outside normal layout entirely, so
    // that problem cannot happen.
    // ============================================================
    @ViewChild('actionDialog') actionDialogRef?: ElementRef<HTMLDialogElement>;
  
    constructor() {
      this.load();

      // The pledge form's currencies. A failure leaves the list empty and the form on the donor's
      // own currency, rather than offering a guess.
      this.api.getReferenceData().subscribe({
        next: (reference) => this.currencyCatalogue.set(reference.currencies ?? []),
        error: () => this.currencyCatalogue.set([]),
      });

      effect(() => {
        const action = this.activeAction();
        const dialog = this.actionDialogRef?.nativeElement;
        if (!dialog) return;
        if (action && !dialog.open) {
          dialog.showModal();
        } else if (!action && dialog.open) {
          dialog.close();
        }
      });
    }
  
    // ============================================================
    // PERMISSIONS
    //
    // ONE SOURCE: the server's `permittedActions` for this caller and this record. The screen
    // used to hold a `permissionMap` keyed by eight role names, and `hasPermission` looked the
    // selected role up in it - so what a person could do was decided by a dropdown next to the
    // page title rather than by their token.
    //
    // THE THREE-ROLE MODEL NEEDS NO CODE HERE. TENANT_ADMIN, INITIATOR and APPROVER differ only
    // in which codes IAM issues them: an APPROVER holds `don.donor-360.correct` (Edit is theirs)
    // but not `don.donors.create`, and this screen simply draws what it is told.
    // ============================================================

    /**
     * THE SERVER ANSWERS IN VERBS: ['View','Correct','Follow up','Create intent'].
     *
     * The screen asks in permission codes because that is what its template was written against,
     * so the two vocabularies are reconciled here rather than in twenty template expressions.
     * Comparing the codes directly matched nothing, which hid every action on the page.
     */
    hasPermission(permission: string): boolean {
      const permitted = this.response()?.permittedActions ?? [];

      switch (permission) {
        // Seeing the donor's real e-mail and phone is the server's decision, and it has already
        // made it: a masked value arrives masked. This only gates the label beside it.
        case 'don.contact.view': return permitted.includes('View');
        case 'don.donor-360.correct': return permitted.includes('Correct');
        case 'don.donor-360.follow-up': return permitted.includes('Follow up');
        case 'don.donor-360.create-intent': return permitted.includes('Create intent');
        // "Delete UNUSED draft" is the server's wording (GetDonor360Query.BuildPermittedActions).
        // Matching on 'Delete draft' matched nothing, so the action was dead even for the people
        // and the records the server had already cleared.
        case 'don.donor-360.delete-draft': return permitted.includes('Delete unused draft');
        case 'don.donor-360.view': return permitted.includes('View');
        default: return permitted.includes(permission);
      }
    }
  
    // ============================================================
    // SCREEN STATE
    //
    // IT IS NOW AN OUTCOME, NOT A CHOICE. A "scenario" dropdown let anybody put the page into
    // 'conflict' or 'no-access' to look at it; the states below are reached by what the API
    // actually answered - a 403 is no-access, a failed call is a dependency failure, and an
    // absent donor is empty.
    // ============================================================

    scenario = signal<Scenario>('loading');

    readonly effectiveState = computed<Scenario>(() => this.scenario());

    setScenario(id: Scenario) {
      this.scenario.set(id);
      this.activeAction.set(null);
      this.successPanel.set(null);
      this.dependencyNotice.set(false);
    }
  
    // ============================================================
    // RECORD DATA
    //
    // ALL OF IT FROM `GET /api/v1/donors/donor-360/{id}`, which answers the profile, the consent
    // state, the totals by stage, the campaign history, the conversations, the follow-ups, the
    // promises, the documents, the duplicate links and the activity trail in ONE call.
    //
    // WHAT WAS HERE BEFORE. `donationTotals`, `campaignHistory`, `promises`, `documents` and
    // `duplicateLinks` were arrays typed into this file - "Winter Relief Appeal, 65000",
    // "Meera Krishnan", "meera.krishnan@example.com" - so every donor in every organisation
    // showed the same lifetime giving, the same three campaigns and the same two conversations.
    // The KPI tiles across the top were computed from those arrays, so they were constants too.
    // ============================================================

    readonly donor = computed(() => {
      const response = this.response();
      const detail = response?.donor;
      const consent = response?.consentStatus;

      return {
        reference: response?.donorReference ?? '',
        fullName: detail?.displayName ?? '',
        lifecycleState: detail?.status ?? '',
        owner: detail?.relationshipOwnerName ?? 'Unassigned',
        freshness: detail?.updatedAtUtc ? this.formatDate(detail.updatedAtUtc) : '',

        // ALREADY MASKED, OR ALREADY NOT. `isEmailMasked` says which, and the screen reports it
        // rather than deciding - the old page unmasked on a client-side role check.
        email: detail?.primaryEmail ?? '',
        phone: detail?.primaryPhone ?? '',

        // THE SERVER'S WORD, OR "NOT PROVIDED". It used to fall back to "Granted", so a donor
        // nobody had ever asked read as having consented.
        consentStatus: consent?.overallState || 'Not provided',
        consentUpdated: consent?.lastRecordedAtUtc ? this.formatDate(consent.lastRecordedAtUtc) : '',
        // GRANTED CHANNELS ONLY. Listing a channel the donor has withdrawn as "permitted"
        // beside a Communicate button is how somebody ends up contacting them on it.
        consentChannels: (response?.communicationPreferences ?? [])
          .filter((preference) => preference.consentState === 'Granted')
          .map((preference) => preference.channel)
          .join(', ') || 'No permitted channels',
        doNotContact: detail?.doNotContact ?? false,
      };
    });

    readonly donationTotals = computed<DonationStage[]>(() =>
      (this.response()?.donationTotalsByStage ?? []).map((total) => ({
        stage: total.stage,
        amount: total.totalAmount,
        asOf: this.formatDate(total.asAtUtc),
      })),
    );

    readonly campaignHistory = computed<CampaignHistoryItem[]>(() =>
      (this.response()?.campaignHistory ?? []).map((entry) => ({
        id: entry.campaignCode,
        name: entry.campaignName,

        // THE LEAD THIS DONOR CAME FROM. The document's conversion rule is that a converted lead
        // keeps its history, and this row is where that history is visible.
        role: entry.leadReference || 'Donor',

        // WHAT THE DONOR GAVE TO THE CAMPAIGN, from the payments module. It was the literal 0.
        amount: entry.amount ?? 0,
        gifts: entry.giftCount ?? 0,
        lastGift: entry.lastGiftAtUtc ? this.formatDate(entry.lastGiftAtUtc) : '',
        date: entry.convertedAtUtc ? this.formatDate(entry.convertedAtUtc) : '',
        status: entry.convertedAtUtc ? 'Converted' : '',
      })),
    );

    /** Every gift, newest first, as the payments module recorded it. */
    readonly gifts = computed<GiftItem[]>(() =>
      (this.response()?.donations ?? []).map((gift) => ({
        id: gift.id,
        reference: gift.reference,
        date: this.formatDate(gift.donatedAtUtc),
        campaign: gift.campaignName ?? '',
        amount: gift.amount,
        refunded: gift.refundedAmount ?? 0,
        currency: gift.currency,
        status: gift.status,
      })),
    );

    readonly conversations = computed<ConversationItem[]>(() =>
      (this.response()?.conversations ?? []).map((conversation) => ({
        id: conversation.id,
        channel: conversation.channel ?? conversation.interactionType,
        summary: conversation.description ?? conversation.name,
        date: this.formatDate(conversation.occurredAtUtc),
        owner: conversation.performedByName ?? '',
      })),
    );

    readonly followUps = computed<FollowUpItem[]>(() =>
      (this.response()?.followUps ?? []).map((followUp) => ({
        id: followUp.id,
        title: followUp.nextAction ?? followUp.purpose ?? followUp.followUpReference,
        due: followUp.dueAtUtc ? this.formatDate(followUp.dueAtUtc) : '',
        owner: followUp.relationshipOwnerName ?? '',

        // What a person reads: an open follow-up past its date is "Overdue", whatever stage of
        // planning it had reached.
        status: followUp.isOverdue ? 'Overdue' : followUp.status,
        priority: followUp.priority ?? '',
        isOpen: followUp.isOpen,
        isOverdue: followUp.isOverdue,

        // WHO MAY EXECUTE IT IS THE SERVER'S ANSWER: the person it is assigned to, and the
        // Organisation Admin. Everybody else who can see the donor sees the follow-up and who
        // holds it.
        isMine: followUp.canExecute,
      })),
    );

    readonly promises = computed<PromiseItem[]>(() =>
      (this.response()?.promises ?? []).map((promise) => ({
        id: promise.reference,
        amount: promise.amount,
        currency: promise.currency,
        dueDate: promise.dueAtUtc ? this.formatDate(promise.dueAtUtc) : '',
        status: promise.status,
      })),
    );

    readonly documents = computed<DocumentItem[]>(() =>
      (this.response()?.documents ?? []).map((document) => ({
        id: document.reference,
        name: document.name,
        type: document.classification,
        uploadedOn: this.formatDate(document.createdAtUtc),
        classification: document.classification,
      })),
    );

    readonly duplicateLinks = computed<DuplicateLink[]>(() =>
      (this.response()?.duplicateLinks ?? []).map((link) => ({
        id: link.mergeCaseId,
        reference: link.reviewReference,
        matchReason: link.comparisonRoute,
        similarity: link.identityConfidence,
      })),
    );

    private formatDate(value: string | null): string {
      if (!value) {
        return '';
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime())
        ? ''
        : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    /**
     * Loads the donor.
     *
     * A 403 IS NOT AN EMPTY DONOR. Rendering a blank profile for somebody who lacks
     * don.donor-360.view tells them the donor has no details, which is false and, on a screen
     * that exists to show a person's giving history, actively misleading.
     */
    private load(): void {
      const donorId = this.donorId();
      if (!donorId) {
        this.scenario.set('empty');
        return;
      }

      this.scenario.set('loading');
      this.api.getDonor360(donorId).subscribe({
        next: (response) => {
          this.response.set(response);
          this.scenario.set('loaded');
        },
        error: (error: unknown) => {
          const status = (error as { status?: number })?.status;
          this.scenario.set(status === 403 ? 'no-access' : 'dependency-failure');
          this.toast.show('Donor 360 unavailable', apiErrorMessage(error), 'error');
        },
      });
    }

  
    // WHO DID IT, in the last column - it printed the record type ("Donor", "FollowUpTask").
    readonly activity = computed<ActivityItem[]>(() => (this.response()?.activityHistory ?? []).slice().sort((a,b) => Date.parse(b.occurredAtUtc)-Date.parse(a.occurredAtUtc)).map(a => ({ id:a.id, actor:a.actorName ?? '', action:a.reason || a.actionCode, timestamp:this.formatDate(a.occurredAtUtc) })));
  
    // ============================================================
    // TABS — progressive disclosure of the main work area
    // ============================================================
  
    // THE ROLE FLOW'S FIVE: Overview, Donations, Follow-ups, Consent, Activity history. Consent had
    // a finished panel that only a hand-typed `?tab=consent` could reach. Documents stays one
    // click away - "View all" beside the latest document on Overview - rather than as a tab.
    readonly tabs: { id: TabId; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'donations', label: 'Donations' },
      { id: 'follow-ups', label: 'Follow-Ups' },
      { id: 'consent', label: 'Consent' },
      { id: 'activity', label: 'Activity history' },
    ];
    activeTab = signal<TabId>((this.route.snapshot.queryParamMap.get('tab') as TabId | null) ?? 'overview');
  
    // ============================================================
    // WORKFLOW ACTIONS — Correct / Follow up / Create intent / Delete draft
    // ============================================================
  
    activeAction = signal<'correct' | 'create-intent' | 'delete-draft' | null>(null);
    successPanel = signal<SuccessPanel | null>(null);
    dependencyNotice = signal(false);
  
    // Delete draft form state
    deleteReason = signal('');
    deleteConfirmText = signal('');
    deleteErrors = signal<Record<string, string>>({});
  
    /**
     * Create intent form state.
     *
     * IT ASKED FOR THE WRONG THINGS. The dialog collected "Full name" and "Source" - fields the
     * donor already has, on a screen that is about that donor - while the endpoint behind it
     * takes an amount, a currency and a note, because what it records is a PLEDGE. It is
     * `POST donor-360/{id}/create-intent`, it writes a DonorPromise, and it is not a payment
     * request; the donor pays through their own donation link.
     */
    intentAmount = signal<number | null>(null);
    intentCurrency = signal('INR');
    intentDueDate = signal('');
    intentNotes = signal('');
    intentErrors = signal<Record<string, string>>({});

    // Presentation for the "Record a pledge" note: quick amounts, currency glyph, amount in words,
    // date shortcuts and the one-line pledge statement. None of it changes what is submitted.

    /**
     * The currencies a pledge may be recorded in - the active ones in the currency master.
     *
     * THEY WERE SIX CODES TYPED INTO THIS FILE, so a currency the platform had switched on was
     * missing and one it had switched off was still offered. `description` is the symbol.
     */
    private readonly currencyCatalogue = signal<DonLookupItem[]>([]);
    readonly intentCurrencies = computed(() => this.currencyCatalogue().map((currency) => currency.value));
    readonly intentPresets = [5000, 10000, 25000, 50000, 100000];
    readonly intentDueShortcuts = [
      { id: 'two-weeks', label: 'In 2 weeks' },
      { id: 'month-end', label: 'End of month' },
      { id: 'quarter', label: 'In 3 months' },
    ] as const;
    readonly todayIso = this.isoDate(new Date());
    readonly pledgeDonorName = computed(() => this.hasPermission('don.contact.view') ? this.donor().fullName : this.maskedFullName());
    readonly intentCurrencyOptions = computed(() => {
      const code = this.intentCurrency().trim().toUpperCase();
      const known = this.intentCurrencies();
      return code && !known.includes(code) ? [code, ...known] : known;
    });
    readonly intentSymbol = computed(() => {
      const code = this.intentCurrency().trim().toUpperCase();
      try {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
          .formatToParts(0).find(p => p.type === 'currency')?.value ?? code;
      } catch {
        return code;
      }
    });
    readonly intentFormatted = computed(() => {
      const amount = this.intentAmount();
      return amount && amount > 0 ? this.formatIntentAmount(amount) : '';
    });
    readonly intentInWords = computed(() => {
      const amount = this.intentAmount();
      if (!amount || !(amount > 0) || amount >= 1e12) return '';
      const code = this.intentCurrency().trim().toUpperCase();

      // The currency's name from the master ("INR - Indian Rupee"), so every currency it offers
      // reads back in words - not only the six this file used to name.
      const label = this.currencyCatalogue().find((currency) => currency.value === code)?.label ?? code;
      const name = label.includes(' - ') ? label.slice(label.indexOf(' - ') + 3) : label;
      const whole = Math.floor(amount);
      const cents = Math.round((amount - whole) * 100);
      const words = this.numberInWords(whole, code === 'INR');
      return `${name} ${words}${cents ? ` and ${cents}/100` : ''} only`;
    });
    readonly intentDueLabel = computed(() => {
      const [y, m, d] = this.intentDueDate().split('-').map(Number);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return y && m && d ? `${d} ${months[m - 1]} ${y}` : '';
    });

    /** The big figure shows grouped digits (1,25,000) at rest and the plain number while typing. */
    readonly intentAmountFocused = signal(false);
    private readonly intentAmountRaw = signal('');
    readonly intentAmountText = computed(() => {
      const amount = this.intentAmount();
      if (amount === null || isNaN(amount)) return '';
      if (this.intentAmountFocused()) return this.intentAmountRaw();
      const locale = this.intentCurrency().trim().toUpperCase() === 'INR' ? 'en-IN' : 'en-GB';
      return amount.toLocaleString(locale, { maximumFractionDigits: 2 });
    });

    focusIntentAmount() {
      const amount = this.intentAmount();
      this.intentAmountRaw.set(amount === null || isNaN(amount) ? '' : String(amount));
      this.intentAmountFocused.set(true);
    }

    setIntentAmountText(input: HTMLInputElement) {
      const clean = input.value.replace(/[^0-9.]/g, '');
      if (input.value !== clean) input.value = clean;
      this.intentAmountRaw.set(clean);
      this.intentAmount.set(clean === '' || isNaN(Number(clean)) ? null : Number(clean));
    }
    readonly intentDueDistance = computed(() => {
      const due = this.intentDueDate();
      if (!due) return '';
      const days = Math.round((Date.parse(due + 'T00:00:00') - Date.parse(this.todayIso + 'T00:00:00')) / 86400000);
      if (isNaN(days)) return '';
      if (days === 0) return 'today';
      if (days === 1) return 'tomorrow';
      return days > 0 ? `in ${days} days` : `${-days} days ago`;
    });

    formatIntentAmount(amount: number): string {
      const code = this.intentCurrency().trim().toUpperCase();
      const locale = code === 'INR' ? 'en-IN' : 'en-GB';
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
      } catch {
        return `${code} ${amount.toLocaleString(locale)}`;
      }
    }

    dueFor(id: 'two-weeks' | 'month-end' | 'quarter'): string {
      const d = new Date();
      if (id === 'two-weeks') d.setDate(d.getDate() + 14);
      else if (id === 'month-end') d.setMonth(d.getMonth() + 1, 0);
      else d.setMonth(d.getMonth() + 3);
      return this.isoDate(d);
    }

    private isoDate(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /** Cheque-style words: lakh / crore for rupees, thousand / million / billion otherwise. */
    private numberInWords(n: number, indian: boolean): string {
      if (n === 0) return 'Zero';
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
        'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const below1000 = (x: number): string => {
        const parts: string[] = [];
        if (x >= 100) { parts.push(ones[Math.floor(x / 100)] + ' Hundred'); x %= 100; }
        if (x >= 20) { parts.push(tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : '')); }
        else if (x > 0) { parts.push(ones[x]); }
        return parts.join(' ');
      };
      const scales: [number, string][] = indian
        ? [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']]
        : [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
      const out: string[] = [];
      for (const [size, name] of scales) {
        if (n >= size) { out.push(this.numberInWords(Math.floor(n / size), indian) + ' ' + name); n %= size; }
      }
      if (n > 0) out.push(below1000(n));
      return out.join(' ');
    }

    /**
     * THE RECORD'S OWN STATE IS THE SERVER'S TO JUDGE, and it already has.
     *
     * `permittedActions` is built per record: Correct is withheld from an Archived or Merged
     * donor, and Delete unused draft is offered only for a Prospect that has never been
     * submitted. The client then added a second gate of its own on top - `effectiveState()`,
     * which is the PAGE's load state - and the two disagreed about what the word 'draft' meant.
     * `effectiveState()` is only ever set to loading, loaded, empty, no-access or
     * dependency-failure by the loader, so `=== 'draft'` was false on every record that has ever
     * existed and both Create intent and Delete draft were permanently greyed out. The page state
     * gate that remains is the one it should always have been: is there a loaded record to act on.
     */
    private readonly recordIsActionable = computed(
      () => ['loaded', 'duplicate'].includes(this.effectiveState()),
    );

    canCorrect = computed(() => this.hasPermission('don.donor-360.correct') && this.effectiveState() === 'loaded');
    canFollowUp = computed(() => this.hasPermission('don.donor-360.follow-up') && this.recordIsActionable());
    canCreateIntent = computed(() => this.hasPermission('don.donor-360.create-intent') && this.recordIsActionable());
    canDeleteDraft = computed(() => this.hasPermission('don.donor-360.delete-draft') && this.recordIsActionable());
  
    dialogTitleId = computed(() => {
      switch (this.activeAction()) {
        case 'create-intent': return 'intent-title';
        case 'delete-draft': return 'delete-title';
        default: return null;
      }
    });

    // ============================================================
    // PRESENTATION-ONLY DERIVED DATA (added — no existing signal,
    // computed or method above was changed or removed)
    // ============================================================

    /** KPI: total received-to-date, drives the "Lifetime giving" card. */
    lifetimeGiving = computed(() => this.donationTotals().find(d => d.stage === 'Received')?.amount ?? 0);

    /** KPI: number of campaigns this donor has given to. */
    totalDonationsCount = computed(() => this.response()?.donationTotalsByStage.find(d => d.stage === 'Received')?.transactionCount ?? 0);

    /** KPI: promises fulfilled to date. */
    fulfilledPromisesCount = computed(() => this.promises().filter(p => p.status === 'Fulfilled').length);

    /** KPI: follow-ups currently overdue — surfaced as the "attention" card. */
    overdueFollowUpsCount = computed(() => this.followUps().filter((f) => f.isOverdue).length);

    /**
     * The currency this donor's money is recorded in, from the payments module's totals.
     * Every amount on the page used to be printed with a rupee sign whatever it was.
     */
    readonly currency = computed(() => {
      const response = this.response();
      return response?.donationTotalsByStage.find((total) => !!total.currency)?.currency
        ?? response?.donations?.[0]?.currency
        ?? response?.promises?.[0]?.currency
        ?? 'INR';
    });

    /** Maps a status/label string from any list in this view to a badge tone. */
    badgeClass(value: string): 'green' | 'blue' | 'amber' | 'red' | 'gray' {
      const tones: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
        Active: 'green', Granted: 'green', Fulfilled: 'green', Reconciled: 'green', Completed: 'green', Settled: 'green',
        Scheduled: 'blue', Received: 'blue', Planned: 'blue', Assigned: 'blue', Rescheduled: 'blue', Recorded: 'blue', Normal: 'blue',
        Draft: 'gray', Closed: 'gray', Low: 'gray', Cancelled: 'gray', Voided: 'gray', 'Not provided': 'gray', Prospect: 'gray', Archived: 'gray', Merged: 'gray',
        Pending: 'amber', Partial: 'amber', Pledged: 'amber', Medium: 'amber', Open: 'amber', PartiallyFulfilled: 'amber', PartiallyRefunded: 'amber',
        Overdue: 'red', Withdrawn: 'red', Restricted: 'red', Inactive: 'red', High: 'red', Urgent: 'red', Lapsed: 'red', Refunded: 'red', ChargedBack: 'red',
      };
      return tones[value] ?? 'gray';
    }
  
    // ============================================================
    // MORE PRESENTATION-ONLY DERIVED DATA (added — no existing signal,
    // computed or method above was changed or removed)
    // ============================================================

    /** Collapsible "STATES" scenario switcher in the preview bar. */
    statesOpen = signal(false);
    toggleStates() {
      this.statesOpen.update((open) => !open);
    }

    /** Free-text filter applied to the active tab's table/list. */
    searchTerm = signal('');
    setSearchTerm(value: string) {
      this.searchTerm.set(value);
      this.pages.set({});
    }
    matchesSearch(...fields: (string | number)[]): boolean {
      const q = this.searchTerm().trim().toLowerCase();
      if (!q) return true;
      return fields.some((f) => String(f).toLowerCase().includes(q));
    }

    /**
     * Pledged: what the donor has promised and not yet given - the open promises.
     *
     * THE "% IN" METER BESIDE IT IS GONE. It divided everything the donor had ever given by the
     * promises still outstanding - two figures with nothing to do with one another, so a donor
     * with 14,000 received and one open pledge of 5,000 read "280% in". How much of a pledge has
     * arrived is not recorded per promise; the count of promises still open is, and is shown.
     */
    pledgedAmount = computed(() => this.donationTotals().find((d) => d.stage === 'Pledged')?.amount ?? 0);

    // ============================================================
    // TAB PRESENTATION — derived only from the arrays above
    // ============================================================

    /**
     * The money on record, split into parts that do not overlap, for the proportion rule.
     *
     * THE RULE DREW THE SERVER'S FOUR STAGES SIDE BY SIDE AS THOUGH THEY ADDED UP. They do not:
     * Reconciled is inside Received. So the bar is drawn from what the stages imply - received
     * and confirmed by the bank, received and not yet confirmed, promised, and refunded - which
     * are four different pots and do sum to everything on record.
     */
    readonly stageMix = computed(() => {
      const amount = (stage: string) => this.donationTotals().find((total) => total.stage === stage)?.amount ?? 0;
      const received = amount('Received');
      const reconciled = Math.min(amount('Reconciled'), received);

      const parts = [
        { stage: 'Reconciled', amount: reconciled },
        { stage: 'Received, to reconcile', amount: received - reconciled },
        { stage: 'Pledged', amount: amount('Pledged') },
        { stage: 'Refunded', amount: amount('Refunded') },
      ].filter((part) => part.amount > 0);

      const total = parts.reduce((sum, part) => sum + part.amount, 0);
      return parts.map((part, index) => ({ ...part, tone: index % 5, share: total ? Math.round((part.amount / total) * 100) : 0 }));
    });

    /** The consent state channel by channel, rather than the joined string. */
    readonly channelConsents = computed(() =>
      (this.response()?.communicationPreferences ?? []).map((preference) => ({
        channel: this.channelName(preference.channel),
        state: preference.consentState,
        since: preference.effectiveAtUtc ? this.formatDate(preference.effectiveAtUtc) : '',
        recognition: preference.publicRecognitionPreference,
      })),
    );

    readonly language = computed(() => this.response()?.donor?.preferredLanguage ?? '');
    readonly consentNotice = computed(() => this.response()?.consentStatus?.noticeVersion ?? '');

    /**
     * A promise still to be kept: Open or PartiallyFulfilled.
     *
     * THE SCREEN ASKED FOR "Pending", A STATUS THE API DOES NOT HAVE - so "Promises pending" was
     * always 0 and the Overview never showed a promise falling due, whatever had been pledged.
     */
    private isOutstanding(promise: PromiseItem): boolean {
      return promise.status === 'Open' || promise.status === 'PartiallyFulfilled';
    }

    /** The outstanding promise that falls due first. */
    readonly nextPromise = computed(() =>
      this.promises()
        .filter((promise) => this.isOutstanding(promise))
        .sort((a, b) => (Date.parse(a.dueDate) || Infinity) - (Date.parse(b.dueDate) || Infinity))[0] ?? null,
    );

    readonly followUpTally = computed(() => {
      const list = this.followUps();
      return {
        open: list.filter((f) => f.isOpen && !f.isOverdue).length,
        overdue: list.filter((f) => f.isOverdue).length,
        done: list.filter((f) => f.status === 'Completed').length,
      };
    });

    /** "24 Sep 2026" → "24" and "Sep 2026", for the calendar leaves. */
    dayOf(date: string): string { return date ? date.split(' ')[0] : '—'; }
    monthOf(date: string): string { return date ? date.split(' ').slice(1).join(' ') : ''; }

    channelName(channel: string): string {
      const names: Record<string, string> = { PhoneCall: 'Phone call', Sms: 'SMS', WhatsApp: 'WhatsApp', Email: 'Email', Post: 'Post' };
      return names[channel] ?? channel;
    }

    readonly tabHeading = computed(() => {
      switch (this.activeTab()) {
        case 'donations': return 'Giving ledger';
        case 'communications': return 'Conversations';
        case 'follow-ups': return 'Follow-up agenda';
        case 'documents': return 'Files on record';
        case 'activity': return 'Activity chronicle';
        case 'consent': return 'Consent & preferences';
        case 'identity-verification': return 'Identity verification';
        default: return 'Overview';
      }
    });

    readonly tabMeta = computed(() => {
      switch (this.activeTab()) {
        case 'donations': return `${this.gifts().length} gifts · ${this.campaignHistory().length} campaigns · ${this.promises().length} promises`;
        case 'communications': return `${this.conversations().length} conversations, newest first`;
        case 'follow-ups': {
          const tally = this.followUpTally();
          return `${this.followUps().length} follow-ups · ${tally.open} open · ${tally.overdue} overdue · ${tally.done} completed`;
        }
        case 'documents': return `${this.documents().length} documents · ${this.duplicateLinks().length} possible duplicates`;
        case 'activity': return `${this.activity().length} recorded actions, newest first`;
        case 'consent': return this.donor().consentUpdated ? `Last recorded ${this.donor().consentUpdated}` : 'No consent recorded yet';
        case 'identity-verification': return 'Checks run against this donor’s identity documents';
        default: return '';
      }
    });

    /** First/last row numbers of the visible page, for "11–20 of 34". */
    pageFrom(key: string, rows: readonly object[]): number { return this.filtered(rows).length ? (this.pageNumber(key, rows) - 1) * this.pageSize + 1 : 0; }
    pageTo(key: string, rows: readonly object[]): number { return Math.min(this.pageNumber(key, rows) * this.pageSize, this.filtered(rows).length); }

    /** Promises pending, surfaced in the snapshot panel. */
    pendingPromisesCount = computed(() => this.promises().filter((p) => this.isOutstanding(p)).length);

    /**
     * Re-reads the donor from the server.
     *
     * IT USED TO BE `this.scenario.set(this.scenario())` - a signal set to the value it already
     * holds, which Angular treats as no change and which therefore recomputed nothing and fetched
     * nothing. The "Refresh" link sits beside the record's freshness timestamp, so the one thing
     * a person presses it for is the one thing it did not do.
     */
    refreshData() {
      this.load();
    }

    openAction(action: 'correct' | 'create-intent' | 'delete-draft') {
      this.successPanel.set(null);

      // Edit profile is a full screen of its own, not a pop-up.
      if (action === 'correct') {
        this.router.navigate(['/app/fundraising/relationships/donor-360/edit'], {
          queryParams: { donorId: this.donorId() },
        });
        return;
      }

      // A fresh note each time: the last pledge's figures must not reappear on the next one.
      if (action === 'create-intent') {
        this.intentAmount.set(null);

        // The currency this donor already gives in, when the master still offers it.
        const known = this.intentCurrencies();
        this.intentCurrency.set(known.includes(this.currency()) || known.length === 0 ? this.currency() : known[0]);
        this.intentDueDate.set('');
        this.intentNotes.set('');
      }

      this.deleteErrors.set({});
      this.intentErrors.set({});
      this.activeAction.set(action);
    }
  
    closeAction() {
      this.activeAction.set(null);
    }
  
    submitDeleteDraft() {
      const errors: Record<string, string> = {};
      if (!this.deleteReason().trim()) errors['reason'] = 'Enter Reason for deletion.';
      if (this.deleteConfirmText().trim().toUpperCase() !== 'DELETE') errors['confirm'] = 'Type DELETE to confirm.';
      this.deleteErrors.set(errors);
      if (Object.keys(errors).length) return;
  
      const donorId = this.donorId();
      if (!donorId) return;

      // IT DELETES THE DRAFT NOW. This used to be the success panel and nothing else: the record
      // stayed exactly where it was, and the person was told it had been permanently removed -
      // over a dialog whose own warning says the act cannot be undone. Of the two ways that can
      // be wrong, believing a record is gone when it is not is the worse one.
      const reference = this.donor().reference;

      this.api
        .deleteDonorDraft(donorId, { reason: this.deleteReason().trim() })
        .subscribe({
          next: () => {
            this.activeAction.set(null);
            this.deleteConfirmText.set('');
            this.successPanel.set({
              title: 'Draft deleted successfully.',
              reference,
              state: 'Deleted (draft)',
              effectiveTime: 'Just now',
              nextAction: 'Return to lead work queue',
            });

            // The record this screen is about no longer exists, so there is nothing here to
            // reload onto. The work queue is where the remaining drafts are.
            this.router.navigate(['/app/fundraising/relationships/lead-work-queue']);
          },
          error: (error: unknown) => {
            this.activeAction.set(null);
            this.toast.show('Draft not deleted', apiErrorMessage(error), 'error');
          },
        });
    }
  
    /**
     * Records the pledge.
     *
     * IT USED TO RECORD NOTHING. The whole body was a success panel with a reference built from
     * `Math.random()` - 'DON-2026-DRAFT-417' - so the screen reported a saved draft that existed
     * in no database, and the number it quoted back could never be looked up again. The endpoint
     * it should have been calling has been there all along.
     */
    submitCreateIntent() {
      const errors: Record<string, string> = {};
      const amount = this.intentAmount();

      if (amount === null || !(amount > 0)) errors['amount'] = 'Enter an amount greater than zero.';
      if (!this.intentCurrency().trim()) errors['currency'] = 'Enter Currency.';
      if (this.intentNotes().trim().length < 10) errors['notes'] = 'Enter at least 10 characters of notes.';

      this.intentErrors.set(errors);
      if (Object.keys(errors).length) return;

      const donorId = this.donorId();
      if (!donorId) return;

      this.api
        .createDonorIntent(donorId, {
          amount: amount!,
          currency: this.intentCurrency().trim(),
          dueAtUtc: this.intentDueDate() ? new Date(this.intentDueDate()).toISOString() : null,
          notes: this.intentNotes().trim(),
        })
        .subscribe({
          next: () => {
            this.activeAction.set(null);
            this.successPanel.set({
              title: 'Pledge recorded successfully.',
              reference: this.donor().reference,
              state: 'Pledged',
              effectiveTime: 'Just now',

              // SAID PLAINLY, because the button is called "Create intent" and the obvious
              // reading of that is that a payment has been started. It has not.
              nextAction: 'This is a pledge, not a payment request - the donor pays through their own donation link',
            });
            this.load();
          },
          error: (error: unknown) => {
            this.activeAction.set(null);
            this.toast.show('Pledge not recorded', apiErrorMessage(error), 'error');
          },
        });
    }
  
    /**
     * BOTH OF THESE SEND THE DONOR'S ID, and until now neither did.
     *
     * They passed `donor().reference` - the human code, DON-2026-000001 - as the `donorId` query
     * parameter. Both destinations read that parameter straight into a filter whose `DonorId` the
     * API declares as a Guid, so the code was refused by model binding and each screen opened on
     * the whole organisation's records rather than on this donor. Schedule follow-up, three lines
     * further down, already passed the id; these two were simply inconsistent with it.
     */
    openIdentityVerification() {
      this.router.navigate(['/app/don/donor-identity-verification'], { queryParams: { donorId: this.donorId(), leadId: this.leadId() } });
    }

    openConsentPreferences() {
      this.router.navigate(['/app/fundraising/relationships/consent-and-preference-centre'], { queryParams: { donorId: this.donorId(), leadId: this.leadId() } });
    }

    openFollowUpPlanner() {
      // THE DOCUMENT: "Schedule Follow-Up redirects to the Follow-Up Planner."
      this.router.navigate(['/app/don/follow-up-planner'], {
        queryParams: { donorId: this.donorId(), leadId: this.leadId(), mode: 'create' },
      });
    }

    executeFollowUp(followUpId: string) {
      const followUp = this.followUps().find((item) => item.id === followUpId);
      if (!followUp || !followUp.isOpen || !followUp.isMine) {
        return;
      }
      this.router.navigate(['/app/fundraising/relationships/follow-up-execution'], {
        queryParams: { followUpId, donorId: this.donorId(), leadId: this.leadId() },
      });
    }

    openCommunicationHistory() {
      this.router.navigate(['/app/fundraising/relationships/communication-timeline'], {
        queryParams: { leadId: this.leadId(), donorId: this.donorId() },
      });
    }

    dismissSuccess() {
      this.successPanel.set(null);
      this.dependencyNotice.set(false);
    }
  
    // ============================================================
    // Conflict handling
    // ============================================================
    /**
     * Loads the version that caused the conflict.
     *
     * IT USED TO JUST DISMISS THE BANNER. Setting the state to 'loaded' left the same stale record
     * on screen with the warning about it removed - so a button reading "Review latest version"
     * showed the older one and stopped saying so, which is worse than not offering the button.
     */
    reviewConflict() {
      this.load();
    }
  
    // ============================================================
    // Formatting helpers (kept local — imports array left untouched)
    // ============================================================
  
    /** An amount in the donor's own currency (see `currency`), or in the one named. */
    money(amount: number, currency?: string): string {
      const code = (currency || this.currency()).toUpperCase();
      const locale = code === 'INR' ? 'en-IN' : 'en-GB';
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount || 0);
      } catch {
        return `${code} ${(amount || 0).toLocaleString(locale)}`;
      }
    }

    /** Whether the caller may take a copy of this donor's history. */
    readonly canExportHistory = computed(() => (this.response()?.permittedActions ?? []).includes('Export history'));

    /** Export History - gifts, conversations, follow-ups and ownership, written by the server. */
    exportHistory(): void {
      const donorId = this.donorId();
      if (!donorId) return;

      this.api.exportDonorHistory(donorId).subscribe({
        next: ({ blob, fileName }) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (error: unknown) => this.toast.show('History not exported', apiErrorMessage(error), 'error'),
      });
    }
  
    /**
     * A masked e-mail, derived from the donor's own address.
     *
     * IT USED TO BE THE CONSTANT '•••••••@•••••.com', which claims the address ends in .com
     * whatever it ends in. The domain suffix is the part a person uses to recognise their own
     * record, so inventing it is the one part of a mask that must not be invented.
     */
    maskedEmail(): string {
      const value = this.donor().email.trim();
      if (!value) return '—';

      const at = value.lastIndexOf('@');
      if (at < 1) return '•'.repeat(Math.min(value.length, 8));

      const domain = value.slice(at + 1);
      const dot = domain.lastIndexOf('.');

      return dot > 0
        ? `${value[0]}•••••@•••••${domain.slice(dot)}`
        : `${value[0]}•••••@•••••`;
    }

    /**
     * A masked phone number, keeping only the last two digits of the real one.
     *
     * IT USED TO BE THE CONSTANT '+91 ••••• •••33'. Every donor's number appeared to end in 33,
     * and a masked value that shows digits nobody has is worse than one that shows none: the
     * digits are exactly what somebody reads to confirm they are looking at the right person.
     */
    maskedPhone(): string {
      const digits = this.donor().phone.replace(/\D/g, '');
      if (!digits) return '—';
      if (digits.length <= 2) return '•'.repeat(digits.length);

      return `••••• •••${digits.slice(-2)}`;
    }
  
    /** Identity and contact summary is masked unless the separate field
     *  permission (don.contact.view) is present — spec §4.3.2. */
    maskedFullName(): string {
      const parts = this.donor().fullName.trim().split(/\s+/);
      if (parts.length === 0) return '••••••';
      if (parts.length === 1) return parts[0].charAt(0) + '•••••';
      return parts[0].charAt(0) + '••••• ' + parts[parts.length - 1].charAt(0) + '•••••';
    }
  
    consentIcon(): string {
      switch (this.donor().consentStatus) {
        case 'Granted': return '✓';
        case 'Partial': return '!';
        default: return '✕';
      }
    }

    /** Best-effort clipboard copy for reference values shown in the side panel. */
    async copyValue(text: string): Promise<void> {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API unavailable/denied — silently ignored, non-critical affordance.
      }
    }
  }
  
  type Scenario =
    | 'loaded'
    | 'loading'
    | 'empty'
    | 'draft'
    | 'duplicate'
    | 'conflict'
    | 'dependency-failure'
    | 'no-access';
  
  type FollowUpView = 'all' | 'open' | 'overdue' | 'closed';

  type TabId ='overview' | 'donations' | 'communications' | 'follow-ups' | 'documents' | 'activity' | 'consent' | 'identity-verification';
  
  interface SuccessPanel {
    title: string;
    reference: string;
    state: string;
    effectiveTime: string;
    nextAction: string;
  }
  
  interface DonationStage { stage: string; amount: number; asOf: string; }
  interface CampaignHistoryItem { id: string; name: string; role: string; amount: number; gifts: number; lastGift: string; date: string; status: string; }
  interface GiftItem { id: string; reference: string; date: string; campaign: string; amount: number; refunded: number; currency: string; status: string; }
  interface ConversationItem { id: string; channel: string; summary: string; date: string; owner: string; }
  interface FollowUpItem { id: string; title: string; due: string; owner: string; status: string; priority: string; isOpen: boolean; isOverdue: boolean; isMine: boolean; }
  interface PromiseItem { id: string; amount: number; currency: string; dueDate: string; status: string; }
  interface DocumentItem { id: string; name: string; type: string; uploadedOn: string; classification: string; }
  interface DuplicateLink { id: string; reference: string; matchReason: string; similarity: string; }
  interface ActivityItem { id: string; actor: string; action: string; timestamp: string; }
