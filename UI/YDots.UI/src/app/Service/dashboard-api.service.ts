import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse } from '../Shared/models/api-response.model';
import {
  DashboardModuleCode,
  DashboardOutcomes,
  DashboardOutcomesQuery,
  DashboardOutcomesResponse,
  DashboardPage,
  DashboardPanelKey,
  DashboardPanels,
  DashboardResponse,
} from '../Shared/models/dashboard-contract.model';

/**
 * The landing page's four sources - IAM, CAM, DON and PAY - and the rule that merges them.
 *
 * FOUR CALLS, NOT SEVENTEEN. The page used to ask seventeen list and statistics endpoints for
 * everything it might show and let the ones a role could not use fail; each refusal was an
 * access-denied audit row on every sign-in. Each service now answers one question - "what is on
 * this person's dashboard" - with only what that person may see, so nothing is refused.
 *
 * ONE SERVICE FAILING NEVER BLANKS THE PAGE. Each call degrades to "no answer" on its own, and
 * the page shows the sections the others sent.
 *
 * THE MERGE HOLDS NO CONTENT OF ITS OWN. It only orders what arrived: every headline, counter,
 * attention row and panel carries a rank set by the service that sent it.
 */
@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);

  private readonly endpoints: Record<DashboardModuleCode, string> = {
    IAM: `${environment.apiBaseUrl}/dashboard`,
    CAM: `${environment.campaignApiBaseUrl}/dashboard`,
    DON: `${environment.donorApiBaseUrl}/donors/dashboard`,
    PAY: `${environment.paymentApiBaseUrl}/v1/dashboard`,
  };

  /** The rail holds four cards. */
  static readonly RailSize = 4;

  /** The pulse strip holds seven counters. */
  static readonly PulseSize = 7;

  /** The viewer's dashboard, merged from the four services, in their own time zone. */
  load(timeZone = DashboardApiService.viewerTimeZone()): Observable<DashboardPage> {
    const params = new HttpParams().set('timeZone', timeZone);
    const calls = (Object.keys(this.endpoints) as DashboardModuleCode[]).map((module) =>
      this.http
        .get<ApiResponse<DashboardResponse>>(this.endpoints[module], { params })
        .pipe(
          map((response) => response.data ?? null),
          catchError(() => of(null)),
        ),
    );

    return forkJoin(calls).pipe(map((answers) => DashboardApiService.merge(answers)));
  }

  /**
   * The Executive dashboard's figures for a period and scope, from the three modules that hold
   * outcomes - CAM, DON and PAY. A module that refuses the period (400) reports why; one that
   * fails otherwise is named, and the page shows the rest.
   */
  loadOutcomes(query: DashboardOutcomesQuery, timeZone = DashboardApiService.viewerTimeZone()): Observable<DashboardOutcomes> {
    let params = new HttpParams().set('timeZone', timeZone);
    for (const [key, value] of Object.entries(query)) {
      if (value) params = params.set(key, value);
    }

    const modules: DashboardModuleCode[] = ['CAM', 'DON', 'PAY'];
    const calls = modules.map((module) =>
      this.http
        .get<ApiResponse<DashboardOutcomesResponse>>(`${this.endpoints[module]}/outcomes`, { params })
        .pipe(
          map((response) => ({ module, answer: response.data ?? null, refusal: undefined as string | undefined })),
          catchError((error: HttpErrorResponse) =>
            of({
              module,
              answer: null,
              refusal: error.status === 400 ? (error.error?.message as string | undefined) ?? 'The period cannot be read.' : undefined,
            }),
          ),
        ),
    );

    return forkJoin(calls).pipe(
      map((results) => {
        const present = results.map((r) => r.answer).filter((a): a is DashboardOutcomesResponse => !!a);
        const first = present[0];
        const refusal = results.find((r) => r.refusal)?.refusal;
        return {
          metrics: present.flatMap((a) => a.metrics ?? []).sort((l, r) => l.rank - r.rank),
          series: present.find((a) => a.series)?.series,
          scopeOptions: present.flatMap((a) => a.scopeOptions ?? []),
          presets: present.find((a) => a.presets?.length)?.presets ?? [],
          comparisons: present.find((a) => a.comparisons?.length)?.comparisons ?? [],
          fromDate: first?.fromDate,
          toDate: first?.toDate,
          comparisonFromDate: first?.comparisonFromDate,
          comparisonToDate: first?.comparisonToDate,
          timeZoneLabel: first?.timeZoneLabel,
          generatedAtUtc: present.map((a) => a.generatedAtUtc).sort().pop(),
          failed: results.filter((r) => !r.answer && !r.refusal).map((r) => r.module),
          refusal,
        };
      }),
    );
  }

  /** The browser's IANA zone, so "today" on the page is the viewer's today. */
  static viewerTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  /**
   * Four answers into one page. Lower rank wins a tile; the rail takes the four lowest-ranked
   * cards; attention rows are all kept, the busiest first.
   */
  static merge(answers: (DashboardResponse | null)[]): DashboardPage {
    const present = answers.filter((answer): answer is DashboardResponse => !!answer);
    const byRank = <T extends { rank: number }>(left: T, right: T) => left.rank - right.rank;

    const panels: DashboardPanels = {};
    const keys: DashboardPanelKey[] = [
      'trend', 'health', 'activity', 'agenda', 'pipeline', 'ranking', 'leaders', 'feed', 'sources', 'funnel',
    ];
    for (const key of keys) {
      const candidates = present
        .map((answer) => answer.panels?.[key])
        .filter((panel): panel is NonNullable<typeof panel> => !!panel)
        .sort(byRank);
      if (candidates.length) {
        (panels as Record<string, unknown>)[key] = candidates[0];
      }
    }

    return {
      viewer: present.find((answer) => answer.viewer)?.viewer,
      headlines: present.flatMap((answer) => answer.headlines ?? []).sort(byRank).slice(0, DashboardApiService.RailSize),
      counters: present.flatMap((answer) => answer.counters ?? []).sort(byRank).slice(0, DashboardApiService.PulseSize),
      attention: present
        .flatMap((answer) => answer.attention ?? [])
        .filter((item) => item.count > 0)
        .sort((left, right) => right.count - left.count || left.rank - right.rank),
      actions: present.flatMap((answer) => answer.actions ?? []).sort(byRank),
      panels,
      answered: present.map((answer) => answer.module),
      generatedAtUtc: present.map((answer) => answer.generatedAtUtc).sort().pop(),
    };
  }
}
