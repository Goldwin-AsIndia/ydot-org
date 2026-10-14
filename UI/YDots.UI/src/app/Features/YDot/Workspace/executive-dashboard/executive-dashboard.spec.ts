import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ExecutiveDashboardComponent } from './executive-dashboard';

describe('ExecutiveDashboardComponent', () => {
  let component: ExecutiveDashboardComponent;
  let fixture: ComponentFixture<ExecutiveDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExecutiveDashboardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ExecutiveDashboardComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
