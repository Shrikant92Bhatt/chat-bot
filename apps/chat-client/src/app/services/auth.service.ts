import { Injectable, signal } from '@angular/core';
import { UserSession } from '@chat-monorepo/shared';
import { getApiBaseUrl } from '../core/runtime-config';

declare const google: any;

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  public userSignal = signal<UserSession | null>(null);

  // Drives the "session expired" popup - true whenever a previously signed-in
  // user's Google ID token has expired (detected on load or on a 401 from the API).
  public sessionExpired = signal<boolean>(false);

  // Reads configured Google Client ID from backend .env or localStorage
  public googleClientId = signal<string>(
    (localStorage.getItem('NEXUS_GOOGLE_CLIENT_ID') || '').trim()
  );

  // Whether the backend has a real OPENAI_API_KEY configured - drives
  // whether the OpenAI model option is shown at all.
  public openAiConfigured = signal<boolean>(false);

  private configPromise: Promise<void> | null = null;

  constructor() {
    this.restoreSession();
    this.configPromise = this.fetchBackendConfig();
  }

  /**
   * Automatically fetches GOOGLE_CLIENT_ID from backend Express .env file
   */
  private async fetchBackendConfig(): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/chat/config`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.googleClientId) {
          const envClientId = data.googleClientId.trim();
          if (envClientId) {
            this.googleClientId.set(envClientId);
            localStorage.setItem('NEXUS_GOOGLE_CLIENT_ID', envClientId);
          }
        }
        this.openAiConfigured.set(!!data?.openAiConfigured);
      }
    } catch (e) {
      console.error('[Google Auth] Failed to fetch backend config:', e);
    }
  }

  /**
   * Restores user session, automatically invalidating expired Google ID tokens
   */
  private restoreSession(): void {
    const storedSession = localStorage.getItem('NEXUS_AUTH_SESSION');
    if (storedSession) {
      try {
        const session: UserSession = JSON.parse(storedSession);
        if (session.idToken) {
          const payload = this.decodeJwtPayload(session.idToken);
          const currentTimestampSeconds = Math.floor(Date.now() / 1000);
          // If Google ID Token is expired (exp < current time), clear expired session
          if (payload && payload.exp && payload.exp < currentTimestampSeconds) {
            console.warn('[Google Auth] Saved Google ID Token expired. Clearing session.');
            this.notifySessionExpired();
            return;
          }
        }
        this.userSignal.set(session);
      } catch (e) {
        this.logout();
      }
    }
  }

  /**
   * Triggers Google Identity Services OAuth 2.0 flow directly using configured Client ID.
   */
  public async loginWithGoogle(): Promise<void> {
    let currentClientId = this.googleClientId().trim();

    if (!currentClientId) {
      await this.configPromise;
      currentClientId = this.googleClientId().trim();
    }
    if (!currentClientId) {
      await this.fetchBackendConfig();
      currentClientId = this.googleClientId().trim();
    }
    if (!currentClientId) {
      console.error('[Google Auth] No Google Client ID available. Ensure GOOGLE_CLIENT_ID is set in .env.');
      return;
    }

    if (typeof google !== 'undefined' && google.accounts) {
      try {
        google.accounts.id.initialize({
          client_id: currentClientId,
          callback: (response: any) => this.handleGoogleCredentialResponse(response),
          auto_select: false,
        });

        google.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            this.triggerOAuth2TokenClient(currentClientId);
          }
        });
      } catch (err) {
        console.error('[Google Auth] Initialization notice:', err);
        this.triggerOAuth2TokenClient(currentClientId);
      }
    } else {
      console.error('[Google Auth] Google Identity Services script not loaded');
    }
  }

  private triggerOAuth2TokenClient(clientId: string): void {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
          callback: (tokenResponse: any) => {
            if (tokenResponse && tokenResponse.access_token) {
              this.fetchUserInfoWithAccessToken(tokenResponse.access_token);
            }
          },
        });
        client.requestAccessToken();
      } catch (e) {
        console.error('[Google Auth] OAuth2 Token client failed:', e);
      }
    }
  }

  private async fetchUserInfoWithAccessToken(accessToken: string): Promise<void> {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const userinfo = await res.json();
        const session: UserSession = {
          uid: userinfo.sub,
          email: userinfo.email || '',
          displayName: userinfo.name || 'Google User',
          photoURL: userinfo.picture || '',
          idToken: accessToken,
        };
        this.setUserSession(session);
      }
    } catch (e) {
      console.error('[Google Auth] Failed to fetch userinfo:', e);
    }
  }

  public handleGoogleCredentialResponse(response: any): void {
    if (response && response.credential) {
      const payload = this.decodeJwtPayload(response.credential);

      const session: UserSession = {
        uid: payload.sub,
        email: payload.email || '',
        displayName: payload.name || 'Google User',
        photoURL: payload.picture || '',
        idToken: response.credential,
      };

      this.setUserSession(session);
    }
  }

  private setUserSession(session: UserSession): void {
    this.userSignal.set(session);
    this.sessionExpired.set(false);
    localStorage.setItem('NEXUS_AUTH_SESSION', JSON.stringify(session));
  }

  private decodeJwtPayload(token: string): any {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      return {};
    }
  }

  public logout(): void {
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
    this.userSignal.set(null);
    localStorage.removeItem('NEXUS_AUTH_SESSION');
  }

  /** Marks the session as expired (shows the sign-in-again popup) and clears it. */
  public notifySessionExpired(): void {
    this.sessionExpired.set(true);
    this.logout();
  }

  /** Dismisses the "session expired" popup without signing back in. */
  public dismissSessionExpired(): void {
    this.sessionExpired.set(false);
  }

  public getIdToken(): string {
    return this.userSignal()?.idToken || '';
  }
}
