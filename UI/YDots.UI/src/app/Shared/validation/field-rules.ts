/**
 * Field rules shared by every form.
 *
 * Each rule returns the message to show under the field, or null when the value is fine, so a
 * screen can both highlight the field (message !== null) and say what is wrong with it. They are
 * plain functions on purpose: the screens hold their forms in signals or plain objects as often as
 * in Angular form groups.
 */

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DIGITS_RE = /^\d+$/;
const USERNAME_RE = /^[A-Za-z0-9]+$/;

const blank = (value: unknown): boolean => value === null || value === undefined || String(value).trim() === '';

/** Anything required: the field has to be filled in. */
export function requiredError(label: string, value: unknown): string | null {
  return blank(value) ? `${label} is required.` : null;
}

/** A person's name: letters, spaces and . ' - only. Empty is fine unless `required`. */
export function nameError(label: string, value: unknown, required = true, max?: number): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!NAME_RE.test(text)) return `${label} can contain letters, spaces, dot, hyphen and apostrophe only.`;
  if (text.length < 2 && required) return `${label} must be at least 2 characters.`;
  if (max !== undefined && text.length > max) return `Maximum ${max} characters.`;
  return null;
}

/** A mobile / phone number, digits only (the country code is a separate field). */
export function mobileError(label: string, value: unknown, required = false): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!DIGITS_RE.test(text)) return `${label} can contain digits only.`;
  if (text.length < 7 || text.length > 15) return `${label} must be 7 to 15 digits.`;
  return null;
}

export function emailError(label: string, value: unknown, required = true): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  return EMAIL_RE.test(String(value).trim()) ? null : `Enter a valid ${label.toLowerCase()} (name@example.com).`;
}

export function usernameError(label: string, value: unknown, required = true): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!USERNAME_RE.test(text)) return `${label} can contain only letters and numbers.`;
  if (text.length < 3) return `${label} must be at least 3 characters.`;
  return text.length > 64 ? 'Maximum 64 characters.' : null;
}

/** A whole number or a decimal, optionally bounded. */
export function numberError(
  label: string,
  value: unknown,
  options: { required?: boolean; min?: number; max?: number; integer?: boolean } = {},
): string | null {
  const { required = true, min, max, integer = false } = options;
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).replace(/,/g, '').trim();
  if (!(integer ? /^\d+$/ : /^\d+(\.\d+)?$/).test(text)) {
    return integer ? `${label} must be a whole number.` : `${label} must be a number.`;
  }
  const n = Number(text);
  if (min !== undefined && n < min) return `${label} must be ${min === 0 ? 'zero or more' : `at least ${min}`}.`;
  if (max !== undefined && n > max) return `${label} must be ${max} or less.`;
  return null;
}

/** Minimum length for free text (justification, reason...). */
export function minLengthError(label: string, value: unknown, min: number, required = true): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  return String(value).trim().length < min ? `${label} must be at least ${min} characters.` : null;
}

// ---- Rules for the validation pass (limits mirror the IAM API validators / column sizes) ----

const LETTER_RE = /\p{L}/u;
const CODE_UPPER_RE = /^[A-Z0-9_]+$/;
const CODE_UPPER_HYPHEN_RE = /^[A-Z0-9_-]+$/;
const LETTERS_SPACES_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const EMPLOYEE_RE = /^[A-Za-z0-9-]+$/;
const DIAL_RE = /^\+\d{1,4}$/;
const IDENTIFIER_RE = /^[A-Za-z0-9_-]+$/;

/** Maximum length, with the limit in the message. */
export function maxLengthError(value: unknown, max: number): string | null {
  return !blank(value) && String(value).trim().length > max ? `Maximum ${max} characters.` : null;
}

/** Free text that has to read as words: at least one letter, optional min / maximum. */
export function textWithLettersError(
  label: string,
  value: unknown,
  options: { required?: boolean; max?: number; min?: number } = {},
): string | null {
  const { required = true, max, min } = options;
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!LETTER_RE.test(text)) return `${label} must contain letters (not only numbers or symbols).`;
  if (min !== undefined && text.length < min) return `${label} must be at least ${min} characters.`;
  if (max !== undefined && text.length > max) return `Maximum ${max} characters.`;
  return null;
}

/** Menu / label names: letters and single spaces only. */
export function lettersAndSpacesError(label: string, value: unknown, options: { required?: boolean; max?: number } = {}): string | null {
  const { required = true, max } = options;
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!LETTERS_SPACES_RE.test(text)) return `${label} can contain letters and spaces only.`;
  if (max !== undefined && text.length > max) return `Maximum ${max} characters.`;
  return null;
}

/** Codes: capital letters, digits and underscore (hyphen too when `allowHyphen`); no spaces. */
export function codeError(
  label: string,
  value: unknown,
  options: { required?: boolean; allowHyphen?: boolean; max?: number } = {},
): string | null {
  const { required = true, allowHyphen = false, max = 50 } = options;
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  const message = allowHyphen
    ? 'Use capital letters, digits, underscore and hyphen only.'
    : 'Use capital letters, digits and underscore only.';
  if (!(allowHyphen ? CODE_UPPER_HYPHEN_RE : CODE_UPPER_RE).test(text)) return message;
  return text.length > max ? `Maximum ${max} characters.` : null;
}

