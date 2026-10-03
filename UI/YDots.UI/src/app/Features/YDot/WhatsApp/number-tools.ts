/**
 * Phone-number extraction for the CheckNumber upload.
 *
 * A cell or line may hold a name, an id and a number together ("Ravi 98765 43210", "ID-44, 9876543210"),
 * so the letters are ignored and only the digit runs are kept. Every number comes out in E.164 style,
 * starting with "+": Indian mobiles are always "+91" followed by ten digits starting 6-9, anything with an
 * explicit country code keeps it.
 */

export interface DialCountry {
  readonly code: string;
  readonly iso: string;
  readonly name: string;
}

/** The dial codes we can name. Longest prefix wins; anything else shows as "International". */
const DIAL_CODES: readonly DialCountry[] = [
  { code: '1', iso: 'US', name: 'United States / Canada' },
  { code: '7', iso: 'RU', name: 'Russia / Kazakhstan' },
  { code: '20', iso: 'EG', name: 'Egypt' },
  { code: '27', iso: 'ZA', name: 'South Africa' },
  { code: '30', iso: 'GR', name: 'Greece' },
  { code: '31', iso: 'NL', name: 'Netherlands' },
  { code: '32', iso: 'BE', name: 'Belgium' },
  { code: '33', iso: 'FR', name: 'France' },
  { code: '34', iso: 'ES', name: 'Spain' },
  { code: '39', iso: 'IT', name: 'Italy' },
  { code: '41', iso: 'CH', name: 'Switzerland' },
  { code: '44', iso: 'GB', name: 'United Kingdom' },
  { code: '46', iso: 'SE', name: 'Sweden' },
  { code: '47', iso: 'NO', name: 'Norway' },
  { code: '49', iso: 'DE', name: 'Germany' },
  { code: '52', iso: 'MX', name: 'Mexico' },
  { code: '55', iso: 'BR', name: 'Brazil' },
  { code: '60', iso: 'MY', name: 'Malaysia' },
  { code: '61', iso: 'AU', name: 'Australia' },
  { code: '62', iso: 'ID', name: 'Indonesia' },
  { code: '63', iso: 'PH', name: 'Philippines' },
  { code: '64', iso: 'NZ', name: 'New Zealand' },
  { code: '65', iso: 'SG', name: 'Singapore' },
  { code: '66', iso: 'TH', name: 'Thailand' },
  { code: '81', iso: 'JP', name: 'Japan' },
  { code: '82', iso: 'KR', name: 'South Korea' },
  { code: '84', iso: 'VN', name: 'Vietnam' },
  { code: '86', iso: 'CN', name: 'China' },
  { code: '90', iso: 'TR', name: 'Türkiye' },
  { code: '91', iso: 'IN', name: 'India' },
  { code: '92', iso: 'PK', name: 'Pakistan' },
  { code: '93', iso: 'AF', name: 'Afghanistan' },
  { code: '94', iso: 'LK', name: 'Sri Lanka' },
  { code: '95', iso: 'MM', name: 'Myanmar' },
  { code: '98', iso: 'IR', name: 'Iran' },
  { code: '212', iso: 'MA', name: 'Morocco' },
  { code: '234', iso: 'NG', name: 'Nigeria' },
  { code: '254', iso: 'KE', name: 'Kenya' },
  { code: '255', iso: 'TZ', name: 'Tanzania' },
  { code: '256', iso: 'UG', name: 'Uganda' },
  { code: '351', iso: 'PT', name: 'Portugal' },
  { code: '353', iso: 'IE', name: 'Ireland' },
  { code: '880', iso: 'BD', name: 'Bangladesh' },
  { code: '960', iso: 'MV', name: 'Maldives' },
  { code: '966', iso: 'SA', name: 'Saudi Arabia' },
  { code: '971', iso: 'AE', name: 'United Arab Emirates' },
  { code: '972', iso: 'IL', name: 'Israel' },
  { code: '973', iso: 'BH', name: 'Bahrain' },
  { code: '974', iso: 'QA', name: 'Qatar' },
  { code: '965', iso: 'KW', name: 'Kuwait' },
  { code: '968', iso: 'OM', name: 'Oman' },
  { code: '977', iso: 'NP', name: 'Nepal' },
];

export interface CountryInfo {
  readonly iso: string;
  readonly name: string;
  readonly code: string;
}

const UNKNOWN_COUNTRY: CountryInfo = { iso: '--', name: 'International', code: '' };

export function countryOf(e164: string): CountryInfo {
  const digits = e164.replace(/\D/g, '');
  for (const length of [3, 2, 1]) {
    const hit = DIAL_CODES.find((c) => c.code === digits.slice(0, length));
    if (hit) {
      return { iso: hit.iso, name: hit.name, code: hit.code };
    }
  }
  return UNKNOWN_COUNTRY;
}

