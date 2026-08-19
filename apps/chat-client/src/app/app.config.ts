import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { ADMIN_API_BASE_URL, ADMIN_AUTH_BRIDGE, AdminAuthBridge } from '@chat-monorepo/admin-analytics';
import { AuthService } from './services/auth.service';
import { getApiBaseUrl } from './core/runtime-config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter([]),
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
