import { signal } from '@angular/core';

/**
 * How every amount on every screen is written.
 *
 * ONE RULE FOR THE WHOLE APPLICATION, and the same rule the four services apply on the server
 * (`MoneyText.cs` in IAM, CAM, DON and PAY). Two things decide it:
 *
 *  - THE PLATFORM SETTING (MoneyFormat in the services' configuration, MONEY_NUMBER_GROUPING and
 *    MONEY_CURRENCY_MARKER in docker-compose): Indian grouping 23,81,600 or International
 *    2,381,600, and whether a currency is marked by its symbol (₹) or its code (INR).
 *  - THE CURRENCY MASTER (Masters, Currency): each currency's symbol, where it sits and how many
 *    decimal places it has.
 *
 * IAM serves both on `GET /api/v1/money-format`; `MoneyFormatService` loads them at start-up and
 * installs them here. Until then - and if IAM cannot be reached - the defaults below (the seeded
 * master, Indian grouping, symbols) apply, so nothing on screen waits on the request.
 *
 * WHICH DECIMALS, by how much the exact figure matters where it is shown:
 *  - `standard`  ₹5,000 and ₹5,000.50 - paise only when the amount has them. The default.
 *  - `exact`     ₹5,000.00 - always the currency's places. Receipts, refunds, settlement,
 *                reconciliation, the amount being paid.
 *  - `whole`     ₹5,001 - rounded. Dashboard tiles, targets, budgets, headline totals.
 *  - `compact`   ₹23.8L, ₹1.2Cr (₹2.4M with International grouping) - chart axes, captions.
 *
 * AND THE SYMBOL ONLY WHERE IT IS NEEDED: pass `marker: false` where the currency is already
 * named beside the figure (a column headed "Amount (₹)" - see `currencyMark` for the heading).
 *
 * NO LOCALE DATA DECIDES THE GROUPING. It is applied by hand, so the browser's language cannot
 * turn 23,81,600 back into 2,381,600.
 */

export type MoneyStyle = 'standard' | 'exact' | 'whole' | 'compact';
export type NumberGrouping = 'indian' | 'international';
export type CurrencyMarker = 'symbol' | 'code';

/** One currency's writing rule, from the currency master. */
export interface CurrencyFormatRule {
  code: string;
  symbol: string | null;
  symbolAfter: boolean;
  decimalPlaces: number;
}

export interface MoneyFormatConfig {
  numberGrouping: NumberGrouping;
  currencyMarker: CurrencyMarker;
  /** Keyed by upper-case ISO code. */
  currencies: Record<string, CurrencyFormatRule>;
  /** The currency an amount is in when the caller does not say - the Organisation's default. */
  defaultCurrency: string;
}

export interface MoneyOptions {
  /** How many decimals; see the file comment. `standard` when omitted. */
  style?: MoneyStyle;
  /** False where the currency is already named beside the figure. True when omitted. */
  marker?: boolean;
  /** "+₹500" for a positive change, as on a variance. */
  signed?: boolean;
  /**
   * Explicit decimals, overriding the style's: a per-number price billed in fractions of a cent
   * needs `{ minFraction: 2, maxFraction: 6 }`.
   */
  minFraction?: number;
  maxFraction?: number;
}

/** The seeded currency master - what applies until IAM's answer arrives. */
const BUILT_IN_CURRENCIES: CurrencyFormatRule[] = [
  { code: 'INR', symbol: '₹', symbolAfter: false, decimalPlaces: 2 },
  { code: 'USD', symbol: '$', symbolAfter: false, decimalPlaces: 2 },
  { code: 'SGD', symbol: 'S$', symbolAfter: false, decimalPlaces: 2 },
  { code: 'AED', symbol: 'د.إ', symbolAfter: false, decimalPlaces: 2 },
  { code: 'GBP', symbol: '£', symbolAfter: false, decimalPlaces: 2 },
  { code: 'EUR', symbol: '€', symbolAfter: false, decimalPlaces: 2 },
  { code: 'CAD', symbol: 'C$', symbolAfter: false, decimalPlaces: 2 },
  { code: 'AUD', symbol: 'A$', symbolAfter: false, decimalPlaces: 2 },
  { code: 'JPY', symbol: '¥', symbolAfter: false, decimalPlaces: 0 },
  { code: 'CNY', symbol: '¥', symbolAfter: false, decimalPlaces: 2 },
  { code: 'ZAR', symbol: 'R', symbolAfter: false, decimalPlaces: 2 },
  { code: 'CHF', symbol: 'CHF', symbolAfter: false, decimalPlaces: 2 },
];