export type NormaliseResult = { ok: true; e164: string } | { ok: false; reason: string };

/** Turns one digit run (with its optional leading "+") into "+<country><number>", or says why it cannot. */
export function normaliseNumber(digitsRaw: string, hadPlus: boolean): NormaliseResult {
  let digits = digitsRaw.replace(/\D/g, '');
  let plus = hadPlus;

  // "00" is the international call prefix, the same thing as "+".
  if (!plus && digits.startsWith('00') && digits.length > 11) {
    digits = digits.slice(2);
    plus = true;
  }

  if (digits.length < 8) {
    return { ok: false, reason: `Too short (${digits.length} digits)` };
  }
  if (digits.length > 15) {
    return { ok: false, reason: `Too long (${digits.length} digits)` };
  }

  if (plus) {
    if (digits.startsWith('91')) {
      return indianMobile(digits.slice(2));
    }
    return { ok: true, e164: '+' + digits };
  }

  // No "+" given. A bare 10-digit number, or one with a 0 / 91 in front, is read as Indian.
  if (digits.length === 10) {
    return indianMobile(digits);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return indianMobile(digits.slice(1));
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return indianMobile(digits.slice(2));
  }
  if (digits.length < 10) {
    return { ok: false, reason: `Too short (${digits.length} digits) and no country code` };
  }
  // 11-15 digits with no "+": most likely carries its own country code, so it is kept with a "+".
  return { ok: true, e164: '+' + digits };
}

function indianMobile(national: string): NormaliseResult {
  if (national.length !== 10) {
    return { ok: false, reason: `Indian number needs 10 digits after +91 (found ${national.length})` };
  }
  if (!/^[6-9]/.test(national)) {
    return { ok: false, reason: 'Indian mobile numbers start with 6, 7, 8 or 9' };
  }
  return { ok: true, e164: '+91' + national };
}

export interface FoundNumber {
  readonly e164: string;
  readonly raw: string;
}

export interface RowScan {
  readonly numbers: FoundNumber[];
  /** Why the row gave nothing; empty when at least one number was found. */
  readonly rejected: { raw: string; reason: string } | null;
}

/** A run of digits that may be separated by spaces, dots, dashes or brackets, with an optional "+". */
const CANDIDATE = /(\+?)\s*\(?\d[\d\s().\-]{6,}\d/g;

/**
 * Scans one row (a text line, or the cells of a spreadsheet row) for phone numbers.
 *
 * A row that yields at least one valid number is simply good - stray digits next to it (a short id) are
 * not reported. A row that yields none is reported once, with the reason for its best candidate.
 */
export function scanRow(cells: readonly string[]): RowScan {
  const numbers: FoundNumber[] = [];
  let firstReject: { raw: string; reason: string } | null = null;
  let sawDigits = false;

  for (const cell of cells) {
    const text = String(cell ?? '');
    if (!/\d/.test(text)) {
      continue;
    }
    sawDigits = true;
    let match: RegExpExecArray | null;
    CANDIDATE.lastIndex = 0;
    let anyCandidate = false;
    while ((match = CANDIDATE.exec(text)) !== null) {
      anyCandidate = true;
      // Two or more whole numbers on one line, separated by spaces: read each on its own.
      const tokens = match[0].trim().split(/\s+/);
      if (tokens.length > 1 && match[0].replace(/\D/g, '').length > 15
          && tokens.every((t) => t.replace(/\D/g, '').length >= 10)) {
        for (const token of tokens) {
          const part = normaliseNumber(token, token.startsWith('+'));
          if (part.ok) {
            numbers.push({ e164: part.e164, raw: token });
          } else if (!firstReject) {
            firstReject = { raw: token, reason: part.reason };
          }
        }
        continue;
      }
      const result = normaliseNumber(match[0], match[1] === '+');
      if (result.ok) {
        numbers.push({ e164: result.e164, raw: match[0].trim() });
      } else if (!firstReject) {
        firstReject = { raw: match[0].trim(), reason: result.reason };
      }
    }
    if (!anyCandidate && !firstReject) {
      const digits = text.replace(/\D/g, '');
      firstReject = { raw: text.trim(), reason: `Too short (${digits.length} digits)` };
    }
  }

  if (numbers.length > 0) {
    return { numbers, rejected: null };
  }
  const rawRow = cells.map((c) => String(c ?? '').trim()).filter(Boolean).join(', ');
  if (firstReject) {
    return { numbers, rejected: { raw: rawRow || firstReject.raw, reason: firstReject.reason } };
  }
  if (!sawDigits && rawRow) {
    return { numbers, rejected: { raw: rawRow, reason: 'No phone number found' } };
  }
  return { numbers, rejected: null };
}
