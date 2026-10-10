import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { DonorApiService } from '../../../../Service/donor-api.service';
import { FollowUpExecutionComponent } from './follow-up-execution';

/** The screen opened without a followUpId: it shows its empty state and calls nobody. */
const ROUTE_STUB = {
  queryParamMap: of(convertToParamMap({})),
  snapshot: { queryParamMap: convertToParamMap({}) },
};

describe('FollowUpExecutionComponent', () => {
  let component: FollowUpExecutionComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FollowUpExecutionComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: ROUTE_STUB },
        { provide: DonorApiService, useValue: {} },
      ],
    }).compileComponents();

    component = TestBed.createComponent(FollowUpExecutionComponent).componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('next follow-up time validation (BUG-100)', () => {
    const PAST_DATE = '2020-01-01';
    const PAST_TIME = '09:00';

    function futureDate(): string {
      const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
      return next.toISOString().slice(0, 10);
    }

    function planNext(date: string, time: string): void {
      component.nextFollowUpForm.controls['enabled'].setValue(true);
      component.nextFollowUpForm.controls['date'].setValue(date);
      component.nextFollowUpForm.controls['time'].setValue(time);
    }

    it('does not flag the time before Complete has been pressed', () => {
      planNext(PAST_DATE, PAST_TIME);
      expect(component.nextTimeInPast()).toBe(false);
    });

    it('flags a time that has already passed once Complete was tried', () => {
      planNext(PAST_DATE, PAST_TIME);
      component.attempted.set(true);

      expect(component.nextTimeInPast()).toBe(true);
      // It is filled - it is the moment that is wrong, not the field.
      expect(component.nextBad('time')).toBe(false);
    });

    it('accepts a time in the future', () => {
      planNext(futureDate(), '09:00');
      component.attempted.set(true);

      expect(component.nextTimeInPast()).toBe(false);
    });

    it('still requires the time itself', () => {
      planNext(PAST_DATE, '');
      component.attempted.set(true);

      expect(component.nextBad('time')).toBe(true);
      expect(component.nextTimeInPast()).toBe(false);
    });

    it('says nothing while "Plan another contact" is off', () => {
      component.nextFollowUpForm.controls['enabled'].setValue(false);
      component.attempted.set(true);

      expect(component.nextTimeInPast()).toBe(false);
      expect(component.nextBad('time')).toBe(false);
    });
  });
});