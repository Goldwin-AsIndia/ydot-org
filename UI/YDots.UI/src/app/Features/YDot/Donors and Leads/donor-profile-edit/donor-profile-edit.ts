import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { DonLookupItem, Donor360Response, DonorType } from '../../../../Shared/models/donor-contract.model';
import { PeopleDirectoryService } from '../../../../Shared/services/people-directory.service';
import { ToastService } from '../../../../Shared/services/toast.service';

type EditState = 'loading' | 'ready' | 'no-access' | 'error' | 'empty';

/**
 * Donor 360 -> Edit profile.
 *
 * A full screen rather than the two-field pop-up it replaces. It edits what the donor correction
 * endpoint accepts - identity, contact, language, do-not-contact and relationship owner - and a
 * save is an AUDITED correction, so a reason (10-2000 characters) is required.
 *
 * MASKED CONTACT IS NEVER SENT BACK. When the server masked the e-mail or phone for this caller
 * the field is shown read-only; posting the masked text would overwrite the real value with it.
 */
@Component({
  selector: 'app-donor-profile-edit',
  imports: [CommonModule, FormsModule],
  templateUrl: './donor-profile-edit.html',
  styleUrl: './donor-profile-edit.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DonorProfileEditComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DonorApiService);
  private readonly toast = inject(ToastService);
  protected readonly people = inject(PeopleDirectoryService);

  protected readonly reasonMin = 10;
  protected readonly reasonMax = 2000;

  protected readonly donorId = signal(this.route.snapshot.queryParamMap.get('donorId'));
  protected readonly state = signal<EditState>('loading');
  protected readonly response = signal<Donor360Response | null>(null);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);

  // ---- form ----
  protected readonly donorTypes: readonly DonorType[] = ['Individual', 'Organisation', 'Trust', 'Corporate'];
  protected readonly donorType = signal<DonorType>('Individual');
  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly organisationName = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly language = signal('');
  protected readonly doNotContact = signal(false);
  protected readonly owner = signal('');
  protected readonly ownerSearch = signal('');
  protected readonly reason = signal('');
  protected readonly languageOptions = signal<readonly DonLookupItem[]>([]);

  protected readonly donor = computed(() => this.response()?.donor ?? null);
  protected readonly isPerson = computed(() => this.donorType() === 'Individual');
  protected readonly emailMasked = computed(() => !!this.donor()?.isEmailMasked);
  protected readonly phoneMasked = computed(() => !!this.donor()?.isPhoneMasked);
  protected readonly ownerOptions = computed(() => this.people.assignable());
  protected readonly filteredOwners = computed(() => {
    const q = this.ownerSearch().trim().toLowerCase();
    return this.ownerOptions().filter(
      (p) => p.reference === this.owner() || !q || `${p.name} ${p.context ?? ''}`.toLowerCase().includes(q),
    );
  });
  protected readonly ownerKnown = computed(() => this.ownerOptions().some((p) => p.reference === this.owner()));

  protected readonly reasonCount = computed(() => this.reason().trim().length);
  protected readonly errors = computed(() => {
    const e: Record<string, string> = {};
    if (this.isPerson()) {
      if (!this.firstName().trim()) e['firstName'] = 'Enter First name.';
      else if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(this.firstName().trim())) e['firstName'] = 'First name can contain letters only.';
      if (this.lastName().trim() && !/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(this.lastName().trim())) e['lastName'] = 'Last name can contain letters only.';
    } else if (!this.organisationName().trim()) {
      e['organisationName'] = 'Enter Organisation name.';
    }
    const email = this.email().trim();
    if (!this.emailMasked() && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e['email'] = 'Enter a valid email address.';
    }
    const phone = this.phone().trim();
    if (!this.phoneMasked() && phone && phone.replace(/\D/g, '').length < 7) {
      e['phone'] = 'Enter a valid phone number.';
    }
    if (this.reasonCount() < this.reasonMin || this.reasonCount() > this.reasonMax) {
      e['reason'] = `Enter a reason between ${this.reasonMin} and ${this.reasonMax} characters.`;
    }
    return e;
  });

  /** Fields whose value differs from the loaded record - what the audit entry will cover. */
  protected readonly changedLabels = computed(() => {
    const d = this.donor();
    if (!d) return [] as string[];
    const out: string[] = [];
    if (this.donorType() !== d.donorType) out.push('Donor type');
    if (this.firstName().trim() !== (d.firstName ?? '') || this.lastName().trim() !== (d.lastName ?? '')) out.push('Name');
    if (this.organisationName().trim() !== (d.organisationName ?? '')) out.push('Organisation');
    if (!this.emailMasked() && this.email().trim() !== (d.primaryEmail ?? '')) out.push('Email');
    if (!this.phoneMasked() && this.phone().trim() !== (d.primaryPhone ?? '')) out.push('Phone');
    if (this.language() !== (d.preferredLanguage ?? '')) out.push('Language');
    if (this.doNotContact() !== d.doNotContact) out.push('Do not contact');
    if (this.owner() !== (d.relationshipOwnerUserId ?? '')) out.push('Relationship owner');
    return out;
  });
  protected readonly dirty = computed(() => this.changedLabels().length > 0);

  constructor() {
    this.load();
    this.api.getLeadCaptureForm().subscribe({
      next: (r) => this.languageOptions.set(r.languageOptions ?? []),
      error: () => undefined, // the current language stays selectable from the record itself
    });
  }

  private load(): void {
    const id = this.donorId();
    if (!id) {
      this.state.set('empty');
      return;
    }
    this.state.set('loading');
    this.api.getDonor360(id).subscribe({
      next: (r) => {
        if (!(r.permittedActions ?? []).includes('Correct')) {
          this.state.set('no-access');
          return;
        }
        this.response.set(r);
        const d = r.donor;
        this.donorType.set(d.donorType);
        this.firstName.set(d.firstName ?? '');
        this.lastName.set(d.lastName ?? '');
        this.organisationName.set(d.organisationName ?? '');
        this.email.set(d.isEmailMasked ? '' : d.primaryEmail ?? '');
        this.phone.set(d.isPhoneMasked ? '' : d.primaryPhone ?? '');
        this.language.set(d.preferredLanguage ?? '');
        this.doNotContact.set(d.doNotContact);
        this.owner.set(d.relationshipOwnerUserId ?? '');
        this.state.set('ready');
      },
      error: (error: unknown) => {
        const status = (error as { status?: number })?.status;
        this.state.set(status === 403 ? 'no-access' : 'error');
        if (status !== 403) this.toast.show('Donor unavailable', apiErrorMessage(error), 'error');
      },
    });
  }

  protected save(): void {
    this.submitted.set(true);
    const id = this.donorId();
    const current = this.response();
    if (!id || !current || this.saving() || Object.keys(this.errors()).length) return;

    const person = this.isPerson();
    this.saving.set(true);
    this.api
      .correctDonor(id, {
        donorType: this.donorType(),
        firstName: person ? this.firstName().trim() : null,
        lastName: person ? this.lastName().trim() || null : null,
        organisationName: person ? null : this.organisationName().trim(),
        // Masked values are left out so the server keeps the real ones.
        ...(this.emailMasked() ? {} : { primaryEmail: this.email().trim() || null }),
        ...(this.phoneMasked() ? {} : { primaryPhone: this.phone().trim() || null }),
        preferredLanguage: this.language() || null,
        doNotContact: this.doNotContact(),
        // NULL, NOT '' - "no owner" is a real choice and an empty string is not a Guid.
        relationshipOwnerUserId: this.owner() || null,
        relationshipOwnerName: this.ownerOptions().find((p) => p.reference === this.owner())?.name ?? null,
        correctionReason: this.reason().trim(),
        expectedVersion: current.donor.version,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.show('Profile updated', 'The correction was saved and recorded in the audit trail.', 'success');
          this.back();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.show('Profile not saved', apiErrorMessage(error), 'error');
        },
      });
  }

  protected cancel(): void {
    this.back();
  }

  /** Back to Donor 360 for this donor. */
  private back(): void {
    this.router.navigate(['/app/fundraising/relationships/donor-360'], {
      queryParams: { donorId: this.donorId() },
    });
  }
}
