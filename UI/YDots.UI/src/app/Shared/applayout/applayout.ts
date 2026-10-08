import { Component, OnInit, inject } from '@angular/core';
import { NotificationService } from '../../Service/notification.service';
import { FooterComponent } from '../footer/footer';
import { SidebarComponent } from '../sidebar/sidebar';
import { ThemeComponent } from '../theme/theme';
import { TopheaderComponent } from '../topheader/topheader';
import { LayoutService } from '../../Service/layout-service';
import { RouterOutlet } from '@angular/router';
import { RainbowLoaderComponent } from '../components/rainbow-loader/rainbow-loader';
import { BreadcrumbBarComponent } from '../components/breadcrumb-bar/breadcrumb-bar';

@Component({
  selector: 'app-applayout',
  imports: [RouterOutlet,SidebarComponent,TopheaderComponent,FooterComponent,ThemeComponent,RainbowLoaderComponent,BreadcrumbBarComponent],
  templateUrl: './applayout.html',
  styleUrl: './applayout.css',
})
export class ApplayoutComponent implements OnInit {
  private readonly notifications = inject(NotificationService);

  constructor(protected readonly layoutService: LayoutService) {}

  ngOnInit(): void {
    this.layoutService.init();
    // Reminds the owner of any required readiness check that is due before its campaign starts.
    this.notifications.checkReadinessReminders();
    
  }


}
