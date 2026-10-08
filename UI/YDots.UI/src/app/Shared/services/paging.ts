import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import { PagedResponse } from '../models/api-response.model';

/** The rows a multi-page fetch collected, and how many the server says exist in all. */
export interface FetchedPages<T> {
  items: T[];
  totalCount: number;
}

/**
 * The rows of a paged endpoint, for a screen that searches, filters and pages in the browser.
 *
 * WHY THIS EXISTS. Several screens asked for "page 1, 100 rows" (or 200, or 500) and then treated
 * the answer as the whole list. The API caps a page at 100 whatever is asked for, so the 101st
 * access request, user or role simply never appeared - and every count the screen printed was a
 * count of the first page while reading as a total.
 *
 * ONE REQUEST IN THE COMMON CASE. The first page says how many rows exist; only when there are
 * more than fit on it are the remaining pages fetched, all at once, and joined in order.
 *
 * `fetchPage` receives the 1-based page number and the page size to request. The size the server
 * reports back is used for the follow-up pages, so a cap below the requested size is honoured
 * rather than producing overlapping or missing rows. `maxRows` stops early for a screen that wants
 * a ceiling; compare `totalCount` with `items.length` to tell the person they reached it.
 */
export function fetchPages<T>(
  fetchPage: (page: number, pageSize: number) => Observable<PagedResponse<T>>,
  pageSize = 100,
  maxRows = Number.POSITIVE_INFINITY,
): Observable<FetchedPages<T>> {
  return fetchPage(1, pageSize).pipe(
    switchMap((first) => {
      const firstItems = first.items ?? [];
      const size = first.pageSize > 0 ? first.pageSize : pageSize;
      const totalCount = first.totalCount ?? firstItems.length;
      const pages = Math.ceil(Math.min(totalCount, maxRows) / size);

      if (pages <= 1 || firstItems.length === 0) {
        return of({ items: firstItems.slice(0, maxRows), totalCount });
      }

      const rest = Array.from({ length: pages - 1 }, (_, index) =>
        fetchPage(index + 2, size).pipe(map((page) => page.items ?? [])));

      return forkJoin(rest).pipe(
        map((more) => ({ items: [...firstItems, ...more.flat()].slice(0, maxRows), totalCount })));
    }),
  );
}

/** Every row of a paged endpoint. See {@link fetchPages}. */
export function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Observable<PagedResponse<T>>,
  pageSize = 100,
): Observable<T[]> {
  return fetchPages(fetchPage, pageSize).pipe(map((result) => result.items));
}