export const DEFAULT_MONEY_FORMAT: MoneyFormatConfig = {
  numberGrouping: 'indian',
  currencyMarker: 'symbol',
  currencies: Object.fromEntries(BUILT_IN_CURRENCIES.map((rule) => [rule.code, rule])),
  defaultCurrency: 'INR',
};

const INDIAN_UNITS: ReadonlyArray<readonly [number, string]> = [[1e7, 'Cr'], [1e5, 'L'], [1e3, 'K']];
const INTERNATIONAL_UNITS: ReadonlyArray<readonly [number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

const configState = signal<MoneyFormatConfig>(DEFAULT_MONEY_FORMAT);

/**
 * The format in force. A signal, so a template, a computed or an effect that formats an amount
 * re-renders by itself when IAM's answer replaces the defaults.
 */
export const moneyFormatConfig = configState.asReadonly();

/** Installs a new format. Called by `MoneyFormatService`; nothing else should need to. */
export function installMoneyFormat(config: MoneyFormatConfig): void {
  configState.set(config);
}

/** Merges the currency master's rows over the built-in rules: a code the master lacks keeps its own. */
export function withCurrencies(base: MoneyFormatConfig, rules: CurrencyFormatRule[]): MoneyFormatConfig {
  const currencies = { ...DEFAULT_MONEY_FORMAT.currencies };
  for (const rule of rules) {
    const code = (rule.code ?? '').trim().toUpperCase();
    if (code) currencies[code] = { ...rule, code };
  }
  return { ...base, currencies };
}

/** The rule for a currency; an unknown code is marked by its code with two places. */
export function currencyRule(currencyCode?: string | null, config = configState()): CurrencyFormatRule {
  const code = (currencyCode ?? config.defaultCurrency ?? '').trim().toUpperCase();
  return config.currencies[code] ?? { code, symbol: null, symbolAfter: false, decimalPlaces: 2 };
}

/**
 * "₹23,81,600", "₹1,250.50", "₹23.8L" - an amount in its currency.
 *
 * `currencyCode` omitted means the Organisation's default currency. A missing amount reads "—"
 * rather than "₹0", because nothing and zero are different facts.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currencyCode?: string | null,
  options: MoneyOptions = {},
): string {
  return formatMoneyWithRule(amount, currencyRule(currencyCode), options);
}

/** {@link formatMoney} under an explicit rule - a currency master row being previewed. */
export function formatMoneyWithRule(
  amount: number | string | null | undefined,
  rule: CurrencyFormatRule,
  options: MoneyOptions = {},
): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';

  const config = configState();
  const places = clamp(rule.decimalPlaces, 0, 8);
  const magnitude = Math.abs(value);

  let number: string;
  if (options.minFraction !== undefined || options.maxFraction !== undefined) {
    const max = clamp(options.maxFraction ?? options.minFraction ?? places, 0, 10);
    const min = clamp(options.minFraction ?? 0, 0, max);
    number = fixed(magnitude, min, max, config.numberGrouping);
  } else {
    switch (options.style ?? 'standard') {
      case 'exact':
        number = fixed(magnitude, places, places, config.numberGrouping);
        break;
      case 'whole':
        number = fixed(magnitude, 0, 0, config.numberGrouping);
        break;
      case 'compact':
        number = compact(magnitude, config.numberGrouping);
        break;
      default:
        number = whenNeeded(magnitude, places, config.numberGrouping);
    }
  }

  const isZero = !/[1-9]/.test(number);
  const sign = isZero ? '' : value < 0 ? '-' : options.signed ? '+' : '';

  if (options.marker === false || !rule.code) return sign + number;

  if (config.currencyMarker === 'symbol' && rule.symbol?.trim()) {
    const symbol = rule.symbol.trim();
    if (rule.symbolAfter) return `${sign}${number} ${symbol}`;
    // "CHF 500" but "₹500" and "S$500": a symbol that ends in a letter would run into the digits.
    const gap = symbol.length > 1 && /\p{L}$/u.test(symbol) ? ' ' : '';
    return `${sign}${symbol}${gap}${number}`;
  }

  return rule.symbolAfter ? `${sign}${number} ${rule.code}` : `${sign}${rule.code} ${number}`;
}

