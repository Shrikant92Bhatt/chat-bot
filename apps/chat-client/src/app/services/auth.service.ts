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

  // User-visible message for a failed sign-in attempt (popup blocked, backend
  // unreachable, token rejected, etc). Previously these failures were only
  // console.error'd, so a broken login looked like nothing happened at all.
  public loginError = signal<string | null>(null);

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
    this.loginError.set(null);
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
      const message = 'Could not reach the sign-in service. Check your connection and try again.';
      console.error('[Google Auth] No Google Client ID available. Ensure GOOGLE_CLIENT_ID is set in .env.');
      this.loginError.set(message);
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
      const message = 'Sign-in is still loading. Please try again in a moment.';
      console.error('[Google Auth] Google Identity Services script not loaded');
      this.loginError.set(message);
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
              this.exchangeGoogleTokenForSession(tokenResponse.access_token);
            } else {
              this.loginError.set('Google sign-in did not return a token. Please try again.');
            }
          },
          error_callback: (err: any) => {
            console.error('[Google Auth] OAuth2 popup failed:', err);
            this.loginError.set(
              'The Google sign-in popup was blocked or closed. Please allow popups for this site and try again.'
            );
          },
        });
        client.requestAccessToken();
      } catch (e) {
        console.error('[Google Auth] OAuth2 Token client failed:', e);
        this.loginError.set('Google sign-in failed to start. Please try again.');
      }
    }
  }

  public handleGoogleCredentialResponse(response: any): void {
    if (response && response.credential) {
      this.exchangeGoogleTokenForSession(response.credential);
    }
  }

  /**
   * Exchanges a raw Google credential (ID token or OAuth2 access token) for
   * the app's own long-lived session token via POST /api/auth/session. The
   * backend resolves the full profile (including, for the access-token
   * path, a Google userinfo lookup this service used to do itself) and
   * returns it alongside the session token, so this is the only place a
   * session gets established from either sign-in path.
   */
  private async exchangeGoogleTokenForSession(googleToken: string): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleToken}` },
      });
      if (!res.ok) {
        console.error('[Google Auth] Failed to exchange Google token for an app session:', res.status);
        this.loginError.set(
          res.status === 403
            ? 'Sign-in was rejected by the server. Please try again or contact support.'
            : `Sign-in failed (server returned ${res.status}). Please try again.`
        );
        return;
      }
      const data = await res.json();
      const session: UserSession = {
        uid: data.user.uid,
        email: data.user.email || '',
        displayName: data.user.name || 'Google User',
        photoURL: data.user.picture || '',
        idToken: data.sessionToken,
        role: data.user.role === 'admin' ? 'admin' : 'user',
      };
      this.setUserSession(session);
    } catch (e) {
      console.error('[Google Auth] Session exchange failed:', e);
      this.loginError.set('Could not reach the server to complete sign-in. Please check your connection and try again.');
    }
  }

  private setUserSession(session: UserSession): void {
    this.userSignal.set(session);
    this.sessionExpired.set(false);
    this.loginError.set(null);
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

  /** Dismisses the login-failure toast. */
  public dismissLoginError(): void {
    this.loginError.set(null);
  }

  public getIdToken(): string {
    return this.userSignal()?.idToken || '';
  }
}
