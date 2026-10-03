import { Component, computed, input, output } from '@angular/core';
import { WaSelectComponent } from '../wa-select/wa-select';

/**
 * Page controls for the long number lists. Lists of 1,000+ numbers are never rendered whole: the screens slice
 * them and this bar moves between slices.
 */
@Component({
  selector: 'app-wa-pager',
  imports: [WaSelectComponent],
  templateUrl: './wa-pager.html',
  styleUrl: './wa-pager.css',
})
export class WaPagerComponent {
  readonly total = input.required<number>();
  readonly page = input.required<number>();
  readonly size = input.required<number>();
  readonly sizes = input<readonly number[]>([25, 50, 100, 200]);
  readonly noun = input('numbers');

  readonly pageChange = output<number>();
  readonly sizeChange = output<number>();

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.size())));
  protected readonly from = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * this.size() + 1));
  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.size()));

  /** First, last, the current page and its neighbours, with gaps marked as 0. */
  protected readonly pages = computed(() => {
    const last = this.pageCount();
    const current = this.page();
    const wanted = new Set([1, last, current - 1, current, current + 1]);
    const list = [...wanted].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
    const out: number[] = [];
    list.forEach((p, i) => {
      if (i > 0 && p - list[i - 1] > 1) {
        out.push(0);
      }
      out.push(p);
    });
    return out;
  });

  protected go(page: number): void {
    if (page >= 1 && page <= this.pageCount() && page !== this.page()) {
      this.pageChange.emit(page);
    }
  }

  protected readonly sizeOptions = computed(() => this.sizes().map((n) => ({ value: String(n), label: `${n} rows` })));

  protected resize(value: string): void {
    this.sizeChange.emit(Number(value));
  }
}