/** "₹" or "INR" - the mark for a heading such as "Amount (₹)", per the platform setting. */
export function currencyMark(currencyCode?: string | null): string {
  const config = configState();
  const rule = currencyRule(currencyCode, config);
  return config.currencyMarker === 'symbol' && rule.symbol?.trim() ? rule.symbol.trim() : rule.code;
}

/** How many decimal places a currency has, for an amount input's step. */
export function currencyDecimals(currencyCode?: string | null): number {
  return clamp(currencyRule(currencyCode).decimalPlaces, 0, 8);
}

/** "1,25,000" - a count grouped the same way as the amounts beside it; "4.5" with `maxFraction`. */
export function formatCount(value: number | null | undefined, maxFraction = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const number = fixed(Math.abs(value), 0, clamp(maxFraction, 0, 6), configState().numberGrouping);
  return value < 0 && /[1-9]/.test(number) ? `-${number}` : number;
}

/**
 * An amount for a number INPUT as the person is typing it - grouped, without a marker, keeping the
 * decimals they have typed so far: "23,81,600", "1,250.5".
 */
export function formatAmountInput(value: number | null | undefined, currencyCode?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return formatMoney(value, currencyCode, { marker: false, minFraction: 0, maxFraction: currencyDecimals(currencyCode) });
}

// ---------------------------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.trunc(value) : min));
}

/** Rounds to `max` places, drops trailing zeros down to `min`, then groups the whole part. */
function fixed(magnitude: number, min: number, max: number, grouping: NumberGrouping): string {
  const text = magnitude.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });
  const [whole, fraction] = text.split('.');
  return fraction ? `${group(whole, grouping)}.${fraction}` : group(whole, grouping);
}

/** The currency's places when the rounded amount has a fraction, none when it does not. */
function whenNeeded(magnitude: number, places: number, grouping: NumberGrouping): string {
  const full = fixed(magnitude, places, places, grouping);
  return /\.0*$/.test(full) ? full.replace(/\.0*$/, '') : full;
}

/**
 * One decimal at most, and the unit chosen AFTER rounding, so 99,950 reads "1L" rather than
 * "100K" - a figure that has reached the next unit is written in it.
 */
function compact(magnitude: number, grouping: NumberGrouping): string {
  if (magnitude >= 1000) {
    for (const [size, suffix] of grouping === 'indian' ? INDIAN_UNITS : INTERNATIONAL_UNITS) {
      const scaled = Math.round((magnitude / size) * 10) / 10;
      if (scaled >= 1) return fixed(scaled, 0, 1, grouping) + suffix;
    }
  }
  return fixed(magnitude, 0, 0, grouping);
}

/** 2381600 -> "23,81,600" (Indian) or "2,381,600" (International). */
function group(whole: string, grouping: NumberGrouping): string {
  if (whole.length <= 3) return whole;
  const size = grouping === 'indian' ? 2 : 3;
  const parts = [whole.slice(-3)];
  let rest = whole.slice(0, -3);
  while (rest.length > size) {
    parts.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',');
}
