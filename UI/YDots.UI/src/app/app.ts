import { AfterViewInit, Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LayoutService } from './Service/layout-service';
import { Toast } from "./Shared/components/toast/toast";
import { CommonModule } from '@angular/common';
import { DateFieldPickerService } from './Shared/services/date-field-picker.service';
import { InputGuardService } from './Shared/services/input-guard.service';
import { DialogHostMarkerService } from './Shared/services/dialog-host-marker.service';
import { PopupGuardService } from './Shared/services/popup-guard.service';

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
    // Number boxes refuse letters and name boxes refuse digits, app-wide.
    inject(InputGuardService).install();
    // Pop-ups close from one X at the top right only; a click on the dimmed area answers with a nudge.
    inject(PopupGuardService).install();
    // Marks the screens the shared dialog design covers with one cheap attribute (keeps navigation fast).
    inject(DialogHostMarkerService).install();
  }

 


}
