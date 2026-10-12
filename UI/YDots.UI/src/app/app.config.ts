import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './Shared/interceptors/auth.interceptor';
import { ThemeColorService } from './Shared/theme/theme-color.service';
import { CardToneService } from './Shared/theme/card-tone.service';
import { AuthSessionService } from './Shared/services/auth-session.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    // Instantiated at start-up, not on first use, so the --theme-* variables are in sync with the saved
    // colour before any screen renders (login included) and the cross-tab listener is always live.
    //
    // AuthSessionService for a reason of its own: a page reloaded while signed in has to pick its
    // idle clock up again at once. Started only by a sign-in, the clock stood still after every
    // reload and asked people who were working for their password.
    provideAppInitializer(() => {
      inject(ThemeColorService);
      inject(CardToneService);
      inject(AuthSessionService);
    }),

    // withComponentInputBinding lets a route parameter such as :token arrive as an @Input on the
    // component, so screens do not each hand-roll ActivatedRoute plumbing.
    provideRouter(
      routes,
      withComponentInputBinding(),

      // withInMemoryScrolling puts every newly navigated page back at the top of the window.
      // 'enabled' scrolls to the top on each fresh navigation while still restoring the old
      // position when the user moves Back/Forward through browser history, and anchorScrolling
      // lets /path#fragment links jump to their element.
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),

    // withInterceptors registers authInterceptor, which attaches the bearer token, turns on
    // withCredentials so the HttpOnly refresh cookie is sent, renews an expired access token
    // once and replays the request, and unwraps the API's error envelope.
    //
    // withFetch uses the Fetch API instead of XMLHttpRequest, which is the modern default and
    // handles credentialed cross-origin requests more predictably.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
};