/** Employee / volunteer number: letters, digits and hyphen. Backend limit 40. */
export function employeeNumberError(label: string, value: unknown, required = false): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!EMPLOYEE_RE.test(text)) return `${label} can contain letters, digits and hyphen only.`;
  return text.length > 40 ? 'Maximum 40 characters.' : null;
}

/** Country code: "+" then 1-4 digits. */
export function dialCodeError(label: string, value: unknown, required = false): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  return DIAL_RE.test(String(value).trim()) ? null : `${label} must be "+" followed by 1 to 4 digits (for example +91).`;
}

/**
 * A phone number with its country code. Digits only; exactly 10 digits for +91, otherwise 6 to 15.
 * A number with no country code is rejected, so it is never silently dropped.
 */
export function phoneWithCodeError(label: string, code: unknown, number: unknown, options: { required?: boolean } = {}): string | null {
  const { required = false } = options;
  if (blank(number)) return required ? `${label} is required.` : null;
  const digits = String(number).trim();
  if (!DIGITS_RE.test(digits)) return `${label} can contain digits only.`;
  if (blank(code)) return 'Enter the country code (for example +91).';
  const dial = dialCodeError('Country code', code);
  if (dial) return dial;
  if (String(code).trim() === '+91') return digits.length === 10 ? null : `${label} must be exactly 10 digits for +91.`;
  return digits.length >= 6 && digits.length <= 15 ? null : `${label} must be 6 to 15 digits.`;
}

/** A phone number typed in one box, optionally with a leading +country code. */
export function phoneError(label: string, value: unknown, required = false): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!/^\+?[\d\s()-]+$/.test(text)) return `${label} can contain digits only (and an optional leading +).`;
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+91')) {
    if (digits.length !== 12) return `${label} must have 10 digits after +91.`;
  } else if (digits.length < 7 || digits.length > 15) {
    return `${label} must be 7 to 15 digits.`;
  }
  return text.length > 30 ? 'Maximum 30 characters.' : null;
}

/** Postal / PIN code: exactly 6 digits for India, otherwise 3 to 20 letters, digits, spaces or hyphens. */
export function postalCodeError(label: string, value: unknown, country: unknown, required = false): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (/^(india|in|ind)$/i.test(String(country ?? '').trim())) {
    return /^\d{6}$/.test(text) ? null : `${label} must be exactly 6 digits for India.`;
  }
  return /^[A-Za-z0-9][A-Za-z0-9 -]{1,18}[A-Za-z0-9]$/.test(text)
    ? null
    : `${label} can contain letters, digits, space and hyphen only (3 to 20 characters).`;
}

/** An absolute https:// URL. */
export function httpsUrlError(label: string, value: unknown, options: { required?: boolean; max?: number } = {}): string | null {
  const { required = false, max = 500 } = options;
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!/^https:\/\//i.test(text)) return `${label} must start with https://`;
  try {
    const host = new URL(text).hostname;
    if (/\s/.test(text) || !host || (!host.includes('.') && host !== 'localhost')) {
      return `Enter a valid ${label.toLowerCase()} (https://example.com/path).`;
    }
  } catch {
    return `Enter a valid ${label.toLowerCase()} (https://example.com/path).`;
  }
  return text.length > max ? `Maximum ${max} characters.` : null;
}

/** An absolute http:// or https:// URL - for a sandbox, where a developer's own machine is the host. */
export function webUrlError(label: string, value: unknown, options: { required?: boolean; max?: number } = {}): string | null {
  const { required = false, max = 500 } = options;
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!/^https?:\/\//i.test(text)) return `${label} must start with http:// or https://`;
  try {
    const host = new URL(text).hostname;
    if (/\s/.test(text) || !host || (!host.includes('.') && host !== 'localhost')) {
      return `Enter a valid ${label.toLowerCase()} (https://example.com/path).`;
    }
  } catch {
    return `Enter a valid ${label.toLowerCase()} (https://example.com/path).`;
  }
  return text.length > max ? `Maximum ${max} characters.` : null;
}

/** An in-app route: starts with /app/, no spaces. Backend limit 300. */
export function appRouteError(label: string, value: unknown, required = false): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!/^\/app\/[A-Za-z0-9_\-./:]+$/.test(text)) return `${label} must start with /app/ and contain no spaces (for example /app/reports).`;
  return text.length > 300 ? 'Maximum 300 characters.' : null;
}

/** Merchant / account identifiers: letters, digits, underscore and hyphen. */
export function identifierError(label: string, value: unknown, options: { required?: boolean; max?: number } = {}): string | null {
  const { required = false, max = 150 } = options;
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!IDENTIFIER_RE.test(text)) return `${label} can contain letters, digits, underscore and hyphen only.`;
  return text.length > max ? `Maximum ${max} characters.` : null;
}

/** A whole number inside an inclusive range, with the range in the message. */
export function rangeError(label: string, value: unknown, min: number, max: number, required = true): string | null {
  if (blank(value)) return required ? `${label} is required.` : null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return `${label} must be a whole number (allowed range ${min}–${max}).`;
  const n = Number(text);
  return n < min || n > max ? `${label}: allowed range ${min}–${max}.` : null;
}

/** Keeps the first non-null message of a list: `firstError(a, b, c)`. */
export function firstError(...messages: (string | null)[]): string | null {
  return messages.find((m) => m !== null) ?? null;
}
