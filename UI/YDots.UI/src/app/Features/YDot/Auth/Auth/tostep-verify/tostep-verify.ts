import { Component, ElementRef, ViewChild, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ToastService } from '../../../../../Shared/services/toast.service';

@Component({
  selector: 'app-tostep-verify',
  imports: [FormsModule, CommonModule, RouterModule],
  templateUrl: './tostep-verify.html',
  styleUrl: './tostep-verify.css',
})
export class TostepVerifyComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  otpDigits: string[] = ['', '', '', '', '', ''];
  isSubmitting: boolean = false;
  isResending: boolean = false;
  codeExpirySeconds: number = 120;
  codeExpiryTimer: any;
  errorMessage: string = '';
  successMessage: string = '';
  private readonly expectedOtpCode = '123456';

  /** ENTER FLOW ref — last OTP box-la Enter thattuna Verify button-ku focus poyi auto submit aagum. */
  @ViewChild('verifyBtn') private readonly verifyBtn?: ElementRef<HTMLButtonElement>;

  /**
   * ENTER FLOW — OTP box-la Enter:
   *   middle box + Enter → ngModelChange already next box-ku focus kudukum, inga onnum vena
   *   last box (5) + Enter → Verify button-ku focus poyi auto verify aagum
   */
  onOtpEnter(index: number, event: Event): void {
    event.preventDefault();

    if (index < 5) {
      document.querySelector<HTMLInputElement>(`#tostep-otp-${index + 1}`)?.focus();
      return;
    }

    this.verifyBtn?.nativeElement.focus();
    this.verifyOtp();
  }

  ngOnInit(): void {
    this.startCodeExpiryTimer();
  }

  ngOnDestroy(): void {
    if (this.codeExpiryTimer) clearInterval(this.codeExpiryTimer);
  }

  get otpCode(): string {
    return this.otpDigits.join('');
  }

  get canVerify(): boolean {
    return this.otpDigits.every((d) => d !== '');
  }

  get formattedCodeExpiry(): string {
    const m = Math.floor(this.codeExpirySeconds / 60);
    const s = this.codeExpirySeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  startCodeExpiryTimer(): void {
    if (this.codeExpiryTimer) clearInterval(this.codeExpiryTimer);
    this.codeExpirySeconds = 120;
    this.codeExpiryTimer = setInterval(() => {
      if (this.codeExpirySeconds > 0) this.codeExpirySeconds--;
      else clearInterval(this.codeExpiryTimer);
    }, 1000);
  }

  onOtpInput(index: number, value: string): void {
    if (!/^\d*$/.test(value)) {
      this.otpDigits[index] = '';
      return;
    }
    this.otpDigits[index] = value.slice(-1);
    if (value && index < 5) {
      document.querySelector<HTMLInputElement>(`#tostep-otp-${index + 1}`)?.focus();
    }
  }

  onOtpKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.otpDigits[index] && index > 0) {
      document.querySelector<HTMLInputElement>(`#tostep-otp-${index - 1}`)?.focus();
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      document.querySelector<HTMLInputElement>(`#tostep-otp-${index - 1}`)?.focus();
    }
    if (event.key === 'ArrowRight' && index < 5) {
      document.querySelector<HTMLInputElement>(`#tostep-otp-${index + 1}`)?.focus();
    }
  }

  onOtpPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!/^\d{6}$/.test(pasted)) return;
    event.preventDefault();
    this.otpDigits = pasted.split('');
    document.querySelector<HTMLInputElement>('#tostep-otp-5')?.focus();
  }

  verifyOtp(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.canVerify) {
      this.errorMessage = 'Please enter the full 6-digit verification code.';
      this.toast.show('Validation Error', 'Please enter the full 6-digit verification code.', 'warning');
      return;
    }

    this.isSubmitting = true;
    setTimeout(() => {
      this.isSubmitting = false;
      if (this.otpCode === this.expectedOtpCode) {
        this.successMessage = 'Verification successful. Redirecting...';
        this.toast.show('Verified', 'Two-factor authentication successful.', 'success');
        setTimeout(() => {
          this.router.navigate(['/app/dashboard']);
        }, 1000);
      } else {
        this.errorMessage = 'Invalid verification code. Please try again.';
        this.toast.show('Verification Failed', 'Invalid verification code. Please try again.', 'error');
      }
    }, 1500);
  }

  resendCode(): void {
    this.isResending = true;
    this.errorMessage = '';
    this.successMessage = '';
    setTimeout(() => {
      this.isResending = false;
      this.startCodeExpiryTimer();
      this.successMessage = 'A new verification code has been sent to your mobile number.';
    }, 1500);
  }
}