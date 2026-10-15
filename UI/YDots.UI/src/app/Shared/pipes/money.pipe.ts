import { Pipe, PipeTransform } from '@angular/core';
import { MoneyOptions, MoneyStyle, formatCount, formatMoney } from '../services/money-format';

/**
 * {@link formatMoney} for templates - the platform's money format (see money-format.ts).
 *
 * @example {{ gift.amount | money: gift.currencyCode }}                     // ₹23,81,600
 * @example {{ refund.amount | money: refund.currencyCode : 'exact' }}       // ₹5,000.00
 * @example {{ campaign.target | money: 'INR' : 'compact' }}                 // ₹23.8L
 * @example {{ row.amount | money: row.currency : { marker: false } }}       // 23,81,600
 *
 * IMPURE ON PURPOSE. The format arrives from IAM after the first render; a pure pipe would keep
 * the answer it gave before that, since its inputs never changed. Formatting a number is cheap.
 */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  transform(
    value: number | string | null | undefined,
    currencyCode?: string | null,
    styleOrOptions?: MoneyStyle | MoneyOptions,
  ): string {
    const options = typeof styleOrOptions === 'string' ? { style: styleOrOptions } : (styleOrOptions ?? {});
    return formatMoney(value, currencyCode, options);
  }
}

/**
 * A plain figure grouped like the amounts beside it: {{ donors | grouped }} reads 1,25,000 with
 * Indian grouping.
 */
@Pipe({ name: 'grouped', standalone: true, pure: false })
export class GroupedNumberPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatCount(value);
  }
}
