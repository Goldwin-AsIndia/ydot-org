import {
  DEFAULT_MONEY_FORMAT,
  currencyMark,
  formatAmountInput,
  formatCount,
  formatMoney,
  installMoneyFormat,
  withCurrencies,
} from './money-format';

describe('formatMoney', () => {
  afterEach(() => installMoneyFormat(DEFAULT_MONEY_FORMAT));

  it('groups in lakhs and crores by default', () => {
    expect(formatMoney(2381600, 'INR')).toBe('₹23,81,600');
    expect(formatMoney(123456789, 'INR')).toBe('₹12,34,56,789');
    expect(formatMoney(999, 'INR')).toBe('₹999');
  });

  it('shows paise only where the amount has them, unless the figure must be exact', () => {
    expect(formatMoney(2381600.5, 'INR')).toBe('₹23,81,600.50');
    expect(formatMoney(2381600, 'INR', { style: 'exact' })).toBe('₹23,81,600.00');
    expect(formatMoney(2381600.5, 'INR', { style: 'whole' })).toBe('₹23,81,601');
  });

  it('writes the short scale in lakhs and crores, moving up a unit after rounding', () => {
    expect(formatMoney(820000, 'INR', { style: 'compact' })).toBe('₹8.2L');
    expect(formatMoney(27300, 'INR', { style: 'compact' })).toBe('₹27.3K');
    expect(formatMoney(99950, 'INR', { style: 'compact' })).toBe('₹1L');
    expect(formatMoney(123456789, 'INR', { style: 'compact' })).toBe('₹12.3Cr');
  });

  it('follows the currency master: no decimals for yen, a gap after a lettered symbol', () => {
    expect(formatMoney(1234.5, 'JPY', { style: 'exact' })).toBe('¥1,235');
    expect(formatMoney(500, 'CHF')).toBe('CHF 500');
    expect(formatMoney(1500, 'XYZ')).toBe('XYZ 1,500');
  });

  it('omits the symbol where the caller says the currency is already named', () => {
    expect(formatMoney(2381600, 'INR', { marker: false })).toBe('23,81,600');
  });

  it('signs negatives and, when asked, positives', () => {
    expect(formatMoney(-1250.5, 'INR')).toBe('-₹1,250.50');
    expect(formatMoney(500, 'INR', { signed: true })).toBe('+₹500');
    expect(formatMoney(0, 'INR', { signed: true })).toBe('₹0');
  });

  it('says nothing was given rather than zero', () => {
    expect(formatMoney(null, 'INR')).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });

  it('switches to international grouping and codes when the platform says so', () => {
    installMoneyFormat({ ...DEFAULT_MONEY_FORMAT, numberGrouping: 'international', currencyMarker: 'code' });
    expect(formatMoney(2381600, 'INR')).toBe('INR 2,381,600');
    expect(formatMoney(2381600, 'INR', { style: 'compact' })).toBe('INR 2.4M');
    expect(currencyMark('INR')).toBe('INR');
    expect(formatCount(125000)).toBe('125,000');
  });

  it('takes a symbol and its position from the currency master', () => {
    installMoneyFormat(withCurrencies(DEFAULT_MONEY_FORMAT, [{ code: 'INR', symbol: 'Rs.', symbolAfter: true, decimalPlaces: 2 }]));
    expect(formatMoney(2381600, 'INR')).toBe('23,81,600 Rs.');
    expect(formatMoney(5000, 'JPY')).toBe('¥5,000');
  });

  it('uses the Organisation default when no currency is named', () => {
    installMoneyFormat({ ...DEFAULT_MONEY_FORMAT, defaultCurrency: 'USD' });
    expect(formatMoney(2500)).toBe('$2,500');
  });

  it('keeps a typed amount readable in its box', () => {
    expect(formatAmountInput(2381600.5, 'INR')).toBe('23,81,600.5');
    expect(formatCount(125000)).toBe('1,25,000');
    expect(formatMoney(0.0495, 'USD', { minFraction: 2, maxFraction: 4 })).toBe('$0.0495');
  });
});
