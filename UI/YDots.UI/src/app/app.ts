import { AfterViewInit, Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LayoutService } from './Service/layout-service';
import { Toast } from "./Shared/components/toast/toast";
import { CommonModule } from '@angular/common';
import { DateFieldPickerService } from './Shared/services/date-field-picker.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast,CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('YDot');

  constructor() {
    // Every date field in the app opens the shared calendar on a click anywhere in the field.
    inject(DateFieldPickerService).install();
  }

 


}
