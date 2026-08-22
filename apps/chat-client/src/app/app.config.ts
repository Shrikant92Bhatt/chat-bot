import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { LocationStrategy, PathLocationStrategy } from '@angular/common';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { ADMIN_API_BASE_URL, ADMIN_AUTH_BRIDGE, AdminAuthBridge } from '@chat-monorepo/admin-analytics';
import { AuthService } from './services/auth.service';
import { getApiBaseUrl } from './core/runtime-config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // This app has no <router-outlet>/RouterLink/ActivatedRoute anywhere -
    // the URL bar (one path per chat thread, see ChatService) is driven
    // directly through Angular's Location service instead. Providing
    // Location needs a LocationStrategy; provideRouter([]) used to supply
    // one, but the Router it also brings in actively matches every URL
    // change against that empty route table and throws NG04002 on each
    // one - providing PathLocationStrategy directly gets Location without
    // ever activating a Router this app doesn't use.
    { provide: LocationStrategy, useClass: PathLocationStrategy },
    provideHttpClient(withXhr()),
    provideAnimations(),
    // Bridges the admin-analytics lib to this app's own auth, so that lib
    // stays independent of chat-client's concrete AuthService (see
    // libs/frontend/admin-analytics/src/lib/auth-bridge.token.ts).
    {
      provide: ADMIN_AUTH_BRIDGE,
      useFactory: (auth: AuthService): AdminAuthBridge => ({
        getIdToken: () => auth.getIdToken(),
        currentUid: () => auth.userSignal()?.uid ?? null,
        notifySessionExpired: () => auth.notifySessionExpired(),
      }),
      deps: [AuthService],
    },
    { provide: ADMIN_API_BASE_URL, useValue: getApiBaseUrl() },
  ],
};
