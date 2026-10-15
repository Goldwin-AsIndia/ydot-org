import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { MoneyFormatResponse } from '../models/iam-contract.model';
import { AuthTokenService } from './auth-token.service';
import {
  CurrencyFormatRule,
  DEFAULT_MONEY_FORMAT,
  MoneyFormatConfig,
  installMoneyFormat,
  moneyFormatConfig,
  withCurrencies,
} from './money-format';

/**
 * Loads the platform's money format from IAM and installs it into `money-format.ts`.
 *
 * Started by the app initialiser, so it runs before - not instead of - the first screen: until the
 * answer arrives the last answer seen in this browser applies (kept in localStorage), and on a
 * first visit the built-in defaults do. The request is anonymous, so the public donation form gets
 * the same format as the signed-in screens.
 *
 * It also follows the session: an amount whose currency a screen does not name is in the
 * Organisation's default currency, which comes with the signed-in tenant context.
 */
@Injectable({ providedIn: 'root' })
export class MoneyFormatService {
  private static readonly CACHE_KEY = 'ydot.money-format';

  private readonly http = inject(HttpClient);
  private readonly tokens = inject(AuthTokenService);

  constructor() {
    const cached = this.readCache();
    if (cached) installMoneyFormat(cached);

    effect(() => {
      const currency = (this.tokens.tenant()?.defaultCurrency ?? '').trim().toUpperCase() || 'INR';
      const current = moneyFormatConfig();
      if (current.defaultCurrency !== currency) installMoneyFormat({ ...current, defaultCurrency: currency });
    });

    this.load();
  }

  /** Asks IAM again - after an administrator edits the currency master, for instance. */
  load(): void {
    this.http.get<ApiResponse<MoneyFormatResponse>>(`${environment.apiBaseUrl}/money-format`).subscribe({
      next: (response) => {
        const data = response?.data;
        if (!data) return;

        const rules: CurrencyFormatRule[] = (data.currencies ?? []).map((currency) => ({
          code: currency.code ?? '',
          symbol: currency.symbol ?? null,
          symbolAfter: (currency.symbolPosition ?? '').toLowerCase() === 'suffix',
          decimalPlaces: currency.decimalPlaces ?? 2,
        }));

        const config = withCurrencies(
          {
            ...moneyFormatConfig(),
            numberGrouping: (data.numberGrouping ?? '').toLowerCase() === 'international' ? 'international' : 'indian',
            currencyMarker: (data.currencyMarker ?? '').toLowerCase() === 'code' ? 'code' : 'symbol',
          },
          rules,
        );

        installMoneyFormat(config);
        this.writeCache(config);
      },
      // The defaults (or the cached answer) stay in force; an amount is still readable.
      error: () => undefined,
    });
  }

  private readCache(): MoneyFormatConfig | null {
    try {
      const raw = localStorage.getItem(MoneyFormatService.CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<MoneyFormatConfig>;
      if (!parsed || typeof parsed !== 'object' || !parsed.currencies) return null;
      return {
        ...DEFAULT_MONEY_FORMAT,
        numberGrouping: parsed.numberGrouping === 'international' ? 'international' : 'indian',
        currencyMarker: parsed.currencyMarker === 'code' ? 'code' : 'symbol',
        currencies: { ...DEFAULT_MONEY_FORMAT.currencies, ...parsed.currencies },
      };
    } catch {
      return null;
    }
  }

  private writeCache(config: MoneyFormatConfig): void {
    try {
      localStorage.setItem(
        MoneyFormatService.CACHE_KEY,
        JSON.stringify({ numberGrouping: config.numberGrouping, currencyMarker: config.currencyMarker, currencies: config.currencies }),
      );
    } catch {
      // Private window or storage blocked: the next visit simply starts from the defaults.
    }
  }
}
