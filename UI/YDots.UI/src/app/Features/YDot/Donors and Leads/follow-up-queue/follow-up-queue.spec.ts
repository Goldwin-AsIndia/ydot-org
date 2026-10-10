import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { DonorApiService } from '../../../../Service/donor-api.service';
import {
  FollowUp as ApiFollowUp,
  FollowUpPlannerResponse,
} from '../../../../Shared/models/donor-contract.model';
import { FollowUpQueueComponent } from './follow-up-queue';

/** An address with no query string - the queue opened from the menu. */
const ROUTE_STUB = {
  queryParamMap: of(convertToParamMap({})),
  snapshot: { queryParamMap: convertToParamMap({}) },
};

/** An empty first page: the component still reads the summary and option lists off it. */
const EMPTY_PLANNER = {
  followUps: {
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: 100,
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false,
  },
  ownerOptions: [],
  channelOptions: [],
  priorityOptions: [],
  permittedActions: [],
  activeScope: 'Your whole organisation',
  summary: {
    total: 0,
    open: 0,
    dueToday: 0,
    upcoming: 0,
    overdue: 0,
    completedToday: 0,
    escalated: 0,
    assignedToMe: 0,
    completed: 0,
    cancelled: 0,
    completionRatePercent: 0,
    overduePercent: 0,
    health: 'Healthy',
  },
} as unknown as FollowUpPlannerResponse;

/** The fields the row mapping and the quick filters actually read. */
function apiItem(overrides: Partial<ApiFollowUp> = {}): ApiFollowUp {
  return {
    id: 'fup-0001',
    followUpReference: 'FUP-2026-000001',
    donorId: 'don-1',
    donorDisplayName: 'Asha Rao',
    leadId: null,
    relationshipOwnerUserId: 'usr-1',
    relationshipOwnerName: 'Priya Sharma',
    purpose: 'Thank-you call after the pledge',
    permittedChannel: 'PhoneCall',
    priority: 'Normal',
    status: 'Assigned',
    dueAtUtc: '2026-10-15T10:00:00Z',
    version: 1,
    isOpen: true,
    isOverdue: false,
    isAssignedToMe: true,
    escalatedAtUtc: null,
    history: [],
    dueState: 'Upcoming',
    executionStatus: null,
    completionReason: null,
    disposition: null,
    attachments: [],
    ...overrides,
  } as ApiFollowUp;
}

describe('FollowUpQueueComponent', () => {
  let component: FollowUpQueueComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FollowUpQueueComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: ROUTE_STUB },
        { provide: DonorApiService, useValue: { getFollowUpPlanner: () => of(EMPTY_PLANNER) } },
      ],
    }).compileComponents();

    component = TestBed.createComponent(FollowUpQueueComponent).componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('attachments on an executed follow-up (BUG-106)', () => {
    it('carries the uploaded file names from the API row into the queue row', () => {
      const row = component['toQueueRow'](
        apiItem({
          status: 'Completed',
          isOpen: false,
          attachments: ['receipt.pdf', 'consent letter.docx'],
        }),
      );

      expect(row.attachments).toEqual(['receipt.pdf', 'consent letter.docx']);
    });

    it('leaves the section empty when nothing was uploaded', () => {
      const row = component['toQueueRow'](apiItem());
      expect(row.attachments).toEqual([]);
    });
  });

  describe('the Escalated quick filter agrees with the Escalated tile (BUG-096)', () => {
    /** The tile's rule on the server: open-and-escalated, or executed as an escalation. */
    function matches(item: Partial<ApiFollowUp>): boolean {
      const row = component['toQueueRow'](apiItem(item));
      return component['matchesQuick'](row, 'escalated');
    }

    it('counts a follow-up escalated by the Escalate action', () => {
      expect(matches({ escalatedAtUtc: '2026-10-10T08:00:00Z' })).toBe(true);
    });

    it('counts a follow-up executed with completion reason Escalated', () => {
      expect(
        matches({
          status: 'Completed',
          isOpen: false,
          escalatedAtUtc: null,
          completionReason: 'Escalated',
        }),
      ).toBe(true);
    });

    it('counts a follow-up executed with disposition Escalated', () => {
      expect(
        matches({ status: 'Completed', isOpen: false, disposition: 'Escalated' }),
      ).toBe(true);
    });

    it('leaves an ordinary completed follow-up out', () => {
      expect(
        matches({ status: 'Completed', isOpen: false, completionReason: 'Successfully completed' }),
      ).toBe(false);
    });

    it('leaves an open, never-escalated follow-up out', () => {
      expect(matches({})).toBe(false);
    });
  });
});