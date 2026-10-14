import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DashboardApiService } from './dashboard-api.service';
import { DashboardOutcomes, DashboardResponse } from '../Shared/models/dashboard-contract.model';

/** A service's answer with nothing in it, to be filled per test. */
function answer(module: DashboardResponse['module'], fill: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    module,
    generatedAtUtc: '2026-10-14T00:00:00Z',
    timeZone: 'Asia/Kolkata',
    headlines: [],
    counters: [],
    attention: [],
    actions: [],
    panels: {},
    ...fill,
  };
}

const card = (key: string, rank: number) => ({
  key, rank, label: key, icon: 'ri-x', tone: 'ok', display: '1', caption: '', meterPercent: 0, foot: '',
});

const trend = (rank: number, title: string) => ({
  rank, title, caption: '', unit: 'count', currencyCode: '', countSingular: 'x', countPlural: 'xs',
  points: [], stats: [], empty: { title: '', hint: '' },
});

describe('DashboardApiService.merge', () => {
  it('fills each tile from the lowest-ranked panel any service sent', () => {
    const page = DashboardApiService.merge([
      answer('PAY', { panels: { trend: trend(10, 'Giving') } }),
      answer('DON', { panels: { trend: trend(20, 'Lead intake') } }),
    ]);

    expect(page.panels.trend?.title).toBe('Giving');
  });

  it('falls back to the next service when the first has nothing for the tile', () => {
    const page = DashboardApiService.merge([answer('PAY'), answer('DON', { panels: { trend: trend(20, 'Lead intake') } })]);

    expect(page.panels.trend?.title).toBe('Lead intake');
  });

  it('puts the four lowest-ranked headline cards on the rail, in rank order', () => {
    const page = DashboardApiService.merge([
      answer('PAY', { headlines: [card('funds', 10), card('gifts', 20)] }),
      answer('CAM', { headlines: [card('live', 30), card('pipeline', 50)] }),
      answer('DON', { headlines: [card('leads', 40), card('follow-ups', 60)] }),
    ]);

    expect(page.headlines.map((h) => h.key)).toEqual(['funds', 'gifts', 'live', 'leads']);
  });

  it('keeps every attention row with a count, the busiest first', () => {
    const row = (key: string, count: number, rank: number) => ({ key, count, rank, label: key, hint: '', icon: 'ri-x' });
    const page = DashboardApiService.merge([
      answer('PAY', { attention: [row('receipts', 3, 10), row('nothing', 0, 5)] }),
      answer('DON', { attention: [row('overdue', 19, 10)] }),
    ]);

    expect(page.attention.map((a) => a.key)).toEqual(['overdue', 'receipts']);
  });

  it('ignores a service that did not answer and names the ones that did', () => {
    const page = DashboardApiService.merge([
      answer('IAM', { viewer: { displayName: 'Anjali Prakash', roleNames: ['Organisation Admin'], isPlatform: false } }),
      null,
      answer('PAY'),
    ]);

    expect(page.answered).toEqual(['IAM', 'PAY']);
    expect(page.viewer?.roleNames).toEqual(['Organisation Admin']);
  });
});

describe('DashboardApiService.loadOutcomes', () => {
  let service: DashboardApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DashboardApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reports the reason a module refused the period, and names a module that failed', () => {
    let result: DashboardOutcomes | undefined;
    service.loadOutcomes({ fromDate: '2026-10-10', toDate: '2026-10-01' }, 'Asia/Kolkata').subscribe((r) => (result = r));

    http.expectOne((r) => r.url.endsWith('/cam-api/v1/dashboard/outcomes'))
      .flush({ message: 'The period ends before it starts.' }, { status: 400, statusText: 'Bad Request' });
    http.expectOne((r) => r.url.endsWith('/don-api/v1/donors/dashboard/outcomes'))
      .flush(null, { status: 500, statusText: 'Server Error' });
    const pay = http.expectOne((r) => r.url.endsWith('/pay-api/v1/dashboard/outcomes'));
    expect(pay.request.params.get('fromDate')).toBe('2026-10-10');
    expect(pay.request.params.get('timeZone')).toBe('Asia/Kolkata');
    pay.flush({ success: true, data: null });

    expect(result?.refusal).toBe('The period ends before it starts.');
    expect(result?.failed).toEqual(['DON', 'PAY']);
  });
});
